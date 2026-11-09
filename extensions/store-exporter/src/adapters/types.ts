/**
 * The adapter interface every shipped store adapter implements.
 *
 * One interface, one implementation per store (`./steam.ts`, `./epic.ts`), extensible for a future
 * store without touching the manifest generator. `hostPermissions` is the adapter's OWN minimum host
 * grant; `./index.ts`'s `manifestHostPermissions()` computes the manifest's `host_permissions` as the
 * union of every shipped adapter's list, so there is no hand-written host-permission list anywhere in
 * this project. `importPathPrefix` is the subtails page path the adapter serves: `background.ts`
 * selects the adapter by the path of the tab that was clicked.
 *
 * `deliver` and `notice` are MAIN-world functions (`handoff.ts`): `background.ts` serialises them into
 * the page realm, so they must not close over anything. `writeBack` is the Write-Back executor
 * (Steam only): it clears the named dismissals in the player's own browser and returns what it
 * observed.
 */
import type { SteamWritebackReport } from '@subtails/contracts/discovery';

/** What a worker-side adapter run may ask of the background worker. */
export interface ExportContext {
	/**
	 * Runs a self-contained function in an open tab of `origin` (`scripting`, default `ISOLATED` world, so the page cannot observe the read) and
	 * returns its JSON-cloneable result. Rejects with `TabRequiredError` when no such tab is open.
	 */
	runInTab<Args extends unknown[]>(origin: string, func: (...args: Args) => unknown, args: Args): Promise<unknown>;
}

/** No tab of the store's origin is open, so the page reader cannot run. */
export class TabRequiredError extends Error {
	constructor() {
		super('store-exporter: tab-required');
		this.name = 'TabRequiredError';
	}
}

/** The MAIN-world pair of a store's daily automatic run (`handoff.ts`); a store without one is never refreshed automatically. */
export interface AutomaticRefresh {
	/** `true`: the page wants a run; `false`: it does not; `null`: no receiver on the page. */
	readonly probe: () => Promise<boolean | null>;
	/** Resolves `true` only when the page reports the server accepted the envelope. */
	readonly deliver: (envelope: never) => Promise<boolean>;
}

export type AdapterNotice = 'tab-required' | 'permission-denied';

export interface StoreExportAdapter {
	readonly storeKey: 'steam' | 'epic';
	/** The subtails page path this adapter serves (the click is only acted on there). */
	readonly importPathPrefix: string;
	/** This adapter's OWN minimum host permissions: the manifest is built from these, never hand-listed. */
	readonly hostPermissions: readonly string[];
	/** Reads the player's own record in the player's own browser and returns the envelope. Throws on any bad read. */
	export(ctx: ExportContext): Promise<unknown>;
	/** MAIN-world hand-off of the envelope to the page-owned receiver. */
	readonly deliver: (envelope: never) => void;
	/** MAIN-world hand-off of a notice to the page-owned receiver, when the adapter has notices. */
	readonly notice?: (notice: AdapterNotice) => void;
	/** The daily automatic run's page calls. Epic and Steam fill it. */
	readonly automatic?: AutomaticRefresh;
	/**
	 * Removes each appid's dismissal, then observes which are gone. Resolves `null` (nothing posted) when
	 * the store session cannot be read; a per-item failure is reported `failed`, never thrown.
	 */
	readonly writeBack?: (appids: readonly number[]) => Promise<SteamWritebackReport | null>;
}
