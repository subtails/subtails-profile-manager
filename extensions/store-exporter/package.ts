/**
 * The extension's release-packaging pipeline (steam-preferences Story 2.3, AC1).
 *
 * `npx nx run store-exporter:package` turns the shipped `build.ts` output into deterministic,
 * validated, store-submittable artifacts under `dist/extensions/store-exporter/release/`: a Chrome
 * ZIP, a Firefox XPI, a reproducible source archive (Task 2), a `SHA256SUMS.txt`, and a machine-read
 * `submission.json` that `submit.ts` (never this file) reads to perform the actual credentialed
 * upload.
 *
 * WHY THIS BUILDS `chrome`/`firefox` IN-PROCESS RATHER THAN VIA `dependsOn: ['build']`. The same
 * reason `network-surface.test.ts` already records for itself: the whole-repo Vitest aggregate
 * (`npm run test:vitest`) runs this project's tests directly via `vitest.workspace.ts`'s glob,
 * bypassing the Nx task graph entirely, so an Nx `dependsOn` would guarantee nothing there. Calling
 * `buildTarget()` here makes `packageRelease()` self-sufficient: the artifact on disk when it returns
 * is always the one it just built, never a possibly-stale one left over from an earlier `nx build`.
 *
 * WHY THE MANIFEST VALIDATION BELOW DELIBERATELY OVERLAPS `manifest.config.test.ts`. That test
 * asserts the GENERATOR's output object — a plain JS value, in memory, before anything touches disk.
 * This one re-reads the manifest.json BYTES actually about to be zipped and shipped to a human store
 * reviewer. The two are the same property checked at two different layers on purpose; do not
 * "de-duplicate" one of them away — a bug between `buildManifest()`'s return value and the bytes
 * `writeFileSync` puts on disk (encoding, a stale file, a partial write) is exactly the gap a single
 * check at either layer alone would miss.
 *
 * WHY EVERY FILENAME SAYS `-unsigned`. Neither store accepts a locally-signed artifact: the Chrome
 * Web Store signs and packages the CRX server-side after a credentialed upload, and Firefox AMO signs
 * the XPI as part of its own submission/review flow. Signing is a store-side act that follows the
 * credentialed hand-off `submit.ts` performs (Story 2.3, AC2) — nothing this repo can produce is
 * signed, so nothing this repo emits is named as if it were. `submission.json` also records
 * `"signed": false` on every artifact for the same reason.
 */
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTarget, DIST_ROOT, resolveChannel } from './build';
import { EXTENSION_VERSION, type BrowserTarget } from './src/manifest.config';
import { manifestHostPermissions } from './src/adapters';
import { subtailsMatchPatterns } from './src/subtails-origins';
import { REQUIRED_SECRETS } from './submit';

const HERE = __dirname;
const REPO_ROOT = resolve(HERE, '../..');
const RELEASE_DIR = join(DIST_ROOT, 'release');

/**
 * Fixed UTC instant stamped on EVERY zip entry across every archive this file writes. JSZip stamps
 * `new Date()` on each entry by default, which alone would make two runs of the identical source
 * produce different bytes — `package.test.ts` runs `packageRelease()` twice in one test and asserts
 * byte-identical SHA-256 for every artifact, so this constant is what makes that possible.
 */
export const PACKAGE_ENTRY_DATE: Date = new Date('2024-01-01T00:00:00.000Z');

const ZIP_OPTIONS = {
	type: 'nodebuffer' as const,
	streamFiles: false,
	compression: 'DEFLATE' as const,
	compressionOptions: { level: 9 },
};

export interface PackageArtifact {
	readonly file: string;
	readonly store: 'chrome' | 'firefox' | 'source';
	readonly sha256: string;
	readonly bytes: number;
	readonly signed: false;
}

export interface SubmissionManifest {
	readonly version: string;
	readonly channel: 'release';
	readonly generatedFrom: string | null;
	readonly artifacts: readonly PackageArtifact[];
	readonly requiredSecrets: Readonly<Record<string, readonly string[]>>;
}

export interface PackageResult {
	readonly releaseDir: string;
	readonly submission: SubmissionManifest;
}

// -------------------------------------------------------------------------------------------------
// Manifest validation on the emitted bytes (AC1) — re-reads what build.ts already wrote to disk.
// -------------------------------------------------------------------------------------------------

