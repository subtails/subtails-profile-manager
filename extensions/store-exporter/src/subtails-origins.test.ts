/**
 * steam-preferences Story 2.1, AC3/AC6 — the origin allow-list. A release-channel build accepts
 * EXACTLY `https://subtails.com` and rejects near-miss origins; the dev channel additionally accepts
 * `http://localhost:<port>`. `__STORE_EXPORTER_CHANNEL__` is undeclared under `vitest` (no esbuild
 * `define` runs here), so each arm sets it directly to exercise a specific channel.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isAllowedSubtailsOrigin, primarySubtailsOrigin, subtailsMatchPatterns } from './subtails-origins';

afterEach(() => {
	globalThis.__STORE_EXPORTER_CHANNEL__ = undefined;
});

describe('isAllowedSubtailsOrigin — release channel (default, __STORE_EXPORTER_CHANNEL__ undefined)', () => {
	it('accepts exactly https://subtails.com', () => {
		expect(isAllowedSubtailsOrigin('https://subtails.com')).toBe(true);
	});

	it('rejects a look-alike origin with an extra suffix', () => {
		expect(isAllowedSubtailsOrigin('https://subtails.com.evil.test')).toBe(false);
	});

	it('rejects the same host over plain http', () => {
		expect(isAllowedSubtailsOrigin('http://subtails.com')).toBe(false);
	});

	it('rejects every other non-matching origin', () => {
		expect(isAllowedSubtailsOrigin('https://evil.test')).toBe(false);
		expect(isAllowedSubtailsOrigin('https://steampowered.com')).toBe(false);
	});

	it('rejects localhost — that is dev-channel only', () => {
		expect(isAllowedSubtailsOrigin('http://localhost:3000')).toBe(false);
	});
});

describe('isAllowedSubtailsOrigin — dev channel', () => {
	it('additionally accepts http://localhost:<port>, any port', () => {
		globalThis.__STORE_EXPORTER_CHANNEL__ = 'dev';
		expect(isAllowedSubtailsOrigin('http://localhost:3000')).toBe(true);
		expect(isAllowedSubtailsOrigin('http://localhost:8080')).toBe(true);
		expect(isAllowedSubtailsOrigin('http://localhost')).toBe(true);
	});

	it('still accepts the release origin', () => {
		globalThis.__STORE_EXPORTER_CHANNEL__ = 'dev';
		expect(isAllowedSubtailsOrigin('https://subtails.com')).toBe(true);
	});

	it('still rejects a non-localhost, non-release origin', () => {
		globalThis.__STORE_EXPORTER_CHANNEL__ = 'dev';
		expect(isAllowedSubtailsOrigin('https://evil.test')).toBe(false);
		// https on "localhost" is not the accepted dev shape (http only).
		expect(isAllowedSubtailsOrigin('https://localhost:3000')).toBe(false);
	});
});

describe('primarySubtailsOrigin', () => {
	it('is always the release origin, regardless of channel', () => {
		expect(primarySubtailsOrigin()).toBe('https://subtails.com');
		globalThis.__STORE_EXPORTER_CHANNEL__ = 'dev';
		expect(primarySubtailsOrigin()).toBe('https://subtails.com');
	});
});

describe('subtailsMatchPatterns (spec-epic-ownership story 5)', () => {
	it('is exactly the release origin for a release build and adds localhost only for dev', () => {
		expect(subtailsMatchPatterns('release')).toEqual(['https://subtails.com/*']);
		expect(subtailsMatchPatterns('dev')).toEqual(['https://subtails.com/*', 'http://localhost/*']);
	});
});
