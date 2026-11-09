/**
 * steam-preferences Story 2.1, AC5/AC6 — the manifest generator. Asserts the permission set by EXACT
 * set equality (not a "contains no cookies" spot check), that both browsers' permission sets are
 * identical, that only the `background` key and the Gecko block differ, and that a long list of
 * dangerous permissions is absent from both.
 */
import { describe, it, expect } from 'vitest';
import { buildManifest, EXTENSION_VERSION } from './manifest.config';
import { manifestHostPermissions } from './adapters';

const STORE_HOSTS = ['https://accounts.epicgames.com/*', 'https://store.steampowered.com/*'];

const OPTIONS = { version: EXTENSION_VERSION };

const DANGEROUS_KEYS = [
	'cookies',
	'webRequest',
	'webRequestBlocking',
	'tabs',
	'externally_connectable',
	'web_accessible_resources',
	'declarativeNetRequest',
	'identity',
];

describe('buildManifest (steam-preferences Story 2.1, AC5)', () => {
	it('emits manifest_version 3 for both browsers', () => {
		expect(buildManifest('chrome', OPTIONS).manifest_version).toBe(3);
		expect(buildManifest('firefox', OPTIONS).manifest_version).toBe(3);
	});

	it('host_permissions is the store hosts from manifestHostPermissions() plus the subtails origin, for both browsers', () => {
		expect(buildManifest('chrome', OPTIONS).host_permissions).toEqual([...manifestHostPermissions(), 'https://subtails.com/*']);
		expect(buildManifest('firefox', OPTIONS).host_permissions).toEqual([...manifestHostPermissions(), 'https://subtails.com/*']);
	});

	it('optional_host_permissions carries the store union, for both browsers (P0-1 — Chrome only accepts a runtime permissions.request() for an origin declared here)', () => {
		expect(buildManifest('chrome', OPTIONS).optional_host_permissions).toEqual(manifestHostPermissions());
		expect(buildManifest('firefox', OPTIONS).optional_host_permissions).toEqual(manifestHostPermissions());
	});

	it('permissions is EXACTLY ["activeTab", "scripting", "storage"] — set equality, not a spot check', () => {
		const chrome = buildManifest('chrome', OPTIONS);
		const firefox = buildManifest('firefox', OPTIONS);
		expect(new Set(chrome.permissions as string[])).toEqual(new Set(['activeTab', 'scripting', 'storage']));
		expect(new Set(firefox.permissions as string[])).toEqual(new Set(['activeTab', 'scripting', 'storage']));
	});

	it('host_permissions is exactly the two stores plus the subtails origin, both browsers (an extra host fails)', () => {
		const expected = [...STORE_HOSTS, 'https://subtails.com/*'];
		expect(buildManifest('chrome', OPTIONS).host_permissions).toEqual(expected);
		expect(buildManifest('firefox', OPTIONS).host_permissions).toEqual(expected);
		expect(buildManifest('chrome', OPTIONS).optional_host_permissions).toEqual(STORE_HOSTS);
		expect(buildManifest('firefox', OPTIONS).optional_host_permissions).toEqual(STORE_HOSTS);
	});

	it('carries exactly one content script, content.js on the subtails origins only', () => {
		for (const target of ['chrome', 'firefox'] as const) {
			const scripts = buildManifest(target, OPTIONS).content_scripts as Array<{ matches: string[]; js: string[] }>;
			expect(scripts).toHaveLength(1);
			expect(scripts[0].matches).toEqual(['https://subtails.com/*']);
			expect(scripts[0].js).toEqual(['content.js']);
		}
	});

	it('the dev channel adds localhost to the content script and the host grant, the release channel never does', () => {
		const dev = buildManifest('chrome', { ...OPTIONS, channel: 'dev' });
		expect((dev.content_scripts as Array<{ matches: string[] }>)[0].matches).toEqual(['https://subtails.com/*', 'http://localhost/*']);
		expect(dev.host_permissions).toEqual([...STORE_HOSTS, 'https://subtails.com/*', 'http://localhost/*']);
		expect(JSON.stringify(buildManifest('chrome', OPTIONS))).not.toContain('localhost');
	});

	it('never carries <all_urls> in host_permissions', () => {
		const chrome = buildManifest('chrome', OPTIONS);
		expect((chrome.host_permissions as string[]).includes('<all_urls>')).toBe(false);
	});

	it.each(DANGEROUS_KEYS)('never declares the top-level key "%s" on either manifest', (key) => {
		const chrome = buildManifest('chrome', OPTIONS) as Record<string, unknown>;
		const firefox = buildManifest('firefox', OPTIONS) as Record<string, unknown>;
		expect(Object.prototype.hasOwnProperty.call(chrome, key)).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(firefox, key)).toBe(false);
	});

	it('the two manifests differ ONLY on `background` and `browser_specific_settings`', () => {
		const chrome = buildManifest('chrome', OPTIONS) as Record<string, unknown>;
		const firefox = buildManifest('firefox', OPTIONS) as Record<string, unknown>;
		const chromeRest = { ...chrome };
		const firefoxRest = { ...firefox };
		delete chromeRest.background;
		delete firefoxRest.background;
		delete firefoxRest.browser_specific_settings;
		expect(chromeRest).toEqual(firefoxRest);
	});

	it('Chrome uses background.service_worker (MV3 service worker)', () => {
		const chrome = buildManifest('chrome', OPTIONS) as { background: { service_worker?: string; scripts?: string[] } };
		expect(chrome.background.service_worker).toBe('background.js');
		expect(chrome.background.scripts).toBeUndefined();
	});

	it('Firefox uses background.scripts (the event-page form) and carries a Gecko block', () => {
		const firefox = buildManifest('firefox', OPTIONS) as {
			background: { scripts?: string[]; service_worker?: string };
			browser_specific_settings?: { gecko?: { id?: string; strict_min_version?: string } };
		};
		expect(firefox.background.scripts).toEqual(['background.js']);
		expect(firefox.background.service_worker).toBeUndefined();
		expect(firefox.browser_specific_settings?.gecko?.id).toBeTruthy();
		expect(firefox.browser_specific_settings?.gecko?.strict_min_version).toBe('127.0');
	});
});
