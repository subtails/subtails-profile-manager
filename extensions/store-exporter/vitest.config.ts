/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

/**
 * Vitest project for `store-exporter` (steam-preferences Story 2.1, AC6).
 *
 * Mirrors `packages/contracts/vitest.config.ts`'s alias shape so `@subtails/contracts/discovery`
 * resolves to the real TS source. `environment: 'node'`, `pool: 'forks'`, and explicit 30s
 * timeouts are the repo-standard shape (`vitest-db-hook-timeout-guard` — never rely on vitest's
 * 5s/10s defaults).
 *
 * Enumerated by the root `vitest.workspace.ts`'s `'extensions/*\/vitest.config.ts'` glob (AC1), so
 * `npm run test:vitest` (the whole-repo aggregate) runs this suite too — without that glob the
 * project's tests would run only under `nx test store-exporter`, invisible to the aggregate.
 */
export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@subtails\/contracts\/(.*)$/,
				replacement: resolve(repoRoot, 'packages/contracts/src') + '/$1/index.ts',
			},
		],
	},
	test: {
		name: 'store-exporter',
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 30000,
		pool: 'forks',
		isolate: true,
		fileParallelism: false,
		// Story 2.3's package.test.ts/submit.test.ts/license.test.ts sit at the PROJECT ROOT, mirroring
		// build.ts/package.ts/submit.ts's own root-level (not src/) placement — hence '*.test.ts' here.
		include: ['*.test.ts', 'src/**/*.spec.ts', 'src/**/*.test.ts'],
	},
});
