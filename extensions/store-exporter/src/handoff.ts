/**
 * The injected hand-off function (steam-preferences Story 2.1, AC3 step 5).
 *
 * `background.ts` passes this function to `scripting.executeScript` with `world: 'MAIN'`, which
 * serializes its source and re-runs it inside the target tab's PAGE realm — the same JS heap the
 * page's own React code runs in — never the default `ISOLATED` world.
 *
 * Why `MAIN`, not `ISOLATED` (2026-09-03 review finding P0-4, disclosure half): an isolated-world
 * content script and the page share the DOM but NOT JS state — that is the whole point of the
 * isolation. But `window.postMessage` (the mechanism this file used to use) is a DOM-level API: the
 * `message` event it dispatches is delivered to every listener attached to that shared `window`,
 * regardless of which world attached it. Any OTHER installed extension with its own isolated-world
 * content script resident on this same page — and content scripts are commonly injected broadly —
 * would receive the SAME broadcast and could read the full preference record plus `steamid` out of
 * it, a capability it has no other way to obtain. A plain JS-heap property/function on `window`,
 * written from inside `MAIN`, is invisible to every isolated world (this extension's own and any
 * other's) by the same isolation guarantee that makes `MAIN` and `ISOLATED` mutually opaque — it is
 * the one delivery shape that is not a broadcast.
 *
 * This does not reopen the "hand page scripts a reachable function" concern the original ISOLATED
 * choice was guarding against: this function calls OUT to a receiver the PAGE itself defines and
 * owns (never the reverse), does no privileged work of its own (it does not fetch, does not touch
 * `chrome.*`, does not read a credential), and leaves nothing of the extension's own reachable after
 * it returns.
 *
 * It does exactly one thing: if the page has registered its hand-off receiver
 * (`window.__subtailsSteamHandoff`, a page-owned function — this extension only ever calls it, never
 * defines or reads it back), call it once with the envelope under a marker the receiver checks for.
 * No `chrome.*` call, no storage write, no logging of the envelope.
 *
 * The security posture (stated in full in the story, restated here so a reviewer finds it at the
 * call site too): the receiving page trusts the marker + schema alone. There is no origin or window
 * to check any more — a same-realm function call cannot originate from another origin, another
 * window, or another extension — so this is STRICTLY narrower than the postMessage-based hand-off it
 * replaces, not merely different. It is still NOT an authentication boundary: every server-side check
 * in `packages/discovery-account/src/steam-preference-import.ts` still runs on whatever a hand-off delivers,
 * exactly as it does for a hand-pasted file.
 */
import type { SteamPreferenceEnvelope, SteamWritebackReport } from '@subtails/contracts/discovery';
import type { EpicOwnershipEnvelope } from './adapters/epic';
import type { AdapterNotice } from './adapters/types';

export function deliverEnvelopeToPage(envelope: SteamPreferenceEnvelope): void {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsSteamHandoff;
	if (typeof receiver === 'function') {
		(receiver as (message: unknown) => void)({ __subtails: 'steam-preference-export', envelope });
	}
}

/**
 * Write-Back, read half (steam-preferences Story 4.3). Runs in the `MAIN` world like the hand-off above
 * and returns the batch the PAGE armed, by calling the page-owned provider
 * `window.__subtailsSteamWritebackBatch` (this extension only ever calls it, never defines it) and
 * returning its value through `executeScript`. Absent, not a function, or throwing: `null`, and
 * `background.ts` then runs the unchanged export. The returned value is untrusted until
 * `background.ts` validates it against `steamWritebackBatchSchema`.
 */
export function readArmedWritebackBatch(): unknown {
	const provider = (window as unknown as Record<string, unknown>).__subtailsSteamWritebackBatch;
	if (typeof provider !== 'function') return null;
	try {
		return (provider as () => unknown)();
	} catch {
		return null;
	}
}

/**
 * Write-Back, report half. The same shape as `deliverEnvelopeToPage`: a same-realm call of the
 * page-owned receiver `window.__subtailsSteamWritebackReport`, never `postMessage`, carrying only
 * appids and outcomes (never a credential). No `chrome.*` call, no storage write, no logging.
 */
