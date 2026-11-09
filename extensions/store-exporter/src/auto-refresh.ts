/**
 * The daily automatic refresh (spec-epic-ownership story 5, CAP-6 follow-up). The content script on
 * subtails pages reports every visit (`{ kind: 'subtails-visit' }`); `handleVisit` decides whether a store
 * is due and, if so, runs it with no click and no prompt.
 *
 * Per adapter that has an `automatic` slot (Epic; Steam is story 6), in order, stopping silently at the
 * first no:
 *   1. the sender is this extension's own content script on an allowed subtails origin;
 *   2. no run of this store is in flight, and none failed in the last 10 minutes (in memory only);
 *   3. the last SUCCESSFUL run (`storage.local`, one time per store) is over 24 hours ago or absent;
 *   4. `permissions.contains` says the store host is already granted (this file never calls `request`);
 *   5. the page answers the probe: a receiver exists (the shell registers it only for a signed-in viewer,
 *      possibly a moment after load, so a missing receiver is retried a few times) and the server stop is not set;
 *   6. the adapter reads the player's own record; a failed read (no Epic session, no tab) yields no envelope;
 *   7. the page receiver hands the envelope to the automatic route and answers whether the server accepted it.
 * Only step 7 answering `true` writes the time. Nothing is shown, no tab is opened, no cookie or token is read.
 */
import { SHIPPED_ADAPTERS } from './adapters';
import type { StoreExportAdapter } from './adapters/types';
import { exportContext } from './export-context';
import { isAllowedSubtailsOrigin } from './subtails-origins';

const ext: WebExtensionApi = typeof browser !== 'undefined' ? browser : chrome;

export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
/** A missing page receiver is asked again after these delays (the shell registers it after the session resolves). */
export const RECEIVER_RETRY_DELAYS_MS: readonly number[] = [1500, 3000, 5000];
export const VISIT_MESSAGE_KIND = 'subtails-visit';

export function lastRunStorageKey(storeKey: string): string {
	return `autoRefresh.lastRun.${storeKey}`;
}

export function isVisitMessage(message: unknown): boolean {
	return typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind === VISIT_MESSAGE_KIND;
}

/** The tab id when `sender` is this extension's own context on an allowed subtails origin, else `null`. */
export function trustedTabId(sender: WebExtensionMessageSender | undefined): number | null {
	if (!sender || sender.id !== ext.runtime.id) return null;
	const tab = sender.tab;
	if (!tab || typeof tab.id !== 'number' || typeof tab.url !== 'string') return null;
	try {
		return isAllowedSubtailsOrigin(new URL(tab.url).origin) ? tab.id : null;
	} catch {
		return null;
	}
}

export interface VisitDeps {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
}

const realDeps: VisitDeps = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

const inFlight = new Set<string>();
const failedAt = new Map<string, number>();

/** Test hook: clears the in-memory state a worker restart would clear. */
export function resetAutoRefreshState(): void {
	inFlight.clear();
	failedAt.clear();
}

async function runInPage<T>(tabId: number, func: (...args: never[]) => unknown, args?: unknown[]): Promise<T | undefined> {
	const results = await ext.scripting.executeScript({
		target: { tabId },
		world: 'MAIN',
		func: func as (...a: unknown[]) => unknown,
		args,
	});
	return results?.[0]?.result as T | undefined;
}

async function isDue(storeKey: string, now: number): Promise<boolean> {
	const key = lastRunStorageKey(storeKey);
	const stored = (await ext.storage.local.get(key))[key];
	return typeof stored !== 'number' || now - stored >= REFRESH_INTERVAL_MS;
}

async function askPage(tabId: number, adapter: StoreExportAdapter, deps: VisitDeps): Promise<boolean> {
	const automatic = adapter.automatic;
	if (!automatic) return false;
	for (let attempt = 0; ; attempt++) {
		const answer = await runInPage<boolean | null>(tabId, automatic.probe);
		if (answer === true) return true;
		if (answer === false || attempt >= RECEIVER_RETRY_DELAYS_MS.length) return false;
		await deps.sleep(RECEIVER_RETRY_DELAYS_MS[attempt]);
	}
}

async function refreshStore(tabId: number, adapter: StoreExportAdapter, deps: VisitDeps): Promise<void> {
	const automatic = adapter.automatic;
	if (!automatic) return;
	const store = adapter.storeKey;
	if (inFlight.has(store)) return;
	const failed = failedAt.get(store);
	if (failed !== undefined && deps.now() - failed < FAILURE_BACKOFF_MS) return;
	inFlight.add(store);
	try {
		if (!(await isDue(store, deps.now()))) return;
		if (!(await ext.permissions.contains({ origins: adapter.hostPermissions }))) return;
		if (!(await askPage(tabId, adapter, deps))) {
			failedAt.set(store, deps.now());
			return;
		}
		let accepted = false;
		try {
			const envelope = await adapter.export(exportContext);
			accepted = (await runInPage<boolean>(tabId, automatic.deliver as (...args: never[]) => unknown, [envelope])) === true;
		} catch {
			accepted = false;
		}
		if (accepted) {
			failedAt.delete(store);
			await ext.storage.local.set({ [lastRunStorageKey(store)]: deps.now() });
		} else {
			failedAt.set(store, deps.now());
		}
	} catch {
		failedAt.set(store, deps.now());
	} finally {
		inFlight.delete(store);
	}
}

/** One subtails page visit: runs every due store. Never throws, never shows anything. */
export async function handleVisit(sender: WebExtensionMessageSender | undefined, deps: VisitDeps = realDeps): Promise<void> {
	const tabId = trustedTabId(sender);
	if (tabId === null) return;
	await Promise.all(SHIPPED_ADAPTERS.map((adapter) => refreshStore(tabId, adapter, deps)));
}
