/**
 * The Steam adapter (steam-preferences Story 2.1, AC3/AC4).
 *
 * Runs entirely in the extension's background context, in the player's own browser, under the
 * player's own Steam session — the browser attaches that session's cookies to both GETs below
 * automatically; this file never reads, stores, or forwards a cookie/session value itself
 * (AD-5, clause (a), which this file is the ONE sanctioned clause-(b) exception for — see AC7 and
 * `packages/workspace-guards/src/__tests__/steam-session-boundary.guard.test.ts`).
 *
 * Two GETs for the export, plus the Write-Back run's own requests (see `writeBack` below). The export's
 * (AC5 — the outbound network surface):
 *   1. `dynamicstore/userdata` — the preference record itself. A non-OK response or a non-JSON body
 *      is a HARD ABORT (throws): the extension must never send a partial or synthesized payload
 *      (the HLTB-endpoint-move incident class, R-2 — a moved/broken endpoint must never read as "no
 *      preferences").
 *   2. `account/` — the player's OWN public `g_steamID`, the same public variable
 *      `public/steam-export/steam-prefs-export.v1.js` reads off the page (never a credential: it is
 *      the same id shown in the player's profile URL). This read is BEST-EFFORT: any failure, a
 *      non-OK response, or an absent/unparsed value omits `steamid` from the envelope rather than
 *      aborting the export. `packages/discovery-account/src/steam-preference-import.ts:356` branches on
 *      `envelope.steamid` PRESENCE, not on producer, so an identity-less extension envelope simply
 *      falls to the same AD-6 owned-list overlap attribution a floor paste already takes — no server
 *      change needed for that case.
 *
 * `contract_version` and `producer` are imported from the shared contract, never re-typed literals
 * (AC4); the built candidate is validated with `steamPreferenceEnvelopeSchema.parse` before this
 * function returns, so a shape the server would reject never leaves the extension.
 */
import {
	STEAM_PREFERENCE_CONTRACT_VERSION,
	STEAM_WRITEBACK_REPORT_CONTRACT_VERSION,
	steamWritebackReportSchema,
	type SteamWritebackReport,
	steamPreferenceProducerSchema,
	steamPreferenceEnvelopeSchema,
	type SteamPreferenceEnvelope,
} from '@subtails/contracts/discovery';
import { deliverEnvelopeToPage, deliverSteamEnvelopeAutomatically, probeSteamAutoRefresh } from '../handoff';
import type { StoreExportAdapter } from './types';

const STEAM_ID_RE = /\bg_steamID\s*=\s*"(\d+)"/;
const SESSION_ID_RE = /\bg_sessionID\s*=\s*"([0-9a-zA-Z]+)"/;

/** The pause between two dismissal POSTs, so a batch never reads as a burst to the store. */
const WRITEBACK_PAUSE_MS = 250;

/**
 * `__STORE_EXPORTER_RELEASE__` (ambient, `types/webextension.d.ts`) is replaced at build time by
 * `build.ts`'s esbuild `define` with the release string baked into this bundle (AC4's
 * `producer_release`). `undefined` outside a real build (e.g. under `vitest`), in which case the
 * envelope's `producer_release` falls back to `'dev'` — informational only, never an acceptance key
 * (AD-6).
 */
function producerRelease(): string {
	return typeof __STORE_EXPORTER_RELEASE__ === 'string' ? __STORE_EXPORTER_RELEASE__ : 'dev';
}

/**
 * The preference payload GET. The URL is inlined (never hoisted to a distant constant) so the
 * credentialed request to the store's preference surface is legible as ONE literal line — the
 * exact shape `steam-session-boundary.guard.test.ts` clause (b) exists to catch, and the reason
 * this file (and only this file) is its clause-(b) exception (AC7).
 *
 * Hard-aborts (throws) on a non-OK response or a non-JSON body.
 */
async function readPayload(): Promise<unknown> {
	const response = await fetch('https://store.steampowered.com/dynamicstore/userdata/', { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`store-exporter: dynamicstore/userdata responded ${response.status}`);
	}
	try {
		return await response.json();
	} catch {
		throw new Error('store-exporter: dynamicstore/userdata body was not JSON');
	}
}

/**
 * The best-effort public-identity read, off a private Steam page that always echoes the logged-in
 * player's own `g_steamID` inline (never a credential — the same id shown in the player's profile
 * URL). Never throws — any failure resolves to `undefined`, and the envelope simply omits `steamid`.
 */