const FORBIDDEN_MANIFEST_KEYS = [
	'cookies',
	'webRequest',
	'webRequestBlocking',
	'tabs',
	'externally_connectable',
	'web_accessible_resources',
	'declarativeNetRequest',
	'identity',
] as const;

/** `\d{1,5}` per part, up to four dot-separated parts — the shape both stores require. */
const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

export class ManifestValidationError extends Error {
	constructor(target: BrowserTarget, rule: string) {
		super(`package.ts: manifest validation failed for "${target}": ${rule}`);
		this.name = 'ManifestValidationError';
	}
}

function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	return a.size === b.size && [...a].every((value) => b.has(value));
}

/** Every file path a manifest's `background`/`icons`/`action.default_icon` fields name. */
function referencedFilePaths(manifest: Record<string, unknown>): string[] {
	const paths = new Set<string>();
	const background = manifest.background as { service_worker?: string; scripts?: string[] } | undefined;
	if (background?.service_worker) paths.add(background.service_worker);
	if (Array.isArray(background?.scripts)) for (const script of background.scripts) paths.add(script);
	for (const entry of (manifest.content_scripts as Array<{ js?: string[] }> | undefined) ?? []) {
		for (const script of entry.js ?? []) paths.add(script);
	}

	const icons = manifest.icons as Record<string, string> | undefined;
	if (icons) for (const iconPath of Object.values(icons)) paths.add(iconPath);

	const actionIcons = (manifest.action as { default_icon?: Record<string, string> } | undefined)?.default_icon;
	if (actionIcons) for (const iconPath of Object.values(actionIcons)) paths.add(iconPath);

	return [...paths];
}

/** Exported so `package.test.ts` can bite each rule individually against a synthetic manifest, not
 * only through the full `packageRelease()` orchestration. */
export function validateBuiltManifest(target: BrowserTarget, outDir: string): void {
	const fail = (rule: string): never => {
		throw new ManifestValidationError(target, rule);
	};

	const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;

	if (manifest.manifest_version !== 3) fail('manifest_version must be exactly 3');

	const version = manifest.version;
	if (typeof version !== 'string' || !VERSION_RE.test(version)) {
		fail('version must match /^\\d{1,5}(\\.\\d{1,5}){0,3}$/');
	} else {
		// Compared as NUMBERS, never against a quoted three-part literal — a version-shaped literal
		// would itself be exactly the shape `store-exporter-version-single-source.guard.test.ts` (AC4)
		// scans this whole project for, and this file is not the one place that constant is allowed to
		// live (only `src/manifest.config.ts`'s `EXTENSION_VERSION` declaration is exempt). That
		// applies to the DIAGNOSTIC STRINGS too: the message below used to spell an example version
		// out, which the guard's broadened (string-contents) detector correctly reads as a second
		// literal. It says the rule in words instead.
		const parts = version.split('.').map(Number);
		if (parts.some((part) => part > 65535)) fail('every version part must be <= 65535');
		if (parts.every((part) => part === 0)) fail('version must not be all-zero (every part zero)');
	}

	const permissions = new Set((manifest.permissions as string[] | undefined) ?? []);
	if (!setEquals(permissions, new Set(['activeTab', 'scripting', 'storage']))) {
		fail('permissions must set-equal ["activeTab", "scripting", "storage"]');
	}

	// The release package carries exactly one content script, on the release subtails origin only, and
	// that origin is the one host grant beyond the stores (the `MAIN` hand-off needs it).
	const subtailsPatterns = subtailsMatchPatterns('release');
	const contentScripts = (manifest.content_scripts as Array<{ matches?: string[]; js?: string[] }> | undefined) ?? [];
	if (
		contentScripts.length !== 1 ||
		!setEquals(new Set(contentScripts[0].matches ?? []), new Set(subtailsPatterns)) ||
		(contentScripts[0].js ?? []).join() !== 'content.js'
	) {
		fail('content_scripts must be exactly one entry running content.js on the release subtails origin only');
	}

	const storeHosts = new Set(manifestHostPermissions());
	const expectedByKey = {
		host_permissions: new Set([...storeHosts, ...subtailsPatterns]),
		optional_host_permissions: storeHosts,
	};
	for (const key of ['host_permissions', 'optional_host_permissions'] as const) {
		const expectedHosts = expectedByKey[key];
		const actual = new Set((manifest[key] as string[] | undefined) ?? []);
		// Checked BEFORE the set-equality rule below: a wildcard addition also fails set-equality
		// (a superset is never equal), but the wildcard-specific message is the more useful failure to
		// surface, so it must win when both are true.
		if (actual.has('<all_urls>')) fail(`${key} must not contain <all_urls>`);
		if (actual.has('*://*/*')) fail(`${key} must not contain *://*/*`);
		if (!setEquals(actual, expectedHosts)) fail(`${key} must set-equal the store hosts${key === 'host_permissions' ? ' plus the subtails origin' : ''}`);
	}

	for (const key of FORBIDDEN_MANIFEST_KEYS) {
		if (Object.prototype.hasOwnProperty.call(manifest, key)) fail(`forbidden manifest key present: "${key}"`);
	}

	const geckoId = (manifest.browser_specific_settings as { gecko?: { id?: string } } | undefined)?.gecko?.id;
	if (target === 'firefox' && !geckoId) fail('firefox manifest must carry browser_specific_settings.gecko.id');
	if (target === 'chrome' && manifest.browser_specific_settings !== undefined) {
		fail('chrome manifest must not carry browser_specific_settings');
	}

	for (const referenced of referencedFilePaths(manifest)) {
		if (!existsSync(join(outDir, referenced))) fail(`manifest-referenced file is missing on disk: ${referenced}`);
	}
}

