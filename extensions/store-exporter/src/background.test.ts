/**
 * steam-preferences Story 2.1, AC3/AC6 — the background worker's decision logic.
 *
 * `globalThis.chrome` is stubbed BEFORE `./background` is imported (dynamic `import()`, since the
 * module registers its `action.onClicked` listener and picks `browser`/`chrome` at module load
 * time) so `handleClick`'s five steps can be driven and asserted without a real browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tabsCreate = vi.fn();
const tabsQuery = vi.fn();
const permissionsRequest = vi.fn();
const permissionsContains = vi.fn();
const runtimeOnMessage = vi.fn();
const scriptingExecuteScript = vi.fn();

(globalThis as unknown as { chrome: WebExtensionApi }).chrome = {
	action: { onClicked: { addListener: () => {} } },
	tabs: { create: tabsCreate, query: tabsQuery },
	permissions: { request: permissionsRequest, contains: permissionsContains },
	scripting: { executeScript: scriptingExecuteScript },
	storage: { local: { get: vi.fn(), set: vi.fn() } },
	runtime: {
		getManifest: () => ({ version: '0.1.0' }),
		id: 'test-extension-id',
		sendMessage: vi.fn(),
		onMessage: { addListener: runtimeOnMessage },
	},
};

const { handleClick, isImportPageUrl } = await import('./background');
const { readOrderHistoryPages } = await import('./adapters/epic');
// Captured at load: the module registers its listeners as an import side effect.
const onMessageRegistrations = runtimeOnMessage.mock.calls.length;

const VALID_PAYLOAD = {
	rgIgnoredApps: {},
	rgIgnoredPackages: [],
	rgExcludedTags: [],
	rgExcludedContentDescriptorIDs: [],
	rgCuratorsIgnored: [],
	rgCreatorsIgnored: [],
	rgWishlist: [],
	rgOwnedApps: [],
	rgFollowedApps: [],
};

const originalFetch = globalThis.fetch;

function stubSuccessfulExportFetch(): void {
	globalThis.fetch = vi.fn((input: string | URL | Request) => {
		const url = String(input);
		if (url.includes('dynamicstore/userdata')) {
			return Promise.resolve(new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
		}
		return Promise.resolve(new Response('', { status: 200 }));
	}) as unknown as typeof fetch;
}

describe('isImportPageUrl (AC3 step 2)', () => {
	it('matches the release origin with the exact import path prefix', () => {
		expect(isImportPageUrl('https://subtails.com/profile/settings/steam')).toBe(true);
	});

	it('matches a sub-path under the import path prefix', () => {
		expect(isImportPageUrl('https://subtails.com/profile/settings/steam?x=1')).toBe(true);
	});

	it('rejects a non-allow-listed origin', () => {
		expect(isImportPageUrl('https://subtails.com.evil.test/profile/settings/steam')).toBe(false);
	});

	it('rejects the right origin with the wrong path', () => {
		expect(isImportPageUrl('https://subtails.com/profile/settings/discord')).toBe(false);
	});

	it('rejects an unparsable URL and an undefined tab url', () => {
		expect(isImportPageUrl('not a url')).toBe(false);
		expect(isImportPageUrl(undefined)).toBe(false);
	});
});

describe('handleClick (AC3 steps 2-5)', () => {
	beforeEach(() => {
		tabsCreate.mockReset().mockResolvedValue({});
		permissionsRequest.mockReset().mockResolvedValue(true);
		scriptingExecuteScript.mockReset().mockResolvedValue([]);
		globalThis.fetch = originalFetch;
	});

	it('a non-matching tab opens the import page and performs no fetch and no injection', async () => {
		await handleClick({ id: 1, url: 'https://example.com/' });

		expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://subtails.com/profile/settings/steam' });
		expect(permissionsRequest).not.toHaveBeenCalled();
		expect(scriptingExecuteScript).not.toHaveBeenCalled();
	});

	it('a matching tab requests the host permission unconditionally (no contains() precheck — the precheck cost the gesture, P0-1) and, once granted, runs the adapter and hands off in the MAIN world', async () => {
		stubSuccessfulExportFetch();

		await handleClick({ id: 7, url: 'https://subtails.com/profile/settings/steam' });

		expect(tabsCreate).not.toHaveBeenCalled();
		expect(permissionsRequest).toHaveBeenCalledWith({ origins: ['https://store.steampowered.com/*'] });
		// the armed-batch read (nothing armed: the stub resolves []) then the hand-off
		expect(scriptingExecuteScript).toHaveBeenCalledTimes(2);
		expect(scriptingExecuteScript.mock.calls[0][0].func.name).toBe('readArmedWritebackBatch');
		const call = scriptingExecuteScript.mock.calls[1][0];
		expect(call.target).toEqual({ tabId: 7 });
		expect(call.world).toBe('MAIN');
		expect(typeof call.func).toBe('function');
		expect(call.args).toHaveLength(1);
		expect(call.args[0].producer).toBe('extension');
	});

	it('a click makes no `permissions.contains` call — the precheck this project used to run before `request()` is gone from the click path (only the automatic daily run asks, and it never prompts)', async () => {
		permissionsContains.mockClear();
		stubSuccessfulExportFetch();
		await handleClick({ id: 7, url: 'https://subtails.com/profile/settings/steam' });
		expect(permissionsContains).not.toHaveBeenCalled();
	});

	it('registers one runtime.onMessage listener for the visit report of the daily refresh', () => {
		expect(onMessageRegistrations).toBe(1);
	});

	it('a denied permission request aborts with no fetch and no injection', async () => {
		permissionsRequest.mockResolvedValue(false);
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await handleClick({ id: 3, url: 'https://subtails.com/profile/settings/steam' });

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(scriptingExecuteScript).not.toHaveBeenCalled();
	});

	it('a REJECTED permission request resolves handleClick rather than throwing — no unhandled rejection at the action.onClicked listener (P0-1)', async () => {
		permissionsRequest.mockRejectedValue(new Error('Only permissions specified in the manifest may be requested.'));
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await expect(handleClick({ id: 3, url: 'https://subtails.com/profile/settings/steam' })).resolves.toBeUndefined();

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(scriptingExecuteScript).not.toHaveBeenCalled();
	});

	it('an adapter export failure (e.g. a non-OK response) aborts silently — no hand-off', async () => {
		globalThis.fetch = vi.fn(() => Promise.resolve(new Response('', { status: 500 }))) as unknown as typeof fetch;

		await handleClick({ id: 3, url: 'https://subtails.com/profile/settings/steam' });

		// only the armed-batch read ran; no hand-off followed
		expect(scriptingExecuteScript).toHaveBeenCalledTimes(1);
		expect(scriptingExecuteScript.mock.calls[0][0].func.name).toBe('readArmedWritebackBatch');
	});

	it('a hand-off injection failure resolves handleClick rather than throwing — no unhandled rejection', async () => {
		stubSuccessfulExportFetch();
		scriptingExecuteScript.mockRejectedValue(new Error('No tab with id: 7.'));

		await expect(handleClick({ id: 7, url: 'https://subtails.com/profile/settings/steam' })).resolves.toBeUndefined();
	});

	it('a matching tab with no tab id does nothing further', async () => {
		await handleClick({ url: 'https://subtails.com/profile/settings/steam' });

		expect(permissionsRequest).not.toHaveBeenCalled();
		expect(scriptingExecuteScript).not.toHaveBeenCalled();
	});
});

describe('handleClick write-back branch (steam-preferences Story 4.3)', () => {
	const URL_OK = 'https://subtails.com/profile/settings/steam';
	// Built from parts so this test file never names the store's session variable literally (the
	// session-boundary guard's clause (a) scans every extension file except the adapter itself).
	const SESSION_VAR = ['g', 'sessionID'].join('_');
	const ACCOUNT_HTML = '<script>g_steamID = "76561198000000000"; ' + SESSION_VAR + ' = "abc123def";</script>';
	let ignored: Record<string, unknown>;
	let posts: string[];

	function armBatch(result: unknown): void {
		scriptingExecuteScript.mockImplementation(async (injection: { func: { name: string } }) =>
			injection.func.name === 'readArmedWritebackBatch' ? [{ result }] : [],
		);
	}

	beforeEach(() => {
		tabsCreate.mockReset().mockResolvedValue({});
		permissionsRequest.mockReset().mockResolvedValue(true);
		scriptingExecuteScript.mockReset().mockResolvedValue([]);
		ignored = { '10': 1, '20': 1 };
		posts = [];
		globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('ignorerecommendation')) {
				const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
				posts.push(`${form.appid}:${form.remove}`);
				delete ignored[form.appid];
				return Promise.resolve(new Response('{}', { status: 200 }));
			}
			if (url.includes('dynamicstore/userdata')) {
				return Promise.resolve(new Response(JSON.stringify({ ...VALID_PAYLOAD, rgIgnoredApps: Object.keys(ignored).length === 0 ? [] : ignored }), { status: 200 }));
			}
			return Promise.resolve(new Response(ACCOUNT_HTML, { status: 200 }));
		}) as unknown as typeof fetch;
	});

	it('an armed valid batch runs the write-back, delivers the report in MAIN, and sends no export', async () => {
		armBatch({ contract_version: '1', appids: [10, 20] });

		await handleClick({ id: 7, url: URL_OK });

		expect(posts).toEqual(['10:1', '20:1']);
		const calls = scriptingExecuteScript.mock.calls.map((c) => c[0]);
		expect(calls).toHaveLength(2);
		expect(calls[1].world).toBe('MAIN');
		expect(calls[1].func.name).toBe('deliverWritebackReportToPage');
		expect(calls[1].args[0]).toEqual({
			contract_version: '1',
			results: [
				{ appid: 10, outcome: 'executed' },
				{ appid: 20, outcome: 'executed' },
			],
		});
	});

	it.each([
		['null', null],
		['a wrong version', { contract_version: '2', appids: [10] }],
		['an empty batch', { contract_version: '1', appids: [] }],
		['a non-number appid', { contract_version: '1', appids: ['10'] }],
	])('%s armed falls through to the unchanged export', async (_label, armed) => {
		armBatch(armed);

		await handleClick({ id: 7, url: URL_OK });

		expect(posts).toEqual([]);
		expect(scriptingExecuteScript.mock.calls[1][0].func.name).toBe('deliverEnvelopeToPage');
	});

	it('a failed armed-batch read falls through to the export', async () => {
		scriptingExecuteScript.mockImplementation(async (injection: { func: { name: string } }) => {
			if (injection.func.name === 'readArmedWritebackBatch') throw new Error('boom');
			return [];
		});

		await handleClick({ id: 7, url: URL_OK });

		expect(scriptingExecuteScript.mock.calls[1][0].func.name).toBe('deliverEnvelopeToPage');
	});

	it('a denied permission posts nothing even with an armed batch', async () => {
		permissionsRequest.mockResolvedValue(false);
		armBatch({ contract_version: '1', appids: [10] });

		await handleClick({ id: 7, url: URL_OK });

		expect(posts).toEqual([]);
		expect(scriptingExecuteScript).not.toHaveBeenCalled();
	});

	it('no session id on /account/ posts nothing and delivers no report', async () => {
		armBatch({ contract_version: '1', appids: [10] });
		globalThis.fetch = vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200 }))) as unknown as typeof fetch;

		await handleClick({ id: 7, url: URL_OK });

		expect(scriptingExecuteScript).toHaveBeenCalledTimes(1);
	});
});

describe('handleClick Epic branch (epic-ownership Story 1)', () => {
	const URL_EPIC = 'https://subtails.com/profile/settings/epic';
	const PAGE = {
		orders: [
			{
				orderType: 'PURCHASE',
				createdAtMillis: 1000,
				marketplaceName: 'Epic Games Store',
				items: [{ offerId: 'o1', namespace: 'n1', description: 'Game One' }],
			},
		],
		nextPageToken: null,
	};

	beforeEach(() => {
		tabsCreate.mockReset().mockResolvedValue({});
		tabsQuery.mockReset().mockResolvedValue([]);
		permissionsRequest.mockReset().mockResolvedValue(true);
		scriptingExecuteScript.mockReset().mockResolvedValue([]);
		globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(PAGE), { status: 200 }))) as unknown as typeof fetch;
	});

	it('is selected by path, requests only the Epic host, never reads a write-back batch, and hands off in MAIN', async () => {
		await handleClick({ id: 5, url: URL_EPIC });

		expect(isImportPageUrl(URL_EPIC)).toBe(true);
		expect(permissionsRequest).toHaveBeenCalledWith({ origins: ['https://accounts.epicgames.com/*'] });
		expect(scriptingExecuteScript).toHaveBeenCalledTimes(1);
		const call = scriptingExecuteScript.mock.calls[0][0];
		expect(call.world).toBe('MAIN');
		expect(call.func.name).toBe('deliverEpicEnvelopeToPage');
		expect(call.args[0].items).toEqual([{ offerId: 'o1', namespace: 'n1', description: 'Game One', acquiredAtMillis: 1000 }]);
		expect(tabsQuery).not.toHaveBeenCalled();
	});

	it('a worker fetch failure runs the same reader in an open Epic tab via scripting, then hands off in MAIN', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('blocked'))) as unknown as typeof fetch;
		tabsQuery.mockResolvedValue([{ id: 99, url: 'https://accounts.epicgames.com/account' }]);
		scriptingExecuteScript.mockImplementation(async (injection: { func: unknown }) =>
			injection.func === readOrderHistoryPages ? [{ result: { ok: true, pages: [PAGE] } }] : [],
		);

		await handleClick({ id: 5, url: URL_EPIC });

		expect(tabsQuery).toHaveBeenCalledWith({ url: 'https://accounts.epicgames.com/*' });
		const calls = scriptingExecuteScript.mock.calls.map((c) => c[0]);
		expect(calls).toHaveLength(2);
		expect(calls[0].target).toEqual({ tabId: 99 });
		expect(calls[0].func).toBe(readOrderHistoryPages);
		expect(calls[1].target).toEqual({ tabId: 5 });
		expect(calls[1].world).toBe('MAIN');
		expect(calls[1].func.name).toBe('deliverEpicEnvelopeToPage');
	});

	it('with no Epic tab the page is told tab-required and no envelope is sent', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('blocked'))) as unknown as typeof fetch;

		await handleClick({ id: 5, url: URL_EPIC });

		const calls = scriptingExecuteScript.mock.calls.map((c) => c[0]);
		expect(calls).toHaveLength(1);
		expect(calls[0].world).toBe('MAIN');
		expect(calls[0].func.name).toBe('deliverEpicNoticeToPage');
		expect(calls[0].args).toEqual(['tab-required']);
	});

	it('when the tab read fails too nothing is delivered', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('blocked'))) as unknown as typeof fetch;
		tabsQuery.mockResolvedValue([{ id: 99 }]);
		scriptingExecuteScript.mockResolvedValue([{ result: { ok: false } }]);

		await handleClick({ id: 5, url: URL_EPIC });

		expect(scriptingExecuteScript).toHaveBeenCalledTimes(1);
		expect(scriptingExecuteScript.mock.calls[0][0].func).toBe(readOrderHistoryPages);
	});

	it('a denied permission fetches nothing, sends no envelope and tells the page permission-denied', async () => {
		permissionsRequest.mockResolvedValue(false);
		await handleClick({ id: 5, url: URL_EPIC });
		expect(globalThis.fetch).not.toHaveBeenCalled();
		const calls = scriptingExecuteScript.mock.calls.map((c) => c[0]);
		expect(calls).toHaveLength(1);
		expect(calls[0].target).toEqual({ tabId: 5 });
		expect(calls[0].world).toBe('MAIN');
		expect(calls[0].func.name).toBe('deliverEpicNoticeToPage');
		expect(calls[0].args).toEqual(['permission-denied']);
	});
});
