/**
 * Locks the store listing (epic-ownership Story 8, CAP-8): every manifest permission and host has a
 * justification row in STORE-LISTING.md, and the listing states the consent facts the install carries.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildManifest } from './src/manifest.config';

const here = dirname(fileURLToPath(import.meta.url));
const listing = readFileSync(join(here, 'STORE-LISTING.md'), 'utf8');

export function missingJustifications(manifest: Record<string, unknown>, text: string): string[] {
	const names = [
		...((manifest.permissions as string[]) ?? []),
		...((manifest.host_permissions as string[]) ?? []),
	];
	return names.filter((name) => !text.includes(`| \`${name}\` |`));
}

describe('STORE-LISTING.md', () => {
	for (const target of ['chrome', 'firefox'] as const) {
		it(`justifies every ${target} permission and host`, () => {
			expect(missingJustifications(buildManifest(target, { version: '1.2.0' }), listing)).toEqual([]);
		});
	}

	it('goes red when a permission has no justification', () => {
		const manifest = buildManifest('chrome', { version: '1.2.0' });
		const widened = { ...manifest, permissions: [...(manifest.permissions as string[]), 'cookies'] };
		expect(missingJustifications(widened, listing)).toEqual(['cookies']);
	});

	it('states the consent facts and the public source', () => {
		for (const fact of ['automatically', 'once a day', 'uploads nothing itself', 'settings page', 'subtails/subtails-profile-manager']) {
			expect(listing).toContain(fact);
		}
	});
});