// -------------------------------------------------------------------------------------------------
// Browser archives — exactly the bundle, nothing else.
// -------------------------------------------------------------------------------------------------

const BROWSER_ARCHIVE_ENTRIES = [
	'manifest.json',
	'background.js',
	'content.js',
	'icons/icon-16.png',
	'icons/icon-32.png',
	'icons/icon-48.png',
	'icons/icon-128.png',
].sort();

/** Every file that actually exists under `outDir`, recursively, as forward-slashed paths relative to
 * `outDir` — independent of `BROWSER_ARCHIVE_ENTRIES`, so it can be reconciled AGAINST that constant
 * rather than compared to itself. */
function listBuiltFiles(outDir: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, rel: string): void => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const relPath = rel ? `${rel}/${entry}` : entry;
			if (statSync(full).isDirectory()) walk(full, relPath);
			else out.push(relPath);
		}
	};
	walk(outDir, '');
	return out.sort();
}

/**
 * Reconciles what `build.ts` actually wrote to `outDir` against the fixed `BROWSER_ARCHIVE_ENTRIES`
 * list (2026-09-04 review finding P0-8). Without this, `copyIcons()`'s unconditional `readdirSync` of
 * `src/icons/` means a fifth icon file dropped into that directory would build, pass
 * `validateBuiltManifest` (which only checks that manifest-REFERENCED files exist, never that the
 * built directory has nothing extra), and then be silently DROPPED from the archive — the previous
 * entry-list test only ever compared `BROWSER_ARCHIVE_ENTRIES` to itself, which cannot catch this by
 * construction. Any mismatch — extra OR missing — fails closed rather than shipping an archive that
 * silently disagrees with what was built.
 */
export function reconcileBrowserArchiveEntries(target: BrowserTarget, outDir: string): void {
	const actual = listBuiltFiles(outDir);
	const expected = [...BROWSER_ARCHIVE_ENTRIES];
	const extra = actual.filter((entry) => !expected.includes(entry));
	const missing = expected.filter((entry) => !actual.includes(entry));
	if (extra.length > 0 || missing.length > 0) {
		throw new ManifestValidationError(
			target,
			`built output at ${outDir} does not match the fixed archive entry list — ` +
				`extra: [${extra.join(', ')}], missing: [${missing.join(', ')}]`,
		);
	}
}

async function buildBrowserArchive(outDir: string): Promise<Buffer> {
	const zip = new JSZip();
	for (const entry of BROWSER_ARCHIVE_ENTRIES) {
		// `createFolders: false` — JSZip's default (true) would silently add an implicit `icons/`
		// directory entry the moment ANY entry has a `/` in its path, which would break AC1's "exactly
		// these six entries, nothing else" equality.
		zip.file(entry, readFileSync(join(outDir, entry)), { date: PACKAGE_ENTRY_DATE, createFolders: false });
	}
	return zip.generateAsync(ZIP_OPTIONS);
}

