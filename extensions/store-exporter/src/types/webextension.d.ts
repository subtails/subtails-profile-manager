/**
 * Hand-written WebExtension ambient declarations (steam-preferences Story 2.1, AC1/AC6).
 *
 * Covers ONLY the API surface this extension actually calls: `action.onClicked`, `tabs.create`,
 * `scripting.executeScript`, `permissions.request`, and `runtime`. Decided under delegated
 * authority: no `@types/chrome` — a new dependency means bumping BOTH `package-lock.json` and
 * `bun.lock` (`bun install --lockfile-only` keeps old transitive versions), and this project adds
 * zero new dependencies. This file is this project's own tsconfig `include` only (AC1) — the root
 * `tsconfig.json` excludes `extensions` precisely so these globals never leak into (or clash with)
 * the whole-repo `npm run typecheck` sweep.
 *
 * Declares BOTH `chrome` (Chrome, and Firefox's Chrome-compatibility alias) and `browser`
 * (Firefox's native, promise-based namespace) as the SAME shape: every method this project calls
 * already returns a Promise when called without a trailing callback in Chrome MV3, so one interface
 * covers both runtimes and `background.ts` picks whichever global is defined.
 */

interface WebExtensionTab {
	id?: number;
	url?: string;
}

interface WebExtensionMessageSender {
	/** The id of the extension that sent the message. */
	id?: string;
	tab?: WebExtensionTab;
}

interface WebExtensionApi {
	action: {
		onClicked: {
			addListener(callback: (tab: WebExtensionTab) => void): void;
		};
	};
	tabs: {
		create(createProperties: { url: string }): Promise<WebExtensionTab>;
		/** With a host permission for the matched origin, `url` filtering needs no `tabs` permission. */
		query(queryInfo: { url?: string | string[] }): Promise<WebExtensionTab[]>;
	};
	scripting: {
		executeScript<Args extends unknown[]>(injection: {
			target: { tabId: number };
			/**
			 * Defaults to `ISOLATED`. `handoff.ts`'s delivery function runs in `MAIN` — the page's own JS
			 * realm — never the default `ISOLATED` world (2026-09-03 review finding P0-4): an isolated
			 * world shares only the DOM with the page, not JS heap state, so any DOM-level signal it sends
			 * (`window.postMessage`, a dispatched event, a DOM attribute) is visible to every OTHER
			 * extension's isolated-world content script resident on the same page too, not just this
			 * extension's own listener. A plain JS-heap write made from inside `MAIN` is invisible to every
			 * isolated world (this extension's own and any other's) by the same isolation guarantee, so it
			 * is the only delivery that is not a broadcast. See `handoff.ts`'s docblock for the full
			 * reasoning.
			 */
			world?: 'ISOLATED' | 'MAIN';
			/** In `MAIN` the function may return a JSON-cloneable value, which comes back as `result`. */
			func: (...args: Args) => unknown;
			args?: Args;
		}): Promise<{ result?: unknown }[]>;
	};
	permissions: {
		request(permissions: { origins?: readonly string[] }): Promise<boolean>;
		/** Never prompts: the automatic run only asks whether the grant is already there. */
		contains(permissions: { origins?: readonly string[] }): Promise<boolean>;
	};
	storage: {
		local: {
			get(key: string): Promise<Record<string, unknown>>;
			set(items: Record<string, unknown>): Promise<void>;
		};
	};
	runtime: {
		getManifest(): { version: string };
		readonly id: string;
		sendMessage(message: unknown): Promise<unknown>;
		onMessage: {
			addListener(callback: (message: unknown, sender: WebExtensionMessageSender) => void): void;
		};
	};
}

declare const chrome: WebExtensionApi;
declare const browser: WebExtensionApi | undefined;

/**
 * Two build-time markers, both replaced by `build.ts`'s esbuild `define` in a real build (a pure
 * textual substitution — the identifier never exists as a runtime variable in the built bundle) and
 * both `undefined` outside one (e.g. under `vitest`, which runs no esbuild `define` step) — never
 * read from a runtime env var, which an installed extension has no way to set.
 *
 * Declared `var` (not `const`): only a `var`/`function` ambient global becomes a property of
 * `typeof globalThis`, which `subtails-origins.test.ts` needs in order to set
 * `globalThis.__STORE_EXPORTER_CHANNEL__` directly for its per-channel arms.
 */
/** The release string baked into `producer_release` (`adapters/steam.ts`, AC4). Falls back to `'dev'`. */
// eslint-disable-next-line no-var -- `var` (not `const`/`let`) is required so this attaches to `typeof globalThis`.
declare var __STORE_EXPORTER_RELEASE__: string | undefined;
/** Which origin allow-list applies (`subtails-origins.ts`, AC3/AC6). Falls back to `'release'`. */
// eslint-disable-next-line no-var -- same reason as above.
declare var __STORE_EXPORTER_CHANNEL__: 'release' | 'dev' | undefined;
