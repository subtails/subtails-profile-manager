/**
 * The adapter registry.
 *
 * `SHIPPED_ADAPTERS` is the one enumeration point for every store this extension supports; adding a
 * store means adding one entry here. `manifestHostPermissions()` is the ONLY source
 * `src/manifest.config.ts` consumes for `host_permissions`, and `adapterForUrlPath` is how
 * `background.ts` picks the adapter for the clicked import page.
 */
import { epicAdapter } from './epic';
import { steamAdapter } from './steam';
import type { StoreExportAdapter } from './types';

export const SHIPPED_ADAPTERS: readonly StoreExportAdapter[] = [steamAdapter, epicAdapter];

/** The sorted, de-duplicated union of every shipped adapter's `hostPermissions`. */
export function manifestHostPermissions(): string[] {
	const union = new Set<string>();
	for (const adapter of SHIPPED_ADAPTERS) {
		for (const permission of adapter.hostPermissions) union.add(permission);
	}
	return Array.from(union).sort();
}

/** The adapter whose import page path prefixes `pathname`, or `undefined`. */
export function adapterForUrlPath(pathname: string): StoreExportAdapter | undefined {
	return SHIPPED_ADAPTERS.find((adapter) => pathname === adapter.importPathPrefix || pathname.startsWith(`${adapter.importPathPrefix}/`));
}

export type { StoreExportAdapter } from './types';
export { steamAdapter } from './steam';
export { epicAdapter } from './epic';