// -------------------------------------------------------------------------------------------------
// The reproducible source archive (Task 2, AC3 — AMO requires it for bundled/minified code).
// -------------------------------------------------------------------------------------------------

/**
 * Repo-relative paths (from `REPO_ROOT`) of every GIT-TRACKED file under `relDir` — the single source
 * of truth for what ships in the source archive (2026-09-04 review finding P0-8). A live directory
 * walk cannot distinguish a committed file from one an editor or a stray script dropped into this
 * project's own directory: an untracked file would ride along into a store reviewer's hands and move
 * the archive's hash out from under the determinism test, which cannot see the difference either (it
 * runs `packageRelease()` twice in the SAME untouched working tree). `git ls-files` sees only what is
 * actually committed (or staged), so an untracked file — deliberate or accidental — is never included.
 * `.env*` is still filtered explicitly below as a belt-and-braces second layer, even though a
 * git-ignored `.env*` file could never appear in `git ls-files`' output in the first place.
 */
function gitTrackedFiles(relDir: string): string[] {
	const output = execFileSync('git', ['ls-files', '--', relDir], { cwd: REPO_ROOT, encoding: 'utf8' });
	return output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !/(^|\/)\.env/.test(line));
}

async function buildSourceArchive(): Promise<Buffer> {
	const zodLicensePath = join(REPO_ROOT, 'node_modules/zod/LICENSE');
	if (!existsSync(zodLicensePath)) {
		throw new Error(
			'package.ts: node_modules/zod/LICENSE is missing — refusing to ship the source archive without ' +
				"zod's MIT attribution (AC3). Run `npm ci`/`bun install` first.",
		);
	}

	const entries: Array<{ archivePath: string; data: Buffer }> = [];

	for (const rel of gitTrackedFiles('extensions/store-exporter')) {
		entries.push({ archivePath: rel, data: readFileSync(join(REPO_ROOT, rel)) });
	}
	for (const rel of gitTrackedFiles('packages/contracts/src/discovery')) {
		entries.push({ archivePath: rel, data: readFileSync(join(REPO_ROOT, rel)) });
	}

	entries.push({ archivePath: 'package.json', data: readFileSync(join(REPO_ROOT, 'package.json')) });
	entries.push({ archivePath: 'package-lock.json', data: readFileSync(join(REPO_ROOT, 'package-lock.json')) });
	// 2026-09-04 review finding P0-1: `tsconfig.base.json` and `nx.json` were missing — `build.ts`
	// imports `src/manifest.config` → `src/adapters/steam.ts`, which imports
	// `@subtails/contracts/discovery` at RUNTIME, and tsx resolves that specifier only through the
	// `paths` mapping in `tsconfig.base.json` (the archived `tsconfig.json` `extends` it), which
	// `npx nx run store-exporter:build` (BUILD.md step 3) needs `nx.json` to even run. Reproduced
	// against the shipped archive: without these two files, that command fails with `Cannot find
	// module '@subtails/contracts/discovery'`; with them, it succeeds.
	entries.push({ archivePath: 'tsconfig.base.json', data: readFileSync(join(REPO_ROOT, 'tsconfig.base.json')) });
	entries.push({ archivePath: 'nx.json', data: readFileSync(join(REPO_ROOT, 'nx.json')) });
	// `.nvmrc` — the Node version BUILD.md step 1 tells the reviewer to use.
	entries.push({ archivePath: '.nvmrc', data: readFileSync(join(REPO_ROOT, '.nvmrc')) });
	entries.push({ archivePath: 'LICENSE', data: readFileSync(join(HERE, 'LICENSE')) });
	entries.push({ archivePath: 'third-party/zod-LICENSE.txt', data: readFileSync(zodLicensePath) });
	entries.push({ archivePath: 'BUILD.md', data: readFileSync(join(HERE, 'BUILD.md')) });
	// The public source repository's front page: what the extension is and where to install it.
	entries.push({ archivePath: 'README.md', data: readFileSync(join(HERE, 'PUBLIC-README.md')) });

	entries.sort((a, b) => (a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0));

	const zip = new JSZip();
	for (const entry of entries) {
		zip.file(entry.archivePath, entry.data, { date: PACKAGE_ENTRY_DATE, createFolders: false });
	}
	return zip.generateAsync(ZIP_OPTIONS);
}

