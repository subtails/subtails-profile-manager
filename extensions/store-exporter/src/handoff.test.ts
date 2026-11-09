/**
 * spec-epic-ownership story 5 — the two MAIN-world functions of the daily run: a same-realm call of the
 * page-owned `window.__subtailsEpicAuto`, never `postMessage`; `null` without a receiver.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	probeEpicAutoRefresh,
	deliverEpicEnvelopeAutomatically,
	probeSteamAutoRefresh,
	deliverSteamEnvelopeAutomatically,
} from './handoff';

const withWindow = (receiver: unknown) => {
	const postMessage = vi.fn();
	(globalThis as unknown as { window: unknown }).window = { __subtailsEpicAuto: receiver, postMessage };
	return postMessage;
};

afterEach(() => {
	delete (globalThis as unknown as { window?: unknown }).window;
});

describe('probeEpicAutoRefresh', () => {
	it('is null without a receiver, so a signed-out page reads no store', async () => {
		withWindow(undefined);
		expect(await probeEpicAutoRefresh()).toBeNull();
	});

	it('asks the receiver and returns true only for a true answer', async () => {
		const receiver = vi.fn(async () => true);
		const postMessage = withWindow(receiver);
		expect(await probeEpicAutoRefresh()).toBe(true);
		expect(receiver).toHaveBeenCalledWith({ __subtails: 'epic-auto-probe' });
		expect(postMessage).not.toHaveBeenCalled();

		withWindow(async () => 'yes');
		expect(await probeEpicAutoRefresh()).toBe(false);
		withWindow(async () => {
			throw new Error('x');
		});
		expect(await probeEpicAutoRefresh()).toBe(false);
	});
});

describe('deliverEpicEnvelopeAutomatically', () => {
	const envelope = { contract_version: '1' } as never;

	it('passes the envelope to the receiver and returns its boolean', async () => {
		const receiver = vi.fn(async () => true);
		const postMessage = withWindow(receiver);
		expect(await deliverEpicEnvelopeAutomatically(envelope)).toBe(true);
		expect(receiver).toHaveBeenCalledWith({ __subtails: 'epic-auto-export', envelope });
		expect(postMessage).not.toHaveBeenCalled();

		withWindow(async () => false);
		expect(await deliverEpicEnvelopeAutomatically(envelope)).toBe(false);
	});

	it('is false without a receiver or when it throws', async () => {
		withWindow(undefined);
		expect(await deliverEpicEnvelopeAutomatically(envelope)).toBe(false);
		withWindow(() => {
			throw new Error('x');
		});
		expect(await deliverEpicEnvelopeAutomatically(envelope)).toBe(false);
	});
});

describe('the Steam pair (spec-epic-ownership story 6)', () => {
	const envelope = { contract_version: '1' } as never;
	const withSteamWindow = (receiver: unknown) => {
		const postMessage = vi.fn();
		(globalThis as unknown as { window: unknown }).window = { __subtailsSteamAuto: receiver, postMessage };
		return postMessage;
	};

	it('the probe asks the page-owned Steam receiver, never postMessage, and is null without one', async () => {
		withSteamWindow(undefined);
		expect(await probeSteamAutoRefresh()).toBeNull();

		const receiver = vi.fn(async () => true);
		const postMessage = withSteamWindow(receiver);
		expect(await probeSteamAutoRefresh()).toBe(true);
		expect(receiver).toHaveBeenCalledWith({ __subtails: 'steam-auto-probe' });
		expect(postMessage).not.toHaveBeenCalled();

		withSteamWindow(async () => false);
		expect(await probeSteamAutoRefresh()).toBe(false);
		withSteamWindow(() => {
			throw new Error('x');
		});
		expect(await probeSteamAutoRefresh()).toBe(false);
	});

	it('the delivery passes the envelope and returns the receiver boolean; false without a receiver or on a throw', async () => {
		const receiver = vi.fn(async () => true);
		const postMessage = withSteamWindow(receiver);
		expect(await deliverSteamEnvelopeAutomatically(envelope)).toBe(true);
		expect(receiver).toHaveBeenCalledWith({ __subtails: 'steam-auto-export', envelope });
		expect(postMessage).not.toHaveBeenCalled();

		withSteamWindow(undefined);
		expect(await deliverSteamEnvelopeAutomatically(envelope)).toBe(false);
		withSteamWindow(() => {
			throw new Error('x');
		});
		expect(await deliverSteamEnvelopeAutomatically(envelope)).toBe(false);
	});

	it('does not answer for the Epic receiver', async () => {
		withWindow(async () => true);
		expect(await probeSteamAutoRefresh()).toBeNull();
	});
});
