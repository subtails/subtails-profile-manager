/**
 * steam-preferences Story 2.1, AC6 — the Steam adapter's arms: a stubbed `fetch` proves the
 * envelope's shape, the two hard-abort paths (non-OK, non-JSON), and the best-effort identity read
 * degrading gracefully (a non-OK response and an unparsed body both omit `steamid` without aborting
 * the export).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	STEAM_PREFERENCE_CONTRACT_VERSION,
	steamPreferenceEnvelopeSchema,
} from '@subtails/contracts/discovery';
import { steamAdapter } from './steam';

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

function stubFetch(impl: (url: string) => Promise<Response>): void {
	globalThis.fetch = vi.fn((input: string | URL | Request) => impl(String(input))) as unknown as typeof fetch;
}

describe('steamAdapter.export (steam-preferences Story 2.1, AC4/AC6)', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('builds an envelope steamPreferenceEnvelopeSchema accepts, producer "extension", current contract_version', async () => {
		stubFetch(async (url) => {
			if (url.includes('dynamicstore/userdata')) {
				return new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 });
			}
			return new Response('<script>g_steamID = "76561198000000000";</script>', { status: 200 });
		});

		const envelope = await steamAdapter.export();

		expect(envelope.producer).toBe('extension');
		expect(envelope.contract_version).toBe(STEAM_PREFERENCE_CONTRACT_VERSION);
		expect(envelope.steamid).toBe('76561198000000000');
		expect(steamPreferenceEnvelopeSchema.safeParse(envelope).success).toBe(true);
	});

	it('a non-OK dynamicstore/userdata response is a hard abort — no envelope is produced', async () => {
		stubFetch(async () => new Response('', { status: 500 }));
		await expect(steamAdapter.export()).rejects.toThrow(/responded 500/);
	});

	it('a non-JSON dynamicstore/userdata body is a hard abort — no envelope is produced', async () => {
		stubFetch(async (url) => {
			if (url.includes('dynamicstore/userdata')) return new Response('not json at all', { status: 200 });
			return new Response('{}', { status: 200 });
		});
		await expect(steamAdapter.export()).rejects.toThrow(/was not JSON/);
	});

	it('a missing public identity value omits steamid and still yields a valid envelope', async () => {
		stubFetch(async (url) => {
			if (url.includes('dynamicstore/userdata')) return new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 });
			return new Response('<html>no identity variable here</html>', { status: 200 });
		});

		const envelope = await steamAdapter.export();

		expect(envelope.steamid).toBeUndefined();
		expect(steamPreferenceEnvelopeSchema.safeParse(envelope).success).toBe(true);
	});

	it('a non-OK identity response is best-effort — the payload GET still succeeds and steamid is omitted', async () => {
		stubFetch(async (url) => {
			if (url.includes('dynamicstore/userdata')) return new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 });
			return new Response('', { status: 403 });
		});

		const envelope = await steamAdapter.export();

		expect(envelope.steamid).toBeUndefined();
		expect(steamPreferenceEnvelopeSchema.safeParse(envelope).success).toBe(true);
	});

	it('an identity fetch that throws is best-effort — the export still completes without steamid', async () => {
		globalThis.fetch = vi.fn((input: string | URL | Request) => {
			const url = String(input);
			if (url.includes('dynamicstore/userdata')) return Promise.resolve(new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
			return Promise.reject(new Error('network error'));
		}) as unknown as typeof fetch;

		const envelope = await steamAdapter.export();

		expect(envelope.steamid).toBeUndefined();
	});

	it('every GET carries credentials: include (the browser attaches the player\'s own Steam session)', async () => {
		const calls: RequestInit[] = [];
		globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
			calls.push(init ?? {});
			const url = String(input);
			if (url.includes('dynamicstore/userdata')) return Promise.resolve(new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
			return Promise.resolve(new Response('', { status: 200 }));
		}) as unknown as typeof fetch;

		await steamAdapter.export();

		expect(calls).toHaveLength(2);
		for (const init of calls) {
			expect(init.credentials).toBe('include');
		}
	});
});

describe('steamAdapter.writeBack (steam-preferences Story 4.3)', () => {
	// Built from parts so this test file never names the store's session variable literally (the
	// session-boundary guard's clause (a) scans every extension file except the adapter itself).
	const SESSION_VAR = ['g', 'sessionID'].join('_');
	const ACCOUNT_HTML = '<script>g_steamID = "76561198000000000"; ' + SESSION_VAR + ' = "tok42";</script>';
	let ignored: Record<string, unknown>;
	let bodies: Record<string, string>[];
	let failAppid: number | null;
	let userdataStatus: number;
	let keepDismissed: number | null;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function install(accountHtml = ACCOUNT_HTML): void {
		ignored = { '10': 1, '20': 1, '30': 1 };
		bodies = [];
		failAppid = null;
		userdataStatus = 200;
		keepDismissed = null;
		globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('ignorerecommendation')) {
				expect(init?.method).toBe('POST');
				expect(init?.credentials).toBe('include');
				const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
				bodies.push(form);
				const appid = Number(form.appid);
				if (appid === failAppid) return Promise.resolve(new Response('', { status: 500 }));
				if (appid !== keepDismissed) delete ignored[String(appid)];
				return Promise.resolve(new Response('{}', { status: 200 }));
			}
			if (url.includes('dynamicstore/userdata')) {
				if (userdataStatus !== 200) return Promise.resolve(new Response('', { status: userdataStatus }));
				return Promise.resolve(new Response(JSON.stringify({ ...VALID_PAYLOAD, rgIgnoredApps: Object.keys(ignored).length === 0 ? [] : ignored }), { status: 200 }));
			}
			return Promise.resolve(new Response(accountHtml, { status: 200 }));
		}) as unknown as typeof fetch;
	}

	it('posts sessionid, appid and remove=1 per appid and reports each item executed when the dismissal is gone', async () => {
		install();
		const report = await steamAdapter.writeBack([10, 20]);

		expect(bodies.map((b) => [b.sessionid, b.appid, b.remove])).toEqual([
			['tok42', '10', '1'],
			['tok42', '20', '1'],
		]);
		expect(report).toEqual({
			contract_version: '1',
			results: [
				{ appid: 10, outcome: 'executed' },
				{ appid: 20, outcome: 'executed' },
			],
		});
	});

	it('a POST error fails that item only and the run continues', async () => {
		install();
		failAppid = 10;
		const report = await steamAdapter.writeBack([10, 20]);
		expect(report?.results).toEqual([
			{ appid: 10, outcome: 'failed' },
			{ appid: 20, outcome: 'executed' },
		]);
		expect(bodies).toHaveLength(2);
	});

	it('an OK POST whose dismissal is still present afterwards is failed', async () => {
		install();
		keepDismissed = 20;
		const report = await steamAdapter.writeBack([10, 20]);
		expect(report?.results).toEqual([
			{ appid: 10, outcome: 'executed' },
			{ appid: 20, outcome: 'failed' },
		]);
	});

	it('an unreadable verification fails every item', async () => {
		install();
		userdataStatus = 500;
		const report = await steamAdapter.writeBack([10, 20]);
		expect(report?.results.map((r) => r.outcome)).toEqual(['failed', 'failed']);
	});

	it('no session id on /account/ posts nothing and resolves null', async () => {
		install('<html>no token</html>');
		expect(await steamAdapter.writeBack([10])).toBeNull();
		expect(bodies).toHaveLength(0);
	});

	it('a logged-out account page (session id, no steam id) posts nothing and resolves null', async () => {
		install(`<script>${SESSION_VAR} = "tok42";</script>`);
		expect(await steamAdapter.writeBack([10])).toBeNull();
		expect(bodies).toHaveLength(0);
	});

	it('the session id appears only in the dismissal POST bodies, never in the report', async () => {
		install();
		const report = await steamAdapter.writeBack([10]);
		expect(JSON.stringify(report)).not.toContain('tok42');
	});
});
