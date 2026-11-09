/**
 * The Epic adapter (epic-ownership Story 1).
 *
 * Reads the player's own Epic order history (`ajaxGetOrderHistory`) in the player's own browser, under
 * the player's own Epic session: the browser attaches that session to the GETs automatically, and
 * this file never reads, stores or forwards a cookie or token by name. It nets the orders into the
 * items the player currently owns and returns a small envelope. Nothing else leaves the order
 * history: no order id, amount, currency, tax, transaction, promotion, merchant group or account id.
 *
 * Net rules (`data-handling.md`): only the Epic Games Store marketplace counts; an item with a
 * `giftRecipient` is skipped; per `offerId` the latest event wins (PURCHASE owns, REFUND does not; on
 * equal timestamps a REFUND wins); an unknown `orderType` is skipped and counted. Ownership starts at
 * the earliest PURCHASE after the offer's last non-owning event.
 *
 * `readOrderHistoryPages` is ONE self-contained function (no closure over this module) that takes the
 * endpoint as its argument. The background worker calls it directly; when the worker's fetch fails,
 * the very same function is serialised into an open `accounts.epicgames.com` tab through `scripting`
 * and runs there. Requests are GET, read-only, sequential. Any login redirect, non-OK or non-JSON
 * response, malformed page, repeated page token or run past 200 pages yields NO result, never a
 * partial one.
 */
import { z } from 'zod';
import { deliverEpicEnvelopeAutomatically, deliverEpicEnvelopeToPage, deliverEpicNoticeToPage, probeEpicAutoRefresh } from '../handoff';
import type { ExportContext, StoreExportAdapter } from './types';

export const EPIC_OWNERSHIP_CONTRACT_VERSION = '1';
const EPIC_ORIGIN = 'https://accounts.epicgames.com';
const ORDER_HISTORY_ENDPOINT =
	'https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory?sortDir=DESC&sortBy=DATE&locale=en-US';
const EPIC_MARKETPLACE = 'Epic Games Store';
export const MAX_ORDER_HISTORY_PAGES = 200;

export type OrderHistoryRead = { ok: true; pages: unknown[] } | { ok: false };

/**
 * Pages the order history to its end. SELF-CONTAINED: it is stringified into an Epic tab, so it may
 * reference nothing but its argument and platform globals. Never throws: every failure is `{ ok: false }`.
 */
export async function readOrderHistoryPages(endpoint: string, maxPages: number = 200): Promise<OrderHistoryRead> {
	const pages: unknown[] = [];
	const seenTokens = new Set<string>();
	let token = '';
	try {
		for (let count = 0; count < maxPages; count++) {
			const url = new URL(endpoint);
			if (token) url.searchParams.set('nextPageToken', token);
			const response = await fetch(url.href, {
				method: 'GET',
				credentials: 'include',
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(30000),
			});
			if (!response.ok) return { ok: false };
			// A login redirect lands on another path (or host) and carries HTML.
			if (response.redirected) {
				const landed = new URL(response.url);
				if (landed.host !== url.host || landed.pathname !== url.pathname) return { ok: false };
			}
			const page: unknown = await response.json();
			if (typeof page !== 'object' || page === null || !Array.isArray((page as { orders?: unknown }).orders)) {
				return { ok: false };
			}
			pages.push(page);
			const next = (page as { nextPageToken?: unknown }).nextPageToken;
			if (next === undefined || next === null || next === '') return { ok: true, pages };
			if (typeof next !== 'string' || seenTokens.has(next)) return { ok: false };
			seenTokens.add(next);
			token = next;
		}
		return { ok: false };
	} catch {
		return { ok: false };
	}
}

const orderItemSchema = z.object({
	offerId: z.string().min(1),
	namespace: z.string().min(1),
	description: z.string(),
	giftRecipient: z.unknown().optional(),
});

const orderSchema = z.object({
	orderType: z.string(),
	createdAtMillis: z.number().finite(),
	marketplaceName: z.string(),
	items: z.array(orderItemSchema),
});

export const orderHistoryPageSchema = z.object({
	orders: z.array(orderSchema),
});

export const epicOwnedItemSchema = z.object({
	offerId: z.string().min(1),
	namespace: z.string().min(1),
	description: z.string(),
	acquiredAtMillis: z.number().finite(),
});
export type EpicOwnedItem = z.infer<typeof epicOwnedItemSchema>;

