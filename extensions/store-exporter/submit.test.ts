/**
 * steam-preferences Story 2.3, AC2 — `submit.ts` fails loudly and uploads nothing without every
 * required credential, and never uploads a tampered artifact. `resolveSubmitCredentials`/
 * `verifyArtifactChecksum` are pure (no `fetch` inside them at all), and `runSubmit`'s upload step is
 * reached only after both checks pass — which most tests here deliberately arrange NOT to happen,
 * while asserting a `fetch` spy sees zero calls. The exception (2026-09-04 review finding P0-3) is the
 * "runSubmit firefox" describe block below: it DOES exercise `uploadFirefox`'s full upload → poll →
 * version-create flow, but only against a `vi.spyOn(globalThis, 'fetch')` mock that never leaves the
 * process — never a real network call to AMO.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { REQUIRED_SECRETS, resolveSubmitCredentials, verifyArtifactChecksum, runSubmit, buildAmoJwt } from './submit';

describe('resolveSubmitCredentials (steam-preferences Story 2.3, AC2)', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('with every Chrome variable unset, fails naming all four — and calls fetch zero times', () => {
		const result = resolveSubmitCredentials('chrome', {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.missing).toEqual([...REQUIRED_SECRETS.chrome]);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('with every Firefox variable unset, fails naming both — and calls fetch zero times', () => {
		const result = resolveSubmitCredentials('firefox', {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.missing).toEqual([...REQUIRED_SECRETS.firefox]);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('with a partial Chrome set, names only the still-missing ones', () => {
		const result = resolveSubmitCredentials('chrome', {
			CHROME_WEB_STORE_EXTENSION_ID: 'abc',
			CHROME_WEB_STORE_CLIENT_ID: 'def',
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.missing).toEqual(['CHROME_WEB_STORE_CLIENT_SECRET', 'CHROME_WEB_STORE_REFRESH_TOKEN']);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('with a full synthetic Chrome set present, resolves successfully with no network call (pure over an injected env)', () => {
		const env = {
			CHROME_WEB_STORE_EXTENSION_ID: 'ext-id',
			CHROME_WEB_STORE_CLIENT_ID: 'client-id',
			CHROME_WEB_STORE_CLIENT_SECRET: 'client-secret',
			CHROME_WEB_STORE_REFRESH_TOKEN: 'refresh-token',
		};
		const result = resolveSubmitCredentials('chrome', env);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials).toEqual(env);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('with a full synthetic Firefox set present, resolves successfully with no network call', () => {
		const env = { AMO_JWT_ISSUER: 'issuer', AMO_JWT_SECRET: 'secret' };
		const result = resolveSubmitCredentials('firefox', env);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials).toEqual(env);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('verifyArtifactChecksum (steam-preferences Story 2.3, AC2) — pure, no filesystem access', () => {
	it('accepts bytes that match the SHA256SUMS.txt entry', () => {
		const bytes = Buffer.from('hello world');
		const sha = createHash('sha256').update(bytes).digest('hex');
		const checksumsText = `${sha}  subtails-store-exporter-1.0.0-chrome-unsigned.zip\n`;
		const result = verifyArtifactChecksum(bytes, 'subtails-store-exporter-1.0.0-chrome-unsigned.zip', checksumsText);
		expect(result.ok).toBe(true);
	});

	it('refuses a tampered artifact whose bytes no longer match the recorded checksum', () => {
		const originalBytes = Buffer.from('hello world');
		const sha = createHash('sha256').update(originalBytes).digest('hex');
		const checksumsText = `${sha}  subtails-store-exporter-1.0.0-chrome-unsigned.zip\n`;
		const tamperedBytes = Buffer.from('hello world, tampered');
		const result = verifyArtifactChecksum(
			tamperedBytes,
			'subtails-store-exporter-1.0.0-chrome-unsigned.zip',
			checksumsText,
		);
		expect(result.ok).toBe(false);
	});

	it('refuses when the file has no entry in SHA256SUMS.txt at all', () => {
		const result = verifyArtifactChecksum(Buffer.from('x'), 'missing-file.zip', '');
		expect(result.ok).toBe(false);
	});
});

describe('runSubmit (steam-preferences Story 2.3, AC2) — the full order of hard stops, no real network ever', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let fixtureDir: string;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('submit.test.ts: fetch must never be called'));
		fixtureDir = mkdtempSync(join(tmpdir(), 'store-exporter-submit-test-'));
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		rmSync(fixtureDir, { recursive: true, force: true });
	});

	function writeSubmissionFixture(artifactBytes: Buffer, recordedSha: string): void {
		const artifactFile = 'subtails-store-exporter-1.0.0-chrome-unsigned.zip';
		writeFileSync(join(fixtureDir, artifactFile), artifactBytes);
		writeFileSync(join(fixtureDir, 'SHA256SUMS.txt'), `${recordedSha}  ${artifactFile}\n`);
		writeFileSync(
			join(fixtureDir, 'submission.json'),
			JSON.stringify({
				version: '1.0.0',
				channel: 'release',
				generatedFrom: null,
				artifacts: [{ file: artifactFile, store: 'chrome', sha256: recordedSha, bytes: artifactBytes.length }],
				requiredSecrets: REQUIRED_SECRETS,
			}),
		);
	}

	const FULL_CHROME_ENV = {
		CHROME_WEB_STORE_EXTENSION_ID: 'ext-id',
		CHROME_WEB_STORE_CLIENT_ID: 'client-id',
		CHROME_WEB_STORE_CLIENT_SECRET: 'client-secret',
		CHROME_WEB_STORE_REFRESH_TOKEN: 'refresh-token',
	};

	it('stop 1: submission.json absent — refuses, never calls fetch', async () => {
		const result = await runSubmit('chrome', { releaseDir: fixtureDir, env: FULL_CHROME_ENV });
		expect(result.ok).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('stop 2: credentials missing — refuses, never calls fetch, even with a valid submission.json present', async () => {
		const bytes = Buffer.from('a real chrome zip, for test purposes');
		const sha = createHash('sha256').update(bytes).digest('hex');
		writeSubmissionFixture(bytes, sha);

		const result = await runSubmit('chrome', { releaseDir: fixtureDir, env: {} });
		expect(result.ok).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('stop 3: a tampered artifact (checksum mismatch) — refuses, never calls fetch, even with full credentials present', async () => {
		const originalBytes = Buffer.from('a real chrome zip, for test purposes');
		const originalSha = createHash('sha256').update(originalBytes).digest('hex');
		writeSubmissionFixture(originalBytes, originalSha);
		// Tamper the on-disk artifact AFTER submission.json/SHA256SUMS.txt were written against the
		// original bytes — the exact "corrupted after packaging" shape AC2 names.
		writeFileSync(join(fixtureDir, 'subtails-store-exporter-1.0.0-chrome-unsigned.zip'), Buffer.from('tampered!'));

		const result = await runSubmit('chrome', { releaseDir: fixtureDir, env: FULL_CHROME_ENV });
		expect(result.ok).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('buildAmoJwt (steam-preferences Story 2.3, AC2 — P0-2: a real HMAC, not a bare hash)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('signs with HMAC-SHA256, matching an independently computed vector byte for byte', async () => {
		const fixedNowMs = 1700000000000; // arbitrary, fixed so the payload's iat/exp/jti are deterministic
		vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);

		const jwt = await buildAmoJwt('issuer-123', 'super-secret');
		const parts = jwt.split('.');
		expect(parts).toHaveLength(3);
		const [header, payload, signature] = parts;

		const base64url = (input: Buffer | string): string =>
			Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		const nowSeconds = Math.floor(fixedNowMs / 1000);
		const expectedHeader = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
		const expectedPayload = base64url(
			JSON.stringify({ iss: 'issuer-123', jti: `${nowSeconds}`, iat: nowSeconds, exp: nowSeconds + 60 }),
		);
		// The known-good vector: an HS256 signature computed independently, the standard way (Node's
		// own `createHmac`), over the exact `header.payload` AMO itself would verify.
		const expectedSignature = base64url(
			createHmac('sha256', 'super-secret').update(`${expectedHeader}.${expectedPayload}`).digest(),
		);

		expect(header).toBe(expectedHeader);
		expect(payload).toBe(expectedPayload);
		expect(signature).toBe(expectedSignature);

		// Proves this is genuinely KEYED (HMAC), not a bare hash of the concatenation: the two
		// diverge, so a regression back to `createHash('sha256')` would fail the assertion above.
		const bareHashSignature = base64url(
			createHash('sha256').update(`${expectedHeader}.${expectedPayload}super-secret`).digest(),
		);
		expect(signature).not.toBe(bareHashSignature);
	});
});

describe('runSubmit firefox — the upload-and-sign flow must actually finish before reporting success (steam-preferences Story 2.3, AC2 — P0-3)', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let fixtureDir: string;

	const FULL_FIREFOX_ENV = { AMO_JWT_ISSUER: 'issuer', AMO_JWT_SECRET: 'secret' };
	const ADDON_GUID = 'store-exporter@subtails.com';

	beforeEach(() => {
		fixtureDir = mkdtempSync(join(tmpdir(), 'store-exporter-submit-firefox-test-'));
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		rmSync(fixtureDir, { recursive: true, force: true });
	});

	function writeFirefoxFixture(): void {
		const artifactFile = 'subtails-store-exporter-1.0.0-firefox-unsigned.xpi';
		const bytes = Buffer.from('a real firefox xpi, for test purposes');
		const sha = createHash('sha256').update(bytes).digest('hex');
		writeFileSync(join(fixtureDir, artifactFile), bytes);
		writeFileSync(join(fixtureDir, 'SHA256SUMS.txt'), `${sha}  ${artifactFile}\n`);
		writeFileSync(
			join(fixtureDir, 'submission.json'),
			JSON.stringify({
				version: '1.0.0',
				channel: 'release',
				generatedFrom: null,
				artifacts: [{ file: artifactFile, store: 'firefox', sha256: sha, bytes: bytes.length }],
				requiredSecrets: REQUIRED_SECRETS,
			}),
		);
	}

	function fakeResponse(ok: boolean, body: unknown): Response {
		return {
			ok,
			status: ok ? 200 : 500,
			json: async () => body,
			text: async () => JSON.stringify(body),
		} as unknown as Response;
	}

	it('reports { ok: true } only after upload -> poll-until-valid -> version-create ALL succeed, hitting AMO exactly 3 times in that order', async () => {
		writeFirefoxFixture();
		fetchSpy = vi.spyOn(globalThis, 'fetch');
		fetchSpy
			.mockImplementationOnce(async () => fakeResponse(true, { uuid: 'upload-uuid-1' }))
			.mockImplementationOnce(async () => fakeResponse(true, { processed: true, valid: true }))
			.mockImplementationOnce(async () => fakeResponse(true, {}));

		const result = await runSubmit('firefox', { releaseDir: fixtureDir, env: FULL_FIREFOX_ENV });

		expect(result).toEqual({ ok: true });
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(fetchSpy.mock.calls[0][0]).toBe('https://addons.mozilla.org/api/v5/addons/upload/');
		expect(fetchSpy.mock.calls[1][0]).toBe('https://addons.mozilla.org/api/v5/addons/upload/upload-uuid-1/');
		expect(fetchSpy.mock.calls[2][0]).toBe(`https://addons.mozilla.org/api/v5/addons/addon/${ADDON_GUID}/versions/`);
	});

	it('never reports success when AMO marks the processed upload invalid — no version-create call is ever made', async () => {
		writeFirefoxFixture();
		fetchSpy = vi.spyOn(globalThis, 'fetch');
		fetchSpy
			.mockImplementationOnce(async () => fakeResponse(true, { uuid: 'upload-uuid-2' }))
			.mockImplementationOnce(async () =>
				fakeResponse(true, { processed: true, valid: false, validation: { messages: [{ message: 'bad manifest' }] } }),
			);

		await expect(runSubmit('firefox', { releaseDir: fixtureDir, env: FULL_FIREFOX_ENV })).rejects.toThrow(
			/bad manifest/,
		);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('never reports success when the initial upload response carries no uuid — the version step is unreachable without one', async () => {
		writeFirefoxFixture();
		fetchSpy = vi.spyOn(globalThis, 'fetch');
		fetchSpy.mockImplementationOnce(async () => fakeResponse(true, {}));

		await expect(runSubmit('firefox', { releaseDir: fixtureDir, env: FULL_FIREFOX_ENV })).rejects.toThrow(/uuid/);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('uses the "listed" channel (P0-5, resolved) so the AMO listing page — and FIREFOX_AMO_LISTING_URL — can exist', async () => {
		writeFirefoxFixture();
		fetchSpy = vi.spyOn(globalThis, 'fetch');
		fetchSpy
			.mockImplementationOnce(async () => fakeResponse(true, { uuid: 'upload-uuid-3' }))
			.mockImplementationOnce(async () => fakeResponse(true, { processed: true, valid: true }))
			.mockImplementationOnce(async () => fakeResponse(true, {}));

		await runSubmit('firefox', { releaseDir: fixtureDir, env: FULL_FIREFOX_ENV });

		const uploadCallInit = fetchSpy.mock.calls[0][1] as { body: FormData };
		expect(uploadCallInit.body.get('channel')).toBe('listed');
	});
});
