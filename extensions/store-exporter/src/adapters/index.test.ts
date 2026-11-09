/**
 * steam-preferences Story 2.1, AC4/AC6 — the host-permission union is EXACTLY the Steam and Epic
 * permissions, computed from the shipped adapters, never hand-listed.
 */
import { describe, it, expect } from 'vitest';
import { SHIPPED_ADAPTERS, manifestHostPermissions, adapterForUrlPath } from './index';

describe('manifestHostPermissions (steam-preferences Story 2.1, AC4)', () => {
	it('is exactly the sorted, de-duplicated union of every shipped adapter\'s hostPermissions', () => {
		expect(manifestHostPermissions()).toEqual(['https://accounts.epicgames.com/*', 'https://store.steampowered.com/*']);
	});

	it('is derived from SHIPPED_ADAPTERS, not a parallel hand-written list', () => {
		const derived = new Set<string>();
		for (const adapter of SHIPPED_ADAPTERS) {
			for (const permission of adapter.hostPermissions) derived.add(permission);
		}
		expect(manifestHostPermissions()).toEqual(Array.from(derived).sort());
	});

	it('adapterForUrlPath matches the page and its sub-paths, never a look-alike path', () => {
		expect(adapterForUrlPath('/profile/settings/epic')?.storeKey).toBe('epic');
		expect(adapterForUrlPath('/profile/settings/epic/x')?.storeKey).toBe('epic');
		expect(adapterForUrlPath('/profile/settings/epicfoo')).toBeUndefined();
		expect(adapterForUrlPath('/profile/settings/steamer')).toBeUndefined();
	});

	it('SHIPPED_ADAPTERS holds exactly the Steam and Epic adapters', () => {
		expect(SHIPPED_ADAPTERS.map((adapter) => adapter.storeKey)).toEqual(['steam', 'epic']);
	});
});

describe('adapterForUrlPath (epic-ownership Story 1)', () => {
	it('selects the adapter by import page path', () => {
		expect(adapterForUrlPath('/profile/settings/steam')?.storeKey).toBe('steam');
		expect(adapterForUrlPath('/profile/settings/epic')?.storeKey).toBe('epic');
		expect(adapterForUrlPath('/profile/settings/epic/extra')?.storeKey).toBe('epic');
	});

	it('selects nothing for any other path', () => {
		expect(adapterForUrlPath('/profile/settings/discord')).toBeUndefined();
		expect(adapterForUrlPath('/')).toBeUndefined();
	});
});
