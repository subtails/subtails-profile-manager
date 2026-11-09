/**
 * The one manifest source, two emitted bundles (steam-preferences Story 2.1, AC5, AC6).
 *
 * `build.ts` calls `buildManifest('chrome' | 'firefox', …)` for each target and writes the result
 * verbatim as that bundle's `manifest.json`. Only the `background` key and the Gecko block differ
 * between the two — everything else, including `host_permissions` (computed from
 * `manifestHostPermissions()`, never hand-listed), is asserted identical by
 * `manifest.config.test.ts`.
 *
 * ABSENT, deliberately, from every field below: `cookies`, `webRequest`, `webRequestBlocking`,
 * `<all_urls>`, `tabs` (the Epic tab lookup is a `tabs.query` filtered by a granted host, which needs no
 * `tabs` permission), `externally_connectable`, `web_accessible_resources`,
 * `declarativeNetRequest`, `identity`. `permissions` names only `activeTab`, `scripting` and `storage`
 * (the daily refresh keeps one last-run time per store). `content_scripts` is exactly one entry, `content.js`
 * on the subtails origins only, and `host_permissions` is the store hosts plus the subtails origin (a content
 * script match grants no `scripting` access, and the `MAIN` hand-off needs it).
 *
 * `optional_host_permissions` carries the SAME union as `host_permissions` (2026-09-03 review
 * finding P0-1): Chrome's `chrome.permissions.request()` only accepts origins declared in
 * `optional_permissions`/`optional_host_permissions` — an origin that appears ONLY in the required
 * `host_permissions` list rejects the runtime request outright on a Chrome profile whose site-access
 * setting has withheld it ("Only permissions specified in the manifest may be requested."), which is
 * exactly the request `background.ts`'s click handler makes every time. Declaring it in both lists
 * keeps the install-time grant `host_permissions` already gives most users AND makes the runtime
 * `request()` call valid for the rest.
 */
import { manifestHostPermissions } from './adapters';
import { subtailsMatchPatterns } from './subtails-origins';

export const EXTENSION_NAME = 'subtails Profile Manager';
export const EXTENSION_DESCRIPTION =
	'Exports your Steam preference record and the games you own on Epic to subtails in one click, under your own subtails session.';
/**
 * The manifest `version` field — the ONE source of truth for it. Both manifests' `version`, the
 * built bundle's `producer_release` string (`store-exporter.v${EXTENSION_VERSION}`, `build.ts`'s
 * esbuild `define`), every `package.ts` artifact filename, and `submission.json`'s own `version` all
 * derive from this single constant — never a second version literal anywhere in this project
 * (`store-exporter-version-single-source.guard.test.ts` enforces it mechanically).
 *
 * `1.2.0` adds the Epic order history reader and the daily refresh. Story 2.3 owns real releases: this
 * is bumped forward on every release thereafter — both
 * stores reject a re-used or lower version number, which is a store-enforced fact this project does
 * not duplicate with a local version-history file (see the README's release steps).
 */
export const EXTENSION_VERSION = '1.2.0';

/**
 * The Firefox add-on's Gecko identity — fixed across every release (an AMO requirement: the id is how
 * AMO recognizes "a new version of the same add-on" rather than a fresh submission). `submit.ts`
 * reuses this SAME constant as the add-on identifier in AMO's version-creation API call, so a real
 * store-side add-on id never has to be introduced as a seventh operator secret.
 */
export const FIREFOX_ADDON_GUID = 'store-exporter@subtails.com';

/** `16`/`32`/`48`/`128`, matching the four PNGs shipped in `src/icons/`. */
const ICON_PATHS: Readonly<Record<string, string>> = {
	'16': 'icons/icon-16.png',
	'32': 'icons/icon-32.png',
	'48': 'icons/icon-48.png',
	'128': 'icons/icon-128.png',
};

export interface ManifestOptions {
	readonly version: string;
	/** Defaults to `release`; `dev` adds `http://localhost/*` to the subtails origins. */
	readonly channel?: 'release' | 'dev';
}

export type BrowserTarget = 'chrome' | 'firefox';

function sharedManifestFields(options: ManifestOptions) {
	return {
		manifest_version: 3 as const,
		name: EXTENSION_NAME,
		version: options.version,
		description: EXTENSION_DESCRIPTION,
		action: {
			default_title: EXTENSION_NAME,
			default_icon: ICON_PATHS,
		},
		permissions: ['activeTab', 'scripting', 'storage'],
		host_permissions: [...manifestHostPermissions(), ...subtailsMatchPatterns(options.channel ?? 'release')],
		// Only the store hosts are requested at runtime; the subtails origin is an install-time grant.
		optional_host_permissions: manifestHostPermissions(),
		content_scripts: [{ matches: subtailsMatchPatterns(options.channel ?? 'release'), js: ['content.js'], run_at: 'document_idle' as const }],
		icons: ICON_PATHS,
	};
}

/** Chrome MV3: `background.service_worker`, ES module. */
function buildChromeManifest(options: ManifestOptions) {
	return {
		...sharedManifestFields(options),
		background: {
			service_worker: 'background.js',
			type: 'module' as const,
		},
	};
}

/**
 * Firefox implements the event-page form (`background.scripts`), not `service_worker`. The Gecko
 * block is the one Firefox-only addition — an `id` (extension identity across updates) and the minimum
 * version, 127.0: from there Firefox grants `host_permissions` at install.
 */
function buildFirefoxManifest(options: ManifestOptions) {
	return {
		...sharedManifestFields(options),
		background: {
			scripts: ['background.js'],
		},
		browser_specific_settings: {
			gecko: {
				id: FIREFOX_ADDON_GUID,
				strict_min_version: '127.0',
			},
		},
	};
}

export function buildManifest(target: BrowserTarget, options: ManifestOptions): Record<string, unknown> {
	return target === 'chrome' ? buildChromeManifest(options) : buildFirefoxManifest(options);
}
