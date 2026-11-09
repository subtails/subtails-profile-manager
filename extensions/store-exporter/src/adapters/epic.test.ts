/**
 * epic-ownership Story 1: the Epic adapter. Synthetic fixture only (measured shape, invented values).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	epicAdapter,
	netOwnedItems,
	orderHistoryPageSchema,
	readOrderHistoryPages,
	MAX_ORDER_HISTORY_PAGES,
	EPIC_OWNERSHIP_CONTRACT_VERSION,
} from './epic';
import { TabRequiredError, type ExportContext } from './types';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const ENDPOINT = 'https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory?sortDir=DESC&sortBy=DATE&locale=en-US';

interface FixtureItem {
	offerId: string;
	namespace: string;
	description: string;
	giftRecipient?: string | null;
}

function order(
	orderType: string,
	createdAtMillis: number,
	items: FixtureItem[],
	marketplaceName = 'Epic Games Store',
	totalAmount = 1999,
) {
	return {
		orderType,
		canSendReceipt: true,
		orderId: `ORDER-SECRET-${createdAtMillis}`,
		createdAtMillis,
		items: items.map((item) => ({ quantity: 1, amount: 4242, currency: 'EUR', giftRecipient: null, ...item })),
		merchantGroup: 'MERCHANT-GROUP-SECRET',
		transactions: [{ id: 'TX-SECRET' }],
		promotions: [{ id: 'PROMO-SECRET' }],
		marketplaceName,
		subtotal: 1999,
		tax: 317,
		convenienceFee: 0,
		total: { amount: totalAmount, currency: 'EUR' },
		reason: orderType === 'REFUND' ? 'service_stopped' : undefined,
	};
}

const A = { offerId: 'offer-a', namespace: 'ns-a', description: 'Game A' };
const B = { offerId: 'offer-b', namespace: 'ns-b', description: 'Game B' };
const C = { offerId: 'offer-c', namespace: 'ns-c', description: 'Game C' };
const D = { offerId: 'offer-d', namespace: 'ns-d', description: 'Game D' };
const E = { offerId: 'offer-e', namespace: 'ns-e', description: 'Game E' };
const F = { offerId: 'offer-f', namespace: 'ns-f', description: 'Game F' };
const G = { offerId: 'offer-g', namespace: 'ns-g', description: 'Game G' };

/** Three pages, newest first, covering every row of the edge-case matrix. */
const PAGES = [
	{
		orders: [
			order('REFUND', 9000, [B]),
			order('PURCHASE', 8000, [C], 'Epic Games Store', 0), // free claim
			order('PURCHASE', 7000, [D], 'Fab Marketplace'),
		],
		nextPageToken: 'tok-1',
	},
	{
		orders: [
			order('PURCHASE', 6000, [E, { ...F, giftRecipient: 'friend-account-id' }]),
			order('MYSTERY', 5500, [G]),
			order('PURCHASE', 5000, [A]), // repurchase, second purchase
			order('REFUND', 4000, [A]),
		],
		nextPageToken: 'tok-2',
	},
	{
		orders: [order('PURCHASE', 3000, [A]), order('PURCHASE', 2000, [B])],
		nextPageToken: null,
	},
];

function parsePages(raw: unknown[]) {
	return raw.map((page) => orderHistoryPageSchema.parse(page));
}

function stubPagedFetch(pages: unknown[]): ReturnType<typeof vi.fn> {
	const calls: string[] = [];
	const tokens = new Map<string | null, number>();
	// token -> page index: the first request has no token, then each page's own token
	tokens.set(null, 0);
	pages.forEach((page, i) => {
		const next = (page as { nextPageToken?: string | null }).nextPageToken;
		if (next) tokens.set(next, i + 1);
	});
	const fn = vi.fn((input: string | URL | Request) => {
		const url = new URL(String(input));
		calls.push(url.href);
		const index = tokens.get(url.searchParams.get('nextPageToken'));
		if (index === undefined) return Promise.resolve(new Response('', { status: 404 }));
		return Promise.resolve(new Response(JSON.stringify(pages[index]), { status: 200 }));
	});
	globalThis.fetch = fn as unknown as typeof fetch;
	return fn;
}

