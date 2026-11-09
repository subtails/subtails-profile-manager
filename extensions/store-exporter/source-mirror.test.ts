// The source mirror workflow (.github/workflows/extension-source-mirror.yml) copies each released
// version to the public repository. It finds the version with a grep over manifest.config.ts and
// runs only when that file changes, so both must keep matching the one EXTENSION_VERSION literal,
// and the archive it unzips must carry the public README.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EXTENSION_VERSION } from './src/manifest.config';

const ROOT = resolve(__dirname, '../..');
const workflow = readFileSync(join(ROOT, '.github/workflows/extension-source-mirror.yml'), 'utf8');
const manifestConfig = readFileSync(join(__dirname, 'src/manifest.config.ts'), 'utf8');

describe('extension source mirror', () => {
	it("the workflow's version grep finds exactly EXTENSION_VERSION", () => {
		expect(workflow).toContain("grep -oP \"export const EXTENSION_VERSION = '\\K[0-9]+\\.[0-9]+\\.[0-9]+(?=';)\"");
		const found = manifestConfig.match(/export const EXTENSION_VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';/g) ?? [];
		expect(found).toEqual([`export const EXTENSION_VERSION = '${EXTENSION_VERSION}';`]);
	});

	it('runs when the version file changes, pushes to the public repository and never re-copies a tag', () => {
		expect(workflow).toContain('- extensions/store-exporter/src/manifest.config.ts');
		expect(workflow).toContain('MIRROR_REPO: subtails/subtails-profile-manager');
		expect(workflow).toContain('git ls-remote --exit-code --tags');
		expect(workflow).toContain('-source.zip');
	});

	it('the source archive gives the public repository its README', () => {
		const pkg = readFileSync(join(__dirname, 'package.ts'), 'utf8');
		expect(pkg).toContain("archivePath: 'README.md', data: readFileSync(join(HERE, 'PUBLIC-README.md'))");
	});
});
