/**
 * The extension's background worker (steam-preferences Story 2.1, AC3).
 *
 * Firefox implements this as an event page (`background.scripts`); Chrome as a service worker
 * (`background.service_worker`) — `src/manifest.config.ts` emits the right shape for each, and both
 * point at this SAME compiled file, so nothing below ever branches on which browser it is running
 * in (it branches once, on which global is defined, to pick the promise-based API).
 *
 * Steps 1-5 of AC3, in order:
 *   1. `action.onClicked` fires with the active tab — the click IS the user gesture that grants
 *      `activeTab` for that tab.
 *   2. The target check, BEFORE anything else runs (it also selects the adapter by the page path:
 *      `/profile/settings/steam` or `/profile/settings/epic`). A non-matching tab gets exactly one action —
 *      `tabs.create` to the import page — and the function returns. No fetch, no envelope, no
 *      injection.
 *   3. The host-permission request (a refusal tells the page `permission-denied` when the adapter has notices), SYNCHRONOUSLY and UNCONDITIONALLY, as literally the next line
 *      after the target check — no `permissions.contains()` precheck first. Both engines capture the
 *      user-gesture flag at API-call dispatch time; an intervening `await` (the precheck this file
 *      used to run) yields to the event loop and the flag is gone, so a LATER `request()` call is
 *      rejected instead of prompting — Firefox MV3 treats `host_permissions` as opt-in, so this was
 *      the default (not edge-case) path on Firefox's first click (2026-09-03 review finding P0-1). An
 *      already-granted origin resolves `request()` to `true` immediately with no prompt, so the
 *      precheck bought nothing and only cost the gesture.
 *   4. The adapter runs. When an adapter needs a tab of the store's own origin (Epic, when the worker
 *      fetch fails) and none is open, the page is told `tab-required` and no envelope is sent. A thrown export (non-OK response, non-JSON body, or a schema failure)
 *      aborts silently — no partial or synthesized envelope is ever sent.
 *   5. The hand-off, in the `MAIN` world (never the default `ISOLATED` world — see `handoff.ts`'s
 *      docblock, 2026-09-03 review finding P0-4).
 *
 * Write-Back (Story 4.3) branches in right after step 3: a MAIN-world read of the batch the page armed
 * (`readArmedWritebackBatch`). A valid armed batch runs `adapter.writeBack` and delivers the per-item
 * report to the page's own receiver; anything else falls through to steps 4 and 5 unchanged.
 *
 * Every step from 3 onward is wrapped so a rejection never escapes `handleClick` as an unhandled
 * promise rejection — that is exactly how the P0-1 bug made a click a silent no-op with no feedback
 * anywhere, including in the extension's own service-worker console.
 */
import { adapterForUrlPath } from './adapters';
import { TabRequiredError, type StoreExportAdapter } from './adapters/types';
import { exportContext } from './export-context';
import { handleVisit, isVisitMessage } from './auto-refresh';
import { isAllowedSubtailsOrigin, primarySubtailsOrigin } from './subtails-origins';
import { steamWritebackBatchSchema } from '@subtails/contracts/discovery';
import { deliverWritebackReportToPage, readArmedWritebackBatch } from './handoff';

/** Where a click on any other tab sends the player (the Steam page, the first import surface). */
const DEFAULT_IMPORT_PATH = '/profile/settings/steam';

/** Firefox defines `browser` (promise-based); Chrome (and Firefox's own compat alias) define `chrome`. */
const ext: WebExtensionApi = typeof browser !== 'undefined' ? browser : chrome;

/** Step 2's decision: the adapter serving this tab's subtails page, or `undefined` for any other tab. */
export function adapterForImportPageUrl(rawUrl: string | undefined): StoreExportAdapter | undefined {
	if (!rawUrl) return undefined;
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return undefined;
	}
	return isAllowedSubtailsOrigin(url.origin) ? adapterForUrlPath(url.pathname) : undefined;
}

/** Step 2's decision, pulled out so it is independently testable without a real `URL`-bearing tab. */
export function isImportPageUrl(rawUrl: string | undefined): boolean {
	return adapterForImportPageUrl(rawUrl) !== undefined;
}

/** The appids the page armed for Write-Back, or `null` (nothing armed, an invalid batch, or a failed read). */
async function readArmedBatch(tabId: number): Promise<number[] | null> {
	try {
		const results = await ext.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readArmedWritebackBatch });
		const parsed = steamWritebackBatchSchema.safeParse(results?.[0]?.result);
		return parsed.success ? parsed.data.appids : null;
	} catch {
		return null;
	}
}

export async function handleClick(tab: WebExtensionTab): Promise<void> {
	// Step 2 — the target check, before anything else runs. An envelope must never be produced for
	// a tab that is not the import page.
	const adapter = adapterForImportPageUrl(tab.url);
	if (!adapter) {
		await ext.tabs.create({ url: `${primarySubtailsOrigin()}${DEFAULT_IMPORT_PATH}` });
		return;
	}
	if (typeof tab.id !== 'number') return;
	const tabId = tab.id;

	// Step 3 — host permission, requested synchronously and unconditionally, still inside the
	// click's gesture window.
	let granted: boolean;
	try {
		granted = await ext.permissions.request({ origins: adapter.hostPermissions });
	} catch (err) {
		console.error('store-exporter: permission request failed', err);
		return;
	}
	if (!granted) {
		// Only an adapter with notices (Epic) tells the page; the page then shows how to grant access.
		if (adapter.notice) {
			try {
				await ext.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: adapter.notice, args: ['permission-denied'] });
			} catch (noticeErr) {
				console.error('store-exporter: notice injection failed', noticeErr);
			}
		}
		return;
	}

	// Write-Back: the page arms a batch only when the player chose the extension path.
	const armed = adapter.writeBack ? await readArmedBatch(tabId) : null;
	if (armed && adapter.writeBack) {
		try {
			const report = await adapter.writeBack(armed);
			if (!report) return;
			await ext.scripting.executeScript({
				target: { tabId },
				world: 'MAIN',
				func: deliverWritebackReportToPage,
				args: [report],
			});
		} catch (err) {
			console.error('store-exporter: write-back failed', err);
		}
		return;
	}

	// Step 4 — the adapter runs.
	let envelope;
	try {
		envelope = await adapter.export(exportContext);
	} catch (err) {
		// The page is told only that an Epic tab is needed; every other failure is silent.
		if (err instanceof TabRequiredError && adapter.notice) {
			try {
				await ext.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: adapter.notice, args: ['tab-required'] });
			} catch (noticeErr) {
				console.error('store-exporter: notice injection failed', noticeErr);
			}
		}
		return;
	}

	// Step 5 — the hand-off, in the `MAIN` world.
	try {
		await ext.scripting.executeScript({
			target: { tabId },
			world: 'MAIN',
			func: adapter.deliver as (envelope: unknown) => void,
			args: [envelope],
		});
	} catch (err) {
		console.error('store-exporter: hand-off injection failed', err);
	}
}

ext.action.onClicked.addListener((tab) => {
	handleClick(tab).catch((err: unknown) => {
		console.error('store-exporter: click handler failed', err);
	});
});

// The daily automatic refresh: the content script on subtails pages reports every visit.
ext.runtime.onMessage.addListener((message, sender) => {
	if (!isVisitMessage(message)) return;
	handleVisit(sender).catch(() => {
		// Silent by contract: an automatic run never shows anything.
	});
});