export function deliverWritebackReportToPage(report: SteamWritebackReport): void {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsSteamWritebackReport;
	if (typeof receiver === 'function') {
		(receiver as (message: unknown) => void)({ __subtails: 'steam-writeback-outcomes', report });
	}
}

/**
 * Epic hand-off (epic-ownership Story 1). The same shape as `deliverEnvelopeToPage`: a same-realm
 * `MAIN` call of the page-owned receiver `window.__subtailsEpicHandoff`, never `postMessage`. No
 * `chrome.*` call, no storage write, no logging of the envelope.
 */
export function deliverEpicEnvelopeToPage(envelope: EpicOwnershipEnvelope): void {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsEpicHandoff;
	if (typeof receiver === 'function') {
		(receiver as (message: unknown) => void)({ __subtails: 'epic-order-export', envelope });
	}
}

/**
 * Tells the page why no envelope is coming (`tab-required`: open an Epic tab and click again;
 * `permission-denied`: the player refused the host permission request).
 */
export function deliverEpicNoticeToPage(notice: AdapterNotice): void {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsEpicHandoff;
	if (typeof receiver === 'function') {
		(receiver as (message: unknown) => void)({ __subtails: 'epic-notice', notice });
	}
}

/**
 * The daily automatic run, ask half (spec-epic-ownership story 5). A same-realm `MAIN` call of the
 * page-owned receiver `window.__subtailsEpicAuto`, never `postMessage`. Resolves `true` when the page
 * wants an automatic run, `false` when it does not (a stop, a failed check), and `null` when no receiver
 * exists (signed out, or the page has not registered it yet). No `chrome.*` call, no storage write.
 */
export async function probeEpicAutoRefresh(): Promise<boolean | null> {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsEpicAuto;
	if (typeof receiver !== 'function') return null;
	try {
		return (await (receiver as (message: unknown) => Promise<unknown>)({ __subtails: 'epic-auto-probe' })) === true;
	} catch {
		return false;
	}
}

/**
 * The daily automatic run, hand-off half. The same shape as `probeEpicAutoRefresh`: it passes the
 * envelope to the page-owned receiver and resolves `true` only when the page reports the server accepted
 * it. No `chrome.*` call, no storage write, no logging of the envelope.
 */
export async function deliverEpicEnvelopeAutomatically(envelope: EpicOwnershipEnvelope): Promise<boolean> {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsEpicAuto;
	if (typeof receiver !== 'function') return false;
	try {
		return (await (receiver as (message: unknown) => Promise<unknown>)({ __subtails: 'epic-auto-export', envelope })) === true;
	} catch {
		return false;
	}
}

/**
 * The daily automatic Steam run, ask half (spec-epic-ownership story 6). A same-realm `MAIN` call of the
 * page-owned receiver `window.__subtailsSteamAuto`, never `postMessage`. Resolves `true` when the page wants
 * an automatic run (a linked Steam account and no stop), `false` when it does not, and `null` when no
 * receiver exists (signed out, or the page has not registered it yet). No `chrome.*` call, no storage write.
 */
export async function probeSteamAutoRefresh(): Promise<boolean | null> {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsSteamAuto;
	if (typeof receiver !== 'function') return null;
	try {
		return (await (receiver as (message: unknown) => Promise<unknown>)({ __subtails: 'steam-auto-probe' })) === true;
	} catch {
		return false;
	}
}

/**
 * The daily automatic Steam run, hand-off half. The same shape as `probeSteamAutoRefresh`: it passes the
 * envelope to the page-owned receiver and resolves `true` only when the page reports the server accepted
 * it. No `chrome.*` call, no storage write, no logging of the envelope.
 */
export async function deliverSteamEnvelopeAutomatically(envelope: SteamPreferenceEnvelope): Promise<boolean> {
	const receiver = (window as unknown as Record<string, unknown>).__subtailsSteamAuto;
	if (typeof receiver !== 'function') return false;
	try {
		return (await (receiver as (message: unknown) => Promise<unknown>)({ __subtails: 'steam-auto-export', envelope })) === true;
	} catch {
		return false;
	}
}