async function readPublicSteamId(): Promise<string | undefined> {
	try {
		const response = await fetch('https://store.steampowered.com/account/', { credentials: 'include' });
		if (!response.ok) return undefined;
		const html = await response.text();
		const match = STEAM_ID_RE.exec(html);
		return match ? match[1] : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The store's own per-page request token, read off the `/account/` HTML (the same fetch shape as the
 * identity read above). It is held in a local, goes into the form body of the dismissal POSTs and
 * nowhere else: never stored, logged, returned, or sent to subtails. This is the one clause-(a)
 * exception (`steam-session-boundary.guard.test.ts`). Resolves `undefined` on any failure.
 */
async function readSessionToken(): Promise<string | undefined> {
	try {
		const response = await fetch('https://store.steampowered.com/account/', { credentials: 'include' });
		if (!response.ok) return undefined;
		const html = await response.text();
		// A logged-out page still carries a session token but no `g_steamID`; an anonymous
		// `userdata` then reads as "every dismissal gone", so a token alone is never enough.
		if (!STEAM_ID_RE.test(html)) return undefined;
		const match = SESSION_ID_RE.exec(html);
		return match ? match[1] : undefined;
	} catch {
		return undefined;
	}
}

/** One dismissal removal. True only for an OK response. */
async function removeDismissal(token: string, appid: number): Promise<boolean> {
	try {
		const body = new URLSearchParams();
		body.set('sessionid', token);
		body.set('appid', String(appid));
		body.set('remove', '1');
		const response = await fetch('https://store.steampowered.com/recommended/ignorerecommendation/', {
			method: 'POST',
			credentials: 'include',
			body,
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** The appids still dismissed in the store's own record, or `null` when that record cannot be read. */
async function readStillIgnored(): Promise<Set<number> | null> {
	try {
		const payload = (await readPayload()) as { rgIgnoredApps?: unknown } | null;
		const ignored = payload?.rgIgnoredApps;
		// Steam serializes an EMPTY map as `[]` (the same artifact `steamPreferenceIgnoredAppsSchema` handles).
		if (Array.isArray(ignored) && ignored.length === 0) return new Set();
		if (typeof ignored !== 'object' || ignored === null || Array.isArray(ignored)) return null;
		return new Set(Object.keys(ignored).map(Number));
	} catch {
		return null;
	}
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const steamAdapter = {
	storeKey: 'steam',
	importPathPrefix: '/profile/settings/steam',
	deliver: deliverEnvelopeToPage,
	hostPermissions: ['https://store.steampowered.com/*'],
	automatic: { probe: probeSteamAutoRefresh, deliver: deliverSteamEnvelopeAutomatically },
	async export(): Promise<SteamPreferenceEnvelope> {
		const payload = await readPayload();
		const steamid = await readPublicSteamId();

		const candidate = {
			contract_version: STEAM_PREFERENCE_CONTRACT_VERSION,
			producer: steamPreferenceProducerSchema.enum.extension,
			producer_release: producerRelease(),
			payload,
			...(steamid ? { steamid } : {}),
		};

		// Validated before it leaves the extension (AC4) — a shape the server would reject never
		// reaches the page.
		return steamPreferenceEnvelopeSchema.parse(candidate);
	},
	async writeBack(appids: readonly number[]): Promise<SteamWritebackReport | null> {
		const token = await readSessionToken();
		if (!token) return null;

		const posted = new Map<number, boolean>();
		for (const appid of appids) {
			if (posted.size > 0) await pause(WRITEBACK_PAUSE_MS);
			posted.set(appid, await removeDismissal(token, appid));
		}

		// `executed` is an OBSERVATION: the POST was OK and the dismissal is gone from the store's own
		// record afterwards. An unreadable verification fails every item.
		const stillIgnored = await readStillIgnored();
		const candidate = {
			contract_version: STEAM_WRITEBACK_REPORT_CONTRACT_VERSION,
			results: [...posted].map(([appid, ok]) => ({
				appid,
				outcome: ok && stillIgnored !== null && !stillIgnored.has(appid) ? ('executed' as const) : ('failed' as const),
			})),
		};
		return steamWritebackReportSchema.parse(candidate);
	},
} satisfies StoreExportAdapter;