describe('netOwnedItems (net rules)', () => {
	const net = netOwnedItems(parsePages(PAGES));
	const byOffer = new Map(net.items.map((item) => [item.offerId, item]));

	it('a free claim (PURCHASE, total 0) is owned', () => {
		expect(byOffer.get('offer-c')).toEqual({ offerId: 'offer-c', namespace: 'ns-c', description: 'Game C', acquiredAtMillis: 8000 });
	});

	it('a refunded offer is not owned', () => {
		expect(byOffer.has('offer-b')).toBe(false);
	});

	it('a repurchase is owned from the PURCHASE after the last refund, and a later duplicate does not move it', () => {
		expect(byOffer.get('offer-a')?.acquiredAtMillis).toBe(5000);
	});

	it('Fab, gifts and unknown order types are not owned; the unknown type is counted', () => {
		expect(byOffer.has('offer-d')).toBe(false);
		expect(byOffer.has('offer-f')).toBe(false);
		expect(byOffer.has('offer-g')).toBe(false);
		expect(net.skippedUnknownOrderTypes).toBe(1);
		expect(byOffer.has('offer-e')).toBe(true);
	});

	it('returns exactly the owned set', () => {
		expect(net.items.map((i) => i.offerId).sort()).toEqual(['offer-a', 'offer-c', 'offer-e']);
	});

	it('a REFUND cancels the purchase whatever marketplace label it carries, and a non-Epic PURCHASE still owns nothing', () => {
		const refunded = netOwnedItems(
			parsePages([{ orders: [order('PURCHASE', 100, [A]), order('REFUND', 200, [A], 'Fab Marketplace')] }]),
		);
		expect(refunded.items).toEqual([]);
		const fab = netOwnedItems(parsePages([{ orders: [order('PURCHASE', 100, [A], 'Fab Marketplace')] }]));
		expect(fab.items).toEqual([]);
	});

	it('on equal timestamps a REFUND wins', () => {
		const tie = netOwnedItems(parsePages([{ orders: [order('REFUND', 100, [A]), order('PURCHASE', 100, [A])] }]));
		expect(tie.items).toEqual([]);
	});
});

describe('readOrderHistoryPages', () => {
	it('every request carries an abort signal, so a stalled endpoint ends the run instead of hanging it', async () => {
		const fetchMock = stubPagedFetch(PAGES);
		await readOrderHistoryPages(ENDPOINT);
		for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
	});

	it('follows nextPageToken to the end, in order, with sequential GETs', async () => {
		const fetchMock = stubPagedFetch(PAGES);
		const result = await readOrderHistoryPages(ENDPOINT);
		expect(result).toEqual({ ok: true, pages: PAGES });
		const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0])));
		expect(urls.map((u) => u.searchParams.get('nextPageToken'))).toEqual([null, 'tok-1', 'tok-2']);
		for (const call of fetchMock.mock.calls) {
			expect((call[1] as RequestInit).method).toBe('GET');
		}
	});

	it('is self-contained: rebuilt from its source text in an empty scope it still works', async () => {
		stubPagedFetch(PAGES);
		const rebuilt = new Function(`return (${readOrderHistoryPages.toString()})`)() as typeof readOrderHistoryPages;
		expect(await rebuilt(ENDPOINT)).toEqual({ ok: true, pages: PAGES });
	});

	it('a repeated token fails the run with no pages', async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify({ orders: [], nextPageToken: 'same' }), { status: 200 })),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		// every page points at 'same': stop at the repeat (2nd request), not at the ceiling
		expect(await readOrderHistoryPages(ENDPOINT)).toEqual({ ok: false });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('more than the page ceiling fails the run', async () => {
		let n = 0;
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify({ orders: [], nextPageToken: `t${n++}` }), { status: 200 })),
		) as unknown as typeof fetch;
		expect(await readOrderHistoryPages(ENDPOINT, MAX_ORDER_HISTORY_PAGES)).toEqual({ ok: false });
		expect(n).toBe(MAX_ORDER_HISTORY_PAGES);
	});

	it.each([
		['a 403', () => new Response('no', { status: 403 })],
		['login HTML', () => new Response('<html>login</html>', { status: 200 })],
		['a non-page JSON body', () => new Response('{"hello":1}', { status: 200 })],
	])('%s yields no result', async (_label, make) => {
		globalThis.fetch = vi.fn(() => Promise.resolve(make())) as unknown as typeof fetch;
		expect(await readOrderHistoryPages(ENDPOINT)).toEqual({ ok: false });
	});

	it('a login redirect yields no result', async () => {
		const redirected = new Response(JSON.stringify({ orders: [] }), { status: 200 });
		Object.defineProperty(redirected, 'redirected', { value: true });
		Object.defineProperty(redirected, 'url', { value: 'https://www.epicgames.com/id/login' });
		globalThis.fetch = vi.fn(() => Promise.resolve(redirected)) as unknown as typeof fetch;
		expect(await readOrderHistoryPages(ENDPOINT)).toEqual({ ok: false });
	});

	it('a mid-run failure yields no partial result', async () => {
		const pagesOk = stubPagedFetch(PAGES);
		pagesOk.mockImplementation((input: string | URL | Request) => {
			const token = new URL(String(input)).searchParams.get('nextPageToken');
			if (token === 'tok-2') return Promise.reject(new TypeError('network'));
			const index = token === 'tok-1' ? 1 : 0;
			return Promise.resolve(new Response(JSON.stringify(PAGES[index]), { status: 200 }));
		});
		expect(await readOrderHistoryPages(ENDPOINT)).toEqual({ ok: false });
	});
});

