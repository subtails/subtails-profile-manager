/**
 * steam-preferences Story 2.3, AC1/AC3 — the release-packaging pipeline.
 *
 * Builds REAL bundles in-process via `packageRelease()` (the same reason `network-surface.test.ts`
 * and `package.ts`'s own docblock give: the whole-repo Vitest aggregate bypasses the Nx task graph
 * entirely). Every test that calls `packageRelease()` leaves the shared `dist/extensions/
 * store-exporter/release/` directory in a valid (release-channel, current) state afterward, mirroring
 * `network-surface.test.ts`'s own `finally` discipline.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { packageRelease, validateBuiltManifest, reconcileBrowserArchiveEntries, PACKAGE_ENTRY_DATE } from './package';
import { DIST_ROOT } from './build';
import { EXTENSION_VERSION } from './src/manifest.config';
import { manifestHostPermissions } from './src/adapters';

const CHROME_ZIP = `subtails-store-exporter-${EXTENSION_VERSION}-chrome-unsigned.zip`;
const FIREFOX_XPI = `subtails-store-exporter-${EXTENSION_VERSION}-firefox-unsigned.xpi`;
const SOURCE_ZIP = `subtails-store-exporter-${EXTENSION_VERSION}-source.zip`;

afterEach(() => {
	// Leave the channel env var exactly as every other test in this project expects it: unset
	// (`resolveChannel()`'s own release-by-default posture).
	delete process.env.STORE_EXPORTER_CHANNEL;
});

async function entryNames(buffer: Buffer): Promise<string[]> {
	const zip = await JSZip.loadAsync(buffer);
	return Object.keys(zip.files).sort();
}

describe('packageRelease() (steam-preferences Story 2.3, AC1)', () => {
	it('refuses a dev-channel build, naming STORE_EXPORTER_CHANNEL, and writes nothing', async () => {
		process.env.STORE_EXPORTER_CHANNEL = 'dev';
		await expect(packageRelease()).rejects.toThrow(/STORE_EXPORTER_CHANNEL/);
	});

	it('produces byte-identical artifacts across two runs (determinism)', async () => {
		const first = await packageRelease();
		const firstBytes = {
			chrome: readFileSync(join(first.releaseDir, CHROME_ZIP)),
			firefox: readFileSync(join(first.releaseDir, FIREFOX_XPI)),
			source: readFileSync(join(first.releaseDir, SOURCE_ZIP)),
		};

		const second = await packageRelease();
		const secondBytes = {
			chrome: readFileSync(join(second.releaseDir, CHROME_ZIP)),
			firefox: readFileSync(join(second.releaseDir, FIREFOX_XPI)),
			source: readFileSync(join(second.releaseDir, SOURCE_ZIP)),
		};

		expect(firstBytes.chrome.equals(secondBytes.chrome)).toBe(true);
		expect(firstBytes.firefox.equals(secondBytes.firefox)).toBe(true);
		expect(firstBytes.source.equals(secondBytes.source)).toBe(true);

		const findArtifact = (submission: typeof first.submission, store: string) =>
			submission.artifacts.find((artifact) => artifact.store === store);
		expect(findArtifact(first.submission, 'chrome')?.sha256).toBe(findArtifact(second.submission, 'chrome')?.sha256);
		expect(findArtifact(first.submission, 'firefox')?.sha256).toBe(
			findArtifact(second.submission, 'firefox')?.sha256,
		);
		expect(findArtifact(first.submission, 'source')?.sha256).toBe(findArtifact(second.submission, 'source')?.sha256);
	}, 30000);

	it('the Chrome archive contains exactly manifest.json, background.js, content.js, and the four icons — nothing else', async () => {
		const result = await packageRelease();
		const names = await entryNames(readFileSync(join(result.releaseDir, CHROME_ZIP)));
		expect(names).toEqual(
			['background.js', 'content.js', 'icons/icon-128.png', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'manifest.json'].sort(),
		);
	}, 30000);

	it('the Firefox archive (an XPI, same writer) contains the identical entry set', async () => {
		const result = await packageRelease();
		const names = await entryNames(readFileSync(join(result.releaseDir, FIREFOX_XPI)));
		expect(names).toEqual(
			['background.js', 'content.js', 'icons/icon-128.png', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'manifest.json'].sort(),
		);
	}, 30000);

	it('the source archive contains the exact files AC3 names, and excludes node_modules and .env*', async () => {
		const result = await packageRelease();
		const zip = await JSZip.loadAsync(readFileSync(join(result.releaseDir, SOURCE_ZIP)));
		const names = Object.keys(zip.files);

		expect(names).toContain('extensions/store-exporter/src/background.ts');
		expect(names).toContain('packages/contracts/src/discovery/index.ts');
		expect(names).toContain('LICENSE');
		expect(names).toContain('BUILD.md');
		expect(names).toContain('README.md');
		expect(names).toContain('third-party/zod-LICENSE.txt');
		expect(names).toContain('package.json');
		expect(names).toContain('package-lock.json');
		// 2026-09-04 review finding P0-1: without these two, BUILD.md's own step 3
		// (`npx nx run store-exporter:build`) fails with "Cannot find module
		// '@subtails/contracts/discovery'" against the extracted archive — tsx resolves that runtime
		// import only through tsconfig.base.json's `paths`, and needs nx.json to run the nx target at
		// all. `.nvmrc` is the Node version BUILD.md step 1 names.
		expect(names).toContain('tsconfig.base.json');
		expect(names).toContain('nx.json');
		expect(names).toContain('.nvmrc');

		expect(names.some((name) => name.includes('node_modules/'))).toBe(false);
		expect(names.some((name) => /(^|\/)\.env/.test(name))).toBe(false);
	}, 30000);

	it('writes SHA256SUMS.txt as one "<sha256>  <filename>" line per artifact, sorted by filename', async () => {
		const result = await packageRelease();
		const text = readFileSync(join(result.releaseDir, 'SHA256SUMS.txt'), 'utf8');
		const lines = text.trim().split('\n');
		expect(lines).toHaveLength(3);
		for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64} {2}\S+$/);
		const filenames = lines.map((line) => line.split('  ')[1]);
		expect(filenames).toEqual([...filenames].sort());
	}, 30000);

	it('writes submission.json with the AC1 shape, "signed": false on every artifact, and the AC2 required-secrets lists', async () => {
		const result = await packageRelease();
		const submission = JSON.parse(readFileSync(join(result.releaseDir, 'submission.json'), 'utf8'));

		expect(submission.version).toBe(EXTENSION_VERSION);
		expect(submission.channel).toBe('release');
		expect(['string', 'object']).toContain(typeof submission.generatedFrom); // string sha, or null
		expect(Array.isArray(submission.artifacts)).toBe(true);
		expect(submission.artifacts).toHaveLength(3);
		for (const artifact of submission.artifacts) {
			expect(artifact.signed).toBe(false);
			expect(typeof artifact.sha256).toBe('string');
			expect(artifact.sha256).toHaveLength(64);
			expect(typeof artifact.bytes).toBe('number');
		}
		expect(submission.requiredSecrets.chrome).toEqual([
			'CHROME_WEB_STORE_EXTENSION_ID',
			'CHROME_WEB_STORE_CLIENT_ID',
			'CHROME_WEB_STORE_CLIENT_SECRET',
			'CHROME_WEB_STORE_REFRESH_TOKEN',
		]);
		expect(submission.requiredSecrets.firefox).toEqual(['AMO_JWT_ISSUER', 'AMO_JWT_SECRET']);
	}, 30000);

	it('AC4: both emitted manifests on disk carry version === EXTENSION_VERSION, the single source (2026-09-04 review finding P0-4 — build.ts passing buildManifest() a different value must fail here)', async () => {
		await packageRelease();
		const chromeManifest = JSON.parse(readFileSync(join(DIST_ROOT, 'chrome', 'manifest.json'), 'utf8'));
		const firefoxManifest = JSON.parse(readFileSync(join(DIST_ROOT, 'firefox', 'manifest.json'), 'utf8'));
		expect(chromeManifest.version).toBe(EXTENSION_VERSION);
		expect(firefoxManifest.version).toBe(EXTENSION_VERSION);
	}, 30000);

	it('every artifact filename says "-unsigned" (chrome/firefox) or is the plain source archive', async () => {
		const result = await packageRelease();
		expect(existsSync(join(result.releaseDir, CHROME_ZIP))).toBe(true);
		expect(existsSync(join(result.releaseDir, FIREFOX_XPI))).toBe(true);
		expect(CHROME_ZIP).toContain('-unsigned');
		expect(FIREFOX_XPI).toContain('-unsigned');
	}, 30000);
});

// -----------------------------------------------------------------------------------------------
// Manifest validation, rule by rule, against synthetic (not built) manifests (AC1).
// -----------------------------------------------------------------------------------------------

describe('validateBuiltManifest (steam-preferences Story 2.3, AC1) — each rule bites on a synthetic bad manifest', () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	function baseChromeManifest(): Record<string, unknown> {
		return {
			manifest_version: 3,
			name: 'subtails Profile Manager',
			version: '1.0.0',
			description: 'test fixture',
			action: { default_title: 'x', default_icon: iconPaths() },
			permissions: ['activeTab', 'scripting', 'storage'],
			host_permissions: [...manifestHostPermissions(), 'https://subtails.com/*'],
			optional_host_permissions: manifestHostPermissions(),
			content_scripts: [{ matches: ['https://subtails.com/*'], js: ['content.js'] }],
			icons: iconPaths(),
			background: { service_worker: 'background.js', type: 'module' },
		};
	}

	function baseFirefoxManifest(): Record<string, unknown> {
		const { action: _action, ...shared } = baseChromeManifest();
		void _action;
		return {
			...shared,
			action: { default_title: 'x', default_icon: iconPaths() },
			background: { scripts: ['background.js'] },
			browser_specific_settings: { gecko: { id: 'store-exporter@subtails.com', strict_min_version: '127.0' } },
		};
	}

	function iconPaths(): Record<string, string> {
		return {
			'16': 'icons/icon-16.png',
			'32': 'icons/icon-32.png',
			'48': 'icons/icon-48.png',
			'128': 'icons/icon-128.png',
		};
	}

	/** Writes `manifest.json` plus every file it references, so only the ONE mutated rule can fail. */
	function writeFixture(manifest: Record<string, unknown>): string {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'store-exporter-manifest-fixture-'));
		mkdirSync(join(fixtureDir, 'icons'), { recursive: true });
		writeFileSync(join(fixtureDir, 'manifest.json'), JSON.stringify(manifest));
		writeFileSync(join(fixtureDir, 'background.js'), '// fixture');
		writeFileSync(join(fixtureDir, 'content.js'), '// fixture');
		for (const iconPath of Object.values(iconPaths())) writeFileSync(join(fixtureDir, iconPath), 'fixture');
		return fixtureDir;
	}

	it('a valid Chrome manifest passes', () => {
		dir = writeFixture(baseChromeManifest());
		expect(() => validateBuiltManifest('chrome', dir)).not.toThrow();
	});

	it('a valid Firefox manifest passes', () => {
		dir = writeFixture(baseFirefoxManifest());
		expect(() => validateBuiltManifest('firefox', dir)).not.toThrow();
	});

	it('bites manifest_version !== 3', () => {
		dir = writeFixture({ ...baseChromeManifest(), manifest_version: 2 });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/manifest_version/);
	});

	it('bites a version that does not match the expected shape', () => {
		dir = writeFixture({ ...baseChromeManifest(), version: 'not-a-version' });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/version/);
	});

	it('bites a version part over 65535', () => {
		dir = writeFixture({ ...baseChromeManifest(), version: '99999.0.0' });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/65535/);
	});

	it('bites an all-zero version', () => {
		dir = writeFixture({ ...baseChromeManifest(), version: '0.0.0' });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/all-zero/);
	});

	it('bites a permissions set that is not exactly ["activeTab","scripting","storage"]', () => {
		dir = writeFixture({ ...baseChromeManifest(), permissions: ['tabs'] });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/permissions/);
	});

	it('bites host_permissions that do not set-equal manifestHostPermissions()', () => {
		dir = writeFixture({ ...baseChromeManifest(), host_permissions: [] });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/host_permissions/);
	});

	it('bites optional_host_permissions that do not set-equal manifestHostPermissions()', () => {
		dir = writeFixture({ ...baseChromeManifest(), optional_host_permissions: [] });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/optional_host_permissions/);
	});

	it('bites host_permissions without the subtails origin, and one with localhost', () => {
		dir = writeFixture({ ...baseChromeManifest(), host_permissions: manifestHostPermissions() });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/host_permissions/);
		rmSync(dir, { recursive: true, force: true });
		dir = writeFixture({ ...baseChromeManifest(), host_permissions: [...manifestHostPermissions(), 'https://subtails.com/*', 'http://localhost/*'] });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/host_permissions/);
	});

	it.each([
		['no content script', []],
		['a second content script', [{ matches: ['https://subtails.com/*'], js: ['content.js'] }, { matches: ['https://subtails.com/*'], js: ['content.js'] }]],
		['a content script on another origin', [{ matches: ['https://example.com/*'], js: ['content.js'] }]],
		['a content script on all urls', [{ matches: ['<all_urls>'], js: ['content.js'] }]],
		['a content script running another file', [{ matches: ['https://subtails.com/*'], js: ['background.js'] }]],
	])('bites %s', (_label, contentScripts) => {
		dir = writeFixture({ ...baseChromeManifest(), content_scripts: contentScripts });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/content_scripts/);
	});

	it('bites host_permissions containing <all_urls>', () => {
		dir = writeFixture({ ...baseChromeManifest(), host_permissions: [...manifestHostPermissions(), '<all_urls>'] });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/all_urls/);
	});

	it('bites host_permissions containing *://*/*', () => {
		dir = writeFixture({ ...baseChromeManifest(), host_permissions: [...manifestHostPermissions(), '*://*/*'] });
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/\*:\/\/\*\/\*/);
	});

	it.each(['cookies', 'webRequest', 'webRequestBlocking', 'tabs', 'externally_connectable', 'web_accessible_resources', 'declarativeNetRequest', 'identity'])(
		'bites the forbidden top-level key "%s"',
		(key) => {
			dir = writeFixture({ ...baseChromeManifest(), [key]: [] });
			expect(() => validateBuiltManifest('chrome', dir)).toThrow(new RegExp(key));
		},
	);

	it('bites a Firefox manifest with no browser_specific_settings.gecko.id', () => {
		const manifest = baseFirefoxManifest();
		delete (manifest as { browser_specific_settings?: unknown }).browser_specific_settings;
		dir = writeFixture(manifest);
		expect(() => validateBuiltManifest('firefox', dir)).toThrow(/gecko/);
	});

	it('bites a Chrome manifest that carries browser_specific_settings', () => {
		dir = writeFixture({
			...baseChromeManifest(),
			browser_specific_settings: { gecko: { id: 'x' } },
		});
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/browser_specific_settings/);
	});

	it('bites a manifest-referenced file missing on disk', () => {
		dir = writeFixture(baseChromeManifest());
		rmSync(join(dir, 'background.js'));
		expect(() => validateBuiltManifest('chrome', dir)).toThrow(/background\.js/);
	});
});

