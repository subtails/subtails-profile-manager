/**
 * steam-preferences Story 2.3, AC3 — the GPLv3 `LICENSE` file must be the VERBATIM, unmodified text
 * from `https://www.gnu.org/licenses/gpl-3.0.txt`, never retyped, summarized, or "adapted". A
 * paraphrased licence is a legal defect that would otherwise read like a passing file, so this test
 * checks the shape a paraphrase could not reproduce: the exact title strings, the terms heading, and
 * a byte-count floor no summary could plausibly clear.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LICENSE_PATH = join(__dirname, 'LICENSE');

describe('extensions/store-exporter/LICENSE (steam-preferences Story 2.3, AC3)', () => {
	it('exists', () => {
		expect(existsSync(LICENSE_PATH)).toBe(true);
	});

	it('is at least 30,000 bytes — a paraphrase or summary could never clear this floor', () => {
		expect(statSync(LICENSE_PATH).size).toBeGreaterThanOrEqual(30_000);
	});

	it('contains the exact GPLv3 title strings', () => {
		const text = readFileSync(LICENSE_PATH, 'utf8');
		expect(text).toContain('GNU GENERAL PUBLIC LICENSE');
		expect(text).toContain('Version 3, 29 June 2007');
	});

	it('contains the TERMS AND CONDITIONS heading', () => {
		const text = readFileSync(LICENSE_PATH, 'utf8');
		expect(text).toContain('TERMS AND CONDITIONS');
	});
});
