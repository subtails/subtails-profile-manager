/**
 * spec-epic-ownership story 5 — the worker's daily automatic refresh (`handleVisit`). `globalThis.chrome`
 * is stubbed BEFORE `./auto-refresh` loads. The page is faked through `scripting.executeScript`: the
 * probe and the deliver function are told apart by identity, and the Epic read is a spy on the adapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = new Map<string, unknown>();
const permissionsContains = vi.fn();
const permissionsRequest = vi.fn();
const tabsCreate = vi.fn();
const executeScript = vi.fn();

(globalThis as unknown as { chrome: WebExtensionApi }).chrome = {
	action: { onClicked: { addListener: () => {} } },
	tabs: { create: tabsCreate, query: vi.fn() },
	permissions: { request: permissionsRequest, contains: permissionsContains },
	scripting: { executeScript },
	storage: {
		local: {
			get: async (key: string) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
			set: async (items: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(items)) storage.set(key, value);
			},
		},
	},
	runtime: { getManifest: () => ({ version: '1.0.0' }), id: 'own-id', sendMessage: vi.fn(), onMessage: { addListener: () => {} } },
};

const { handleVisit, resetAutoRefreshState, lastRunStorageKey, trustedTabId, isVisitMessage, REFRESH_INTERVAL_MS, FAILURE_BACKOFF_MS } = await import('./auto-refresh');
const { epicAdapter } = await import('./adapters/epic');
const { steamAdapter } = await import('./adapters/steam');
const { probeEpicAutoRefresh, deliverEpicEnvelopeAutomatically, probeSteamAutoRefresh, deliverSteamEnvelopeAutomatically } = await import('./handoff');

const KEY = lastRunStorageKey('epic');
const STEAM_KEY = lastRunStorageKey('steam');
const NOW = 1_800_000_000_000;
const SENDER = { id: 'own-id', tab: { id: 5, url: 'https://subtails.com/free-games' } };
const ENVELOPE = { contract_version: '1', items: [] };

let probeAnswers: Array<boolean | null>;
let deliverAnswer: boolean;
let exportSpy: ReturnType<typeof vi.spyOn>;
let steamExportSpy: ReturnType<typeof vi.spyOn>;
let steamProbeAnswer: boolean | null;
let steamDeliverAnswer: boolean;
const STEAM_ENVELOPE = { contract_version: '1', producer: 'extension', steamid: '76561198000000042', payload: {} };
const deps = { now: () => NOW, sleep: vi.fn(async () => {}) };

beforeEach(() => {
	storage.clear();
	// Steam is not due unless a test says so, so the Epic cases below see only the Epic run.
	storage.set(STEAM_KEY, NOW);
	steamProbeAnswer = true;
	steamDeliverAnswer = true;
	resetAutoRefreshState();
	probeAnswers = [true];
	deliverAnswer = true;
	permissionsContains.mockReset().mockResolvedValue(true);
	permissionsRequest.mockReset();
	tabsCreate.mockReset();
	deps.sleep.mockClear();
	executeScript.mockReset().mockImplementation(async (injection: { func: unknown; world?: string }) => {
		if (injection.func === probeEpicAutoRefresh) return [{ result: probeAnswers.length > 1 ? probeAnswers.shift() : probeAnswers[0] }];
		if (injection.func === deliverEpicEnvelopeAutomatically) return [{ result: deliverAnswer }];
		if (injection.func === probeSteamAutoRefresh) return [{ result: steamProbeAnswer }];
		if (injection.func === deliverSteamEnvelopeAutomatically) return [{ result: steamDeliverAnswer }];
		return [];
	});
	exportSpy?.mockRestore();
	exportSpy = vi.spyOn(epicAdapter, 'export').mockResolvedValue(ENVELOPE as never);
	steamExportSpy?.mockRestore();
	steamExportSpy = vi.spyOn(steamAdapter, 'export').mockResolvedValue(STEAM_ENVELOPE as never);
});

const delivered = () => executeScript.mock.calls.filter(([i]) => i.func === deliverEpicEnvelopeAutomatically);

describe('a due, wanted run', () => {
	it('exports, hands the envelope to the page in the MAIN world and stores the time of the success only', async () => {
		await handleVisit(SENDER, deps);

		expect(exportSpy).toHaveBeenCalledTimes(1);
		expect(delivered()).toHaveLength(1);
		expect(delivered()[0][0]).toMatchObject({ target: { tabId: 5 }, world: 'MAIN', args: [ENVELOPE] });
		expect(storage.get(KEY)).toBe(NOW);
		expect(permissionsRequest).not.toHaveBeenCalled();
		expect(tabsCreate).not.toHaveBeenCalled();
	});

	it('runs again once the last success is a day old', async () => {
		storage.set(KEY, NOW - REFRESH_INTERVAL_MS);
		await handleVisit(SENDER, deps);
		expect(exportSpy).toHaveBeenCalledTimes(1);
	});
});

describe('the cases that stay silent', () => {
	it('not due: a success under 24 hours ago means no probe and no Epic request', async () => {
		storage.set(KEY, NOW - REFRESH_INTERVAL_MS + 1000);
		await handleVisit(SENDER, deps);
		expect(executeScript).not.toHaveBeenCalled();
		expect(exportSpy).not.toHaveBeenCalled();
		expect(storage.get(KEY)).toBe(NOW - REFRESH_INTERVAL_MS + 1000);
	});

	it('stopped: the probe says no, so nothing is read and nothing is stored', async () => {
		probeAnswers = [false];
		await handleVisit(SENDER, deps);
		expect(exportSpy).not.toHaveBeenCalled();
		expect(storage.has(KEY)).toBe(false);
	});

	it('signed out: no receiver on the page, asked a few times, then no Epic request', async () => {
		probeAnswers = [null];
		await handleVisit(SENDER, deps);
		expect(executeScript.mock.calls.length).toBeGreaterThan(1);
		expect(deps.sleep).toHaveBeenCalled();
		expect(exportSpy).not.toHaveBeenCalled();
		expect(storage.has(KEY)).toBe(false);
	});

	it('a receiver that registers late is found by a retry', async () => {
		probeAnswers = [null, true];
		await handleVisit(SENDER, deps);
		expect(exportSpy).toHaveBeenCalledTimes(1);
		expect(storage.get(KEY)).toBe(NOW);
	});

	it('no grant: no probe, no request, no prompt', async () => {
		permissionsContains.mockResolvedValue(false);
		await handleVisit(SENDER, deps);
		expect(executeScript).not.toHaveBeenCalled();
		expect(exportSpy).not.toHaveBeenCalled();
		expect(permissionsRequest).not.toHaveBeenCalled();
	});

	it('no Epic session: the read fails, nothing is delivered or stored, and the next try waits 10 minutes', async () => {
		exportSpy.mockRejectedValue(new Error('no session'));
		await handleVisit(SENDER, deps);
		expect(delivered()).toHaveLength(0);
		expect(storage.has(KEY)).toBe(false);

		await handleVisit(SENDER, deps);
		expect(exportSpy).toHaveBeenCalledTimes(1);

		await handleVisit(SENDER, { ...deps, now: () => NOW + FAILURE_BACKOFF_MS });
		expect(exportSpy).toHaveBeenCalledTimes(2);
	});

	it('the server rejects: the page answers false, so no time is stored', async () => {
		deliverAnswer = false;
		await handleVisit(SENDER, deps);
		expect(delivered()).toHaveLength(1);
		expect(storage.has(KEY)).toBe(false);
	});
});

describe('two tabs at once', () => {
	it('run the store once', async () => {
		await Promise.all([handleVisit(SENDER, deps), handleVisit({ ...SENDER, tab: { id: 6, url: 'https://subtails.com/' } }, deps)]);
		expect(exportSpy).toHaveBeenCalledTimes(1);
		expect(delivered()).toHaveLength(1);
	});
});

describe('the sender check', () => {
	it.each([
		['another extension', { id: 'other-id', tab: SENDER.tab }],
		['no extension id', { tab: SENDER.tab }],
		['a tab off the subtails origins', { id: 'own-id', tab: { id: 5, url: 'https://evil.test/' } }],
		['a look-alike origin', { id: 'own-id', tab: { id: 5, url: 'https://subtails.com.evil.test/' } }],
		['a localhost tab on a release build', { id: 'own-id', tab: { id: 5, url: 'http://localhost:3000/' } }],
		['no tab', { id: 'own-id' }],
		['a tab without an id', { id: 'own-id', tab: { url: 'https://subtails.com/' } }],
		['no sender', undefined],
	])('ignores %s', async (_label, sender) => {
		expect(trustedTabId(sender)).toBeNull();
		await handleVisit(sender, deps);
		expect(permissionsContains).not.toHaveBeenCalled();
		expect(executeScript).not.toHaveBeenCalled();
		expect(exportSpy).not.toHaveBeenCalled();
	});

	it('accepts the own content script on the release origin', () => {
		expect(trustedTabId(SENDER)).toBe(5);
	});

	it('recognises only the visit message', () => {
		expect(isVisitMessage({ kind: 'subtails-visit' })).toBe(true);
		expect(isVisitMessage({ kind: 'other' })).toBe(false);
		expect(isVisitMessage(null)).toBe(false);
	});
});

describe('the Steam run (spec-epic-ownership story 6)', () => {
	const steamDelivered = () => executeScript.mock.calls.filter(([i]) => i.func === deliverSteamEnvelopeAutomatically);

	beforeEach(() => {
		storage.delete(STEAM_KEY);
		storage.set(KEY, NOW); // Epic is not due
	});

	it('a due, wanted run reads the record, hands it to the page in the MAIN world and stores the Steam time only', async () => {
		await handleVisit(SENDER, deps);

		expect(steamExportSpy).toHaveBeenCalledTimes(1);
		expect(steamDelivered()).toHaveLength(1);
		expect(steamDelivered()[0][0]).toMatchObject({ target: { tabId: 5 }, world: 'MAIN', args: [STEAM_ENVELOPE] });
		expect(storage.get(STEAM_KEY)).toBe(NOW);
		expect(exportSpy).not.toHaveBeenCalled();
		expect(permissionsRequest).not.toHaveBeenCalled();
		expect(tabsCreate).not.toHaveBeenCalled();
	});

	it('after the player deleted their preferences the probe says no: no Steam request, no time stored', async () => {
		steamProbeAnswer = false;
		await handleVisit(SENDER, deps);
		expect(steamExportSpy).not.toHaveBeenCalled();
		expect(steamDelivered()).toHaveLength(0);
		expect(storage.has(STEAM_KEY)).toBe(false);
	});

	it('a rejected delivery stores no time and the next visit within 10 minutes does not retry', async () => {
		steamDeliverAnswer = false;
		await handleVisit(SENDER, deps);
		expect(steamDelivered()).toHaveLength(1);
		expect(storage.has(STEAM_KEY)).toBe(false);

		await handleVisit(SENDER, deps);
		expect(steamExportSpy).toHaveBeenCalledTimes(1);
	});

	it('an unreadable Steam record (no session) delivers nothing', async () => {
		steamExportSpy.mockRejectedValue(new Error('not signed in'));
		await handleVisit(SENDER, deps);
		expect(steamDelivered()).toHaveLength(0);
		expect(storage.has(STEAM_KEY)).toBe(false);
	});

	it('each store keeps its own 24 hour cap: a due Epic run does not make Steam due', async () => {
		storage.set(STEAM_KEY, NOW);
		storage.delete(KEY);
		await handleVisit(SENDER, deps);
		expect(exportSpy).toHaveBeenCalledTimes(1);
		expect(steamExportSpy).not.toHaveBeenCalled();
	});
});