// -----------------------------------------------------------------------------------------------
// Archive/built-output reconciliation (2026-09-04 review finding P0-8) — `validateBuiltManifest`
// only checks manifest-REFERENCED files exist; it says nothing about a file that exists on disk but
// is absent from the manifest and from `BROWSER_ARCHIVE_ENTRIES`, which is exactly how a fifth icon
// built by `copyIcons()`'s unconditional `readdirSync` would silently be dropped from the archive.
// -----------------------------------------------------------------------------------------------

describe('reconcileBrowserArchiveEntries (steam-preferences Story 2.3, AC1/AC3 — P0-8)', () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	function writeBuiltOutput(): string {
		const outDir = mkdtempSync(join(tmpdir(), 'store-exporter-archive-reconcile-'));
		mkdirSync(join(outDir, 'icons'), { recursive: true });
		writeFileSync(join(outDir, 'manifest.json'), '{}');
		writeFileSync(join(outDir, 'background.js'), '// fixture');
		writeFileSync(join(outDir, 'content.js'), '// fixture');
		for (const name of ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png']) {
			writeFileSync(join(outDir, 'icons', name), 'fixture');
		}
		return outDir;
	}

	it('passes when the built directory contains exactly the fixed entry list', () => {
		dir = writeBuiltOutput();
		expect(() => reconcileBrowserArchiveEntries('chrome', dir)).not.toThrow();
	});

	it('bites a fifth, unexpected file built into the output directory (the "extra icon" class)', () => {
		dir = writeBuiltOutput();
		writeFileSync(join(dir, 'icons', 'icon-256.png'), 'fixture');
		expect(() => reconcileBrowserArchiveEntries('chrome', dir)).toThrow(/icons\/icon-256\.png/);
	});

	it('bites a missing expected file (the built output is short of the fixed entry list)', () => {
		dir = writeBuiltOutput();
		rmSync(join(dir, 'icons', 'icon-16.png'));
		expect(() => reconcileBrowserArchiveEntries('chrome', dir)).toThrow(/icons\/icon-16\.png/);
	});
});

// Sanity: the exported entry-date constant is the fixed instant the docblock promises, not "now".
describe('PACKAGE_ENTRY_DATE', () => {
	it('is a fixed UTC instant, not a moving one', () => {
		expect(PACKAGE_ENTRY_DATE.toISOString()).toBe('2024-01-01T00:00:00.000Z');
	});
});