export const epicOwnershipEnvelopeSchema = z.object({
	contract_version: z.literal(EPIC_OWNERSHIP_CONTRACT_VERSION),
	producer: z.literal('extension'),
	producer_release: z.string().min(1),
	items: z.array(epicOwnedItemSchema),
	skipped_unknown_order_types: z.number().int().nonnegative(),
});
export type EpicOwnershipEnvelope = z.infer<typeof epicOwnershipEnvelopeSchema>;

type OrderHistoryPage = z.infer<typeof orderHistoryPageSchema>;

interface OfferEvent {
	readonly owns: boolean;
	readonly at: number;
	readonly namespace: string;
	readonly description: string;
}

/** Nets validated pages into the currently owned items and the count of skipped unknown order types. */
export function netOwnedItems(pages: readonly OrderHistoryPage[]): { items: EpicOwnedItem[]; skippedUnknownOrderTypes: number } {
	const events = new Map<string, OfferEvent[]>();
	let skippedUnknownOrderTypes = 0;
	for (const page of pages) {
		for (const order of page.orders) {
			const isEpicStore = order.marketplaceName === EPIC_MARKETPLACE;
			// A REFUND of an offer is applied whatever marketplace label it carries: it can only ever
			// cancel a PURCHASE already seen for the same `offerId`, never create ownership.
			if (!isEpicStore && order.orderType !== 'REFUND') continue;
			if (order.orderType !== 'PURCHASE' && order.orderType !== 'REFUND') {
				skippedUnknownOrderTypes++;
				continue;
			}
			for (const item of order.items) {
				if (item.giftRecipient) continue;
				const list = events.get(item.offerId) ?? [];
				list.push({ owns: order.orderType === 'PURCHASE', at: order.createdAtMillis, namespace: item.namespace, description: item.description });
				events.set(item.offerId, list);
			}
		}
	}

	const items: EpicOwnedItem[] = [];
	for (const [offerId, list] of events) {
		// Oldest first; on equal timestamps the PURCHASE sorts before the REFUND so the REFUND wins.
		list.sort((a, b) => a.at - b.at || Number(b.owns) - Number(a.owns));
		let start: OfferEvent | undefined;
		for (const event of list) {
			if (!event.owns) start = undefined;
			else if (!start) start = event;
		}
		if (start) {
			items.push({ offerId, namespace: start.namespace, description: start.description, acquiredAtMillis: start.at });
		}
	}
	items.sort((a, b) => a.acquiredAtMillis - b.acquiredAtMillis || (a.offerId < b.offerId ? -1 : 1));
	return { items, skippedUnknownOrderTypes };
}

/** Replaced at build time by `build.ts`'s esbuild `define`; `'dev'` outside a real build. */
function producerRelease(): string {
	return typeof __STORE_EXPORTER_RELEASE__ === 'string' ? __STORE_EXPORTER_RELEASE__ : 'dev';
}

function parseRead(read: unknown): unknown[] {
	const parsed = z.object({ ok: z.literal(true), pages: z.array(z.unknown()) }).safeParse(read);
	if (!parsed.success) throw new Error('store-exporter: order history could not be read');
	return parsed.data.pages;
}

async function readPages(ctx: ExportContext): Promise<unknown[]> {
	try {
		return parseRead(await readOrderHistoryPages(ORDER_HISTORY_ENDPOINT, MAX_ORDER_HISTORY_PAGES));
	} catch {
		// fall through to the tab
	}
	// The worker could not read it: run the same reader inside an open Epic tab.
	return parseRead(await ctx.runInTab(EPIC_ORIGIN, readOrderHistoryPages, [ORDER_HISTORY_ENDPOINT, MAX_ORDER_HISTORY_PAGES]));
}

export const epicAdapter = {
	storeKey: 'epic',
	importPathPrefix: '/profile/settings/epic',
	hostPermissions: ['https://accounts.epicgames.com/*'],
	deliver: deliverEpicEnvelopeToPage,
	notice: deliverEpicNoticeToPage,
	automatic: { probe: probeEpicAutoRefresh, deliver: deliverEpicEnvelopeAutomatically },
	async export(ctx: ExportContext): Promise<EpicOwnershipEnvelope> {
		const rawPages = await readPages(ctx);
		const pages = rawPages.map((page) => orderHistoryPageSchema.parse(page));
		const { items, skippedUnknownOrderTypes } = netOwnedItems(pages);
		return epicOwnershipEnvelopeSchema.parse({
			contract_version: EPIC_OWNERSHIP_CONTRACT_VERSION,
			producer: 'extension',
			producer_release: producerRelease(),
			items,
			skipped_unknown_order_types: skippedUnknownOrderTypes,
		});
	},
} satisfies StoreExportAdapter;
