/**
 * The extension's build script (steam-preferences Story 2.1, AC1, AC6).
 *
 * Bundles `src/background.ts` with the root `esbuild` (`^0.25.0`, already a devDependency — this
 * story adds zero new dependencies), resolving `@subtails/contracts/discovery` through an explicit
 * `alias` to the real TS source and bundling `zod` in, then writes each browser's manifest
 * (`src/manifest.config.ts`, one source) and copies the icons. Emits two complete bundles to the
 * WORKSPACE-ROOT `dist/` (the `packages/*` precedent — the existing eslint `dist/**` ignore and
 * `.gitignore` already cover it):
 *
 *   dist/extensions/store-exporter/chrome/{manifest.json,background.js,icons/*}
 *   dist/extensions/store-exporter/firefox/{manifest.json,background.js,icons/*}
 *
 * Run via `nx build store-exporter` (`project.json`'s `build` target: `npx tsx build.ts`, `cwd`
 * pinned to this directory — the repo's own script-running convention), never invoked directly.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManifest, EXTENSION_VERSION, type BrowserTarget } from './src/manifest.config';

const HERE = __dirname;
const REPO_ROOT = resolve(HERE, '../..');
export const DIST_ROOT = resolve(REPO_ROOT, 'dist/extensions/store-exporter');
const CONTRACTS_DISCOVERY = resolve(REPO_ROOT, 'packages/contracts/src/discovery/index.ts');
const ICONS_DIR = resolve(HERE, 'src/icons');

/**
 * Unsigned dev bundles only (AC8 — signing, GPLv3, and store submission are Story 2.3's). The
 * channel selects the origin allow-list (`subtails-origins.ts`) baked into the bundle.
 *
 * Defaults to RELEASE unless `STORE_EXPORTER_CHANNEL=dev` is explicitly set. An unattended build —
 * `nx build store-exporter`, CI, the exact artifact Task 9 asks a tester to load unpacked — must
 * never silently ship a `dev`-channel bundle: `dev` widens `subtails-origins.ts`'s allow-list to
 * accept ANY `http://localhost:<port>` page as subtails.com, handing that page the player's full
 * Steam preference record and `steamid` over plaintext HTTP on one click. `dev` is opt-in, exercised
 * only by a developer who explicitly sets the env var to test against a local dev server
 * (2026-09-03 review finding P0-2 — the previous default was inverted, failing open in the one
 * direction that matters; the runtime sibling in `subtails-origins.ts` has always failed closed).
 */
export function resolveChannel(env: NodeJS.ProcessEnv = process.env): 'release' | 'dev' {
	return env.STORE_EXPORTER_CHANNEL === 'dev' ? 'dev' : 'release';
}

async function buildBackground(target: BrowserTarget, outDir: string): Promise<void> {
	const channel = resolveChannel();
	const release = `store-exporter.v${EXTENSION_VERSION}`;
	// The content script is a classic script in both browsers, so it is always an IIFE.
	await esbuild.build({
		entryPoints: [resolve(HERE, 'src/content.ts')],
		bundle: true,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		outfile: join(outDir, 'content.js'),
		logLevel: 'warning',
	});
	await esbuild.build({
		entryPoints: [resolve(HERE, 'src/background.ts')],
		bundle: true,
		platform: 'browser',
		// Chrome MV3's service_worker is declared `type: "module"` (manifest.config.ts) and needs an
		// ESM bundle to match; Firefox's event-page `scripts` array loads a classic (non-module)
		// script, so its bundle is an IIFE.
		format: target === 'chrome' ? 'esm' : 'iife',
		target: 'es2022',
		outfile: join(outDir, 'background.js'),
		alias: {
			'@subtails/contracts/discovery': CONTRACTS_DISCOVERY,
		},
		define: {
			__STORE_EXPORTER_RELEASE__: JSON.stringify(release),
			__STORE_EXPORTER_CHANNEL__: JSON.stringify(channel),
		},
		logLevel: 'warning',
	});
}

function copyIcons(outDir: string): void {
	const iconsOutDir = join(outDir, 'icons');
	mkdirSync(iconsOutDir, { recursive: true });
	for (const file of readdirSync(ICONS_DIR)) {
		copyFileSync(join(ICONS_DIR, file), join(iconsOutDir, file));
	}
}

/** Exported so `network-surface.test.ts` can build a real bundle in-process (2026-09-03 review
 * finding P0-3): the whole-repo aggregate (`npm run test:vitest`) runs this Vitest project directly
 * via `vitest.workspace.ts`'s glob, bypassing the Nx task graph entirely, so a `dependsOn: ['build']`
 * in `project.json` would do nothing there — the test must be able to produce the artifact itself. */
export async function buildTarget(target: BrowserTarget): Promise<void> {
	const outDir = join(DIST_ROOT, target);
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });

	await buildBackground(target, outDir);
	copyIcons(outDir);

	const manifest = buildManifest(target, { version: EXTENSION_VERSION, channel: resolveChannel() });
	writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
	await buildTarget('chrome');
	await buildTarget('firefox');
	console.warn(`store-exporter: built ${DIST_ROOT}/{chrome,firefox}`);
}

// Only auto-run when this file is the process entry point (`npx tsx build.ts`) — importing it (as
// `network-surface.test.ts` now does, to build a real bundle for its scan) must not ALSO trigger a
// second, redundant top-level build as an import side effect.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