// -------------------------------------------------------------------------------------------------
// Orchestration.
// -------------------------------------------------------------------------------------------------

function sha256(data: Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

/** The git sha this release was built from, or `null` outside a git checkout — never a hard failure. */
function currentGitSha(): string | null {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

/**
 * Builds both browser bundles in-process, validates their emitted manifests, then zips the Chrome
 * ZIP, the Firefox XPI, and the reproducible source archive into `dist/extensions/store-exporter/
 * release/`, alongside `SHA256SUMS.txt` and `submission.json`. Exported (rather than only
 * auto-running) so `package.test.ts` can call it twice and compare the resulting bytes.
 */
export async function packageRelease(): Promise<PackageResult> {
	const channel = resolveChannel();
	if (channel === 'dev') {
		throw new Error(
			'package.ts: refusing to package a dev-channel build — STORE_EXPORTER_CHANNEL=dev trusts any ' +
				'http://localhost:<port> page as subtails.com, and that must never reach a store. Unset ' +
				'STORE_EXPORTER_CHANNEL (or set it to "release") before packaging.',
		);
	}

	await buildTarget('chrome');
	await buildTarget('firefox');

	validateBuiltManifest('chrome', join(DIST_ROOT, 'chrome'));
	validateBuiltManifest('firefox', join(DIST_ROOT, 'firefox'));
	reconcileBrowserArchiveEntries('chrome', join(DIST_ROOT, 'chrome'));
	reconcileBrowserArchiveEntries('firefox', join(DIST_ROOT, 'firefox'));

	rmSync(RELEASE_DIR, { recursive: true, force: true });
	mkdirSync(RELEASE_DIR, { recursive: true });

	const chromeBytes = await buildBrowserArchive(join(DIST_ROOT, 'chrome'));
	const firefoxBytes = await buildBrowserArchive(join(DIST_ROOT, 'firefox'));
	const sourceBytes = await buildSourceArchive();

	const chromeFile = `subtails-store-exporter-${EXTENSION_VERSION}-chrome-unsigned.zip`;
	const firefoxFile = `subtails-store-exporter-${EXTENSION_VERSION}-firefox-unsigned.xpi`;
	const sourceFile = `subtails-store-exporter-${EXTENSION_VERSION}-source.zip`;

	writeFileSync(join(RELEASE_DIR, chromeFile), chromeBytes);
	writeFileSync(join(RELEASE_DIR, firefoxFile), firefoxBytes);
	writeFileSync(join(RELEASE_DIR, sourceFile), sourceBytes);

	const artifacts: PackageArtifact[] = [
		{ file: chromeFile, store: 'chrome' as const, sha256: sha256(chromeBytes), bytes: chromeBytes.length, signed: false as const },
		{
			file: firefoxFile,
			store: 'firefox' as const,
			sha256: sha256(firefoxBytes),
			bytes: firefoxBytes.length,
			signed: false as const,
		},
		{ file: sourceFile, store: 'source' as const, sha256: sha256(sourceBytes), bytes: sourceBytes.length, signed: false as const },
	].sort((a, b) => (a.file < b.file ? -1 : 1));

	writeFileSync(
		join(RELEASE_DIR, 'SHA256SUMS.txt'),
		`${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`).join('\n')}\n`,
	);

	const submission: SubmissionManifest = {
		version: EXTENSION_VERSION,
		channel: 'release',
		generatedFrom: currentGitSha(),
		artifacts,
		requiredSecrets: REQUIRED_SECRETS,
	};
	writeFileSync(join(RELEASE_DIR, 'submission.json'), `${JSON.stringify(submission, null, 2)}\n`);

	return { releaseDir: RELEASE_DIR, submission };
}

// Only auto-run when this file is the process entry point (`npx tsx package.ts`) — copied verbatim
// from `build.ts`'s own guard so importing this module (as `package.test.ts` does) never triggers a
// build/package as an import side effect.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
	packageRelease()
		.then((result) => {
			console.warn(`store-exporter: packaged release to ${result.releaseDir}`);
		})
		.catch((err: unknown) => {
			console.error(err);
			process.exitCode = 1;
		});
}
