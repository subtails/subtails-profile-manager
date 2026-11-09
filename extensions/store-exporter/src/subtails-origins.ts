/**
 * The origin allow-list (steam-preferences Story 2.1, AC3, AC6).
 *
 * `background.ts`'s target check (AC3 step 2) runs `new URL(tab.url).origin` through
 * `isAllowedSubtailsOrigin` BEFORE anything else — no fetch runs, no envelope is built, nothing is
 * injected for a tab that fails this check.
 *
 * A release-channel build accepts EXACTLY `https://subtails.com`. The dev channel additionally
 * accepts any `http://localhost:<port>` origin, so a local dev server can exercise the hand-off
 * without a release build. The channel is baked in at build time by `build.ts`'s esbuild `define`
 * (`__STORE_EXPORTER_CHANNEL__`, declared ambient in `types/webextension.d.ts`) — never read from a
 * runtime env var, which an installed extension has no way to set.
 */

const RELEASE_ORIGINS: readonly string[] = ['https://subtails.com'];
/** `http://localhost` with an optional `:<port>` — never `https`, never a hostname other than localhost. */
const LOCALHOST_ORIGIN_RE = /^http:\/\/localhost(:\d+)?$/;

function channel(): 'release' | 'dev' {
	return typeof __STORE_EXPORTER_CHANNEL__ === 'string' ? __STORE_EXPORTER_CHANNEL__ : 'release';
}

/** True iff `origin` (a `new URL(...).origin` value) is allow-listed for this build's channel. */
export function isAllowedSubtailsOrigin(origin: string): boolean {
	if (RELEASE_ORIGINS.includes(origin)) return true;
	return channel() === 'dev' && LOCALHOST_ORIGIN_RE.test(origin);
}

/** The origin a non-matching-tab click navigates to (AC3 step 2) — always the release origin. */
export function primarySubtailsOrigin(): string {
	return RELEASE_ORIGINS[0];
}

/**
 * The match patterns of the subtails origins for a channel: the content script's `matches` and the
 * subtails entry of `host_permissions` (a content script match grants no `scripting` access, and the
 * `MAIN` hand-off needs it). The release channel is exactly `https://subtails.com/*`; the dev channel adds
 * `http://localhost/*` (a match pattern without a port matches every port).
 */
export function subtailsMatchPatterns(buildChannel: 'release' | 'dev'): string[] {
	return [...RELEASE_ORIGINS.map((origin) => `${origin}/*`), ...(buildChannel === 'dev' ? ['http://localhost/*'] : [])];
}