describe('epicAdapter.export', () => {
	const noTab: ExportContext = { runInTab: () => Promise.reject(new TabRequiredError()) };

	it('returns the net owned items only, in a validated envelope', async () => {
		stubPagedFetch(PAGES);
		const envelope = (await epicAdapter.export(noTab)) as {
			contract_version: string;
			producer: string;
			producer_release: string;
			items: { offerId: string }[];
		};
		expect(envelope.contract_version).toBe(EPIC_OWNERSHIP_CONTRACT_VERSION);
		expect(envelope.producer).toBe('extension');
		expect(envelope.producer_release).toBe('dev');
		// ordered by acquisition time
		expect(envelope.items.map((i) => i.offerId)).toEqual(['offer-a', 'offer-e', 'offer-c']);
	});

	it('serialises no price, order id or payment field or value', async () => {
		stubPagedFetch(PAGES);
		const json = JSON.stringify(await epicAdapter.export(noTab));
		for (const forbidden of [
			'ORDER-SECRET', 'MERCHANT-GROUP-SECRET', 'TX-SECRET', 'PROMO-SECRET', 'friend-account-id',
			'orderId', 'amount', 'currency', 'tax', 'transactions', 'promotions', 'merchantGroup', 'total', 'subtotal',
			'4242', '1999', '317', 'EUR',
		]) {
			expect(json, forbidden).not.toContain(forbidden);
		}
	});

	it('with the worker fetch failing, runs the same reader in the tab and uses its result', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('blocked'))) as unknown as typeof fetch;
		const runInTab = vi.fn(async (_origin: string, func: (...a: never[]) => unknown, args: unknown[]) => {
			expect(func).toBe(readOrderHistoryPages);
			expect(args[0]).toBe(ENDPOINT);
			return { ok: true, pages: PAGES };
		});
		const envelope = (await epicAdapter.export({ runInTab } as unknown as ExportContext)) as { items: unknown[] };
		expect(runInTab).toHaveBeenCalledOnce();
		expect(runInTab.mock.calls[0][0]).toBe('https://accounts.epicgames.com');
		expect(envelope.items).toHaveLength(3);
	});

	it('with no Epic tab, the tab-required error propagates', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('blocked'))) as unknown as typeof fetch;
		await expect(epicAdapter.export(noTab)).rejects.toBeInstanceOf(TabRequiredError);
	});

	it('when the tab read fails too, there is no result', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('blocked'))) as unknown as typeof fetch;
		const failing: ExportContext = { runInTab: async () => ({ ok: false }) };
		await expect(epicAdapter.export(failing)).rejects.toThrow();
	});

	it('a schema failure yields no envelope', async () => {
		stubPagedFetch([{ orders: [{ orderType: 'PURCHASE' }], nextPageToken: null }]);
		await expect(epicAdapter.export(noTab)).rejects.toThrow();
	});

	it('declares the one Epic host and its import path', () => {
		expect(epicAdapter.hostPermissions).toEqual(['https://accounts.epicgames.com/*']);
		expect(epicAdapter.importPathPrefix).toBe('/profile/settings/epic');
	});
});
