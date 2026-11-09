/**
 * The extension's credentialed submission step (steam-preferences Story 2.3, AC2).
 *
 * This is the ONE place in the repo that would ever make a network call to a store. It is deliberately
 * NOT part of `package` (Task 1), NEVER wired into CI (`.circleci/config.yml` names only `package`),
 * and NEVER run by the gate — `submit.test.ts` proves every failure path calls `fetch` zero times.
 * `uploadChrome` is deliberately UNEXERCISED by any test (no synthetic credential set makes a real
 * call to that API safe to run). `uploadFirefox`'s network calls ARE exercised, but only against a
 * `vi.spyOn(globalThis, 'fetch')` mock that never leaves the process (2026-09-04 review finding
 * P0-3) — no test anywhere makes a real call to either store.
 *
 * Four hard stops, each checked BEFORE the next, in this order (AC2):
 *   1. `dist/extensions/store-exporter/release/submission.json` must exist (produced by `package`).
 *   2. Every required env var for the requested store must be set — resolved by the PURE,
 *      side-effect-free `resolveSubmitCredentials(store, env)`, which never touches the network and
 *      never reads `process.env` itself unless the caller omits `env` (so a test can inject a
 *      synthetic object and assert zero I/O).
 *   3. The on-disk artifact's SHA-256 must match `SHA256SUMS.txt` — verified by the equally PURE
 *      `verifyArtifactChecksum(fileBytes, file, checksumsText)`, which takes bytes and text, never a
 *      path, so it needs no filesystem access to unit-test.
 *   4. Only once all three pass does `runSubmit` call `uploadChrome`/`uploadFirefox`, the one place
 *      `fetch` appears in this file — kept in its own small functions so the pure/network split
 *      mirrors this feature's driving-adapter posture everywhere else.
 *
 * Every artifact this repo produces is UNSIGNED (package.ts's `-unsigned` filenames, `"signed": false`
 * in `submission.json`) — see `package.ts`'s docblock for why: a store server signs the package only
 * after a credentialed upload, which is exactly what this file performs and nothing this repo can do
 * locally.
 *
 * The six secret names below are also documented, commented-out and value-less, in `.env.example` and
 * `README.md`. They are read from the operator's own shell for a manual run; if this is ever
 * automated, a CircleCI *context* holds them — never a literal in `.circleci/config.yml`, never
 * `.env.local`, never a committed file (AC2).
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST_ROOT } from './build';
import { FIREFOX_ADDON_GUID } from './src/manifest.config';

const RELEASE_DIR = join(DIST_ROOT, 'release');

export type StoreKey = 'chrome' | 'firefox';

/** The exact env var names each store's upload needs — the single source `package.ts`'s
 * `submission.json.requiredSecrets` and this file's own resolver both read. */
export const REQUIRED_SECRETS: Readonly<Record<StoreKey, readonly string[]>> = {
	chrome: [
		'CHROME_WEB_STORE_EXTENSION_ID',
		'CHROME_WEB_STORE_CLIENT_ID',
		'CHROME_WEB_STORE_CLIENT_SECRET',
		'CHROME_WEB_STORE_REFRESH_TOKEN',
	],
	firefox: ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'],
};

export type CredentialResolution =
	| { readonly ok: true; readonly credentials: Readonly<Record<string, string>> }
	| { readonly ok: false; readonly missing: readonly string[] };

/**
 * PURE. Resolves the requested store's credentials from an injected env object (defaulting to
 * `process.env` only for the real CLI entry point below), performing no I/O and no network call.
 * Any missing variable fails the WHOLE resolution and names every missing one, not just the first —
 * AC2 requires "printing the exact missing variable names".
 */
export function resolveSubmitCredentials(
	store: StoreKey,
	env: NodeJS.ProcessEnv = process.env,
): CredentialResolution {
	const names = REQUIRED_SECRETS[store];
	const missing = names.filter((name) => !env[name]);
	if (missing.length > 0) return { ok: false, missing };

	const credentials: Record<string, string> = {};
	for (const name of names) credentials[name] = env[name] as string;
	return { ok: true, credentials };
}

export interface ChecksumVerification {
	readonly ok: boolean;
	readonly expected?: string;
	readonly actual?: string;
	readonly reason?: string;
}

/** One `<sha256>  <filename>` line per artifact — the exact shape `package.ts` writes. */
function parseChecksumsFile(text: string): Record<string, string> {
	const map: Record<string, string> = {};
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const match = /^([0-9a-f]{64})\s+(.+)$/.exec(trimmed);
		if (match) map[match[2]] = match[1];
	}
	return map;
}

/**
 * PURE. Takes the artifact's already-read bytes plus the already-read `SHA256SUMS.txt` text — no
 * filesystem access here, so this is directly unit-testable with synthetic (including tampered)
 * inputs. `SHA256SUMS.txt`, not `submission.json`'s own copy, is the source of truth AC2 names.
 */
export function verifyArtifactChecksum(fileBytes: Buffer, file: string, checksumsText: string): ChecksumVerification {
	const expectedMap = parseChecksumsFile(checksumsText);
	const expected = expectedMap[file];
	if (expected === undefined) {
		return { ok: false, reason: `no SHA256SUMS.txt entry for ${file}` };
	}
	const actual = createHash('sha256').update(fileBytes).digest('hex');
	if (actual !== expected) {
		return { ok: false, expected, actual, reason: `checksum mismatch for ${file}` };
	}
	return { ok: true };
}

interface SubmissionArtifactRecord {
	readonly file: string;
	readonly store: string;
	readonly sha256: string;
	readonly bytes: number;
}

interface SubmissionManifestFile {
	readonly version: string;
	readonly channel: string;
	readonly generatedFrom: string | null;
	readonly artifacts: readonly SubmissionArtifactRecord[];
	readonly requiredSecrets: Readonly<Record<string, readonly string[]>>;
}

/**
 * Step 4a. Chrome Web Store: `PUT …/upload` then `POST …/publish` targeting trusted testers (alpha).
 * `fetch` alone — no new dependency. Deliberately UNEXERCISED by any test: there is no synthetic
 * credential set that could make a real call to this API safe to run in CI or locally.
 */
async function uploadChrome(credentials: Readonly<Record<string, string>>, zipBytes: Buffer): Promise<void> {
	const extensionId = credentials.CHROME_WEB_STORE_EXTENSION_ID;
	const accessToken = await fetchChromeAccessToken(credentials);

	const uploadResponse = await fetch(
		`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}?uploadType=media`,
		{
			method: 'PUT',
			headers: { Authorization: `Bearer ${accessToken}`, 'x-goog-api-version': '2' },
			body: new Uint8Array(zipBytes),
		},
	);
	if (!uploadResponse.ok) {
		throw new Error(`Chrome Web Store upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
	}

	const publishResponse = await fetch(
		`https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=trustedTesters`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'x-goog-api-version': '2', 'Content-Length': '0' },
		},
	);
	if (!publishResponse.ok) {
		throw new Error(`Chrome Web Store publish failed: ${publishResponse.status} ${await publishResponse.text()}`);
	}
}

async function fetchChromeAccessToken(credentials: Readonly<Record<string, string>>): Promise<string> {
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: credentials.CHROME_WEB_STORE_CLIENT_ID,
			client_secret: credentials.CHROME_WEB_STORE_CLIENT_SECRET,
			refresh_token: credentials.CHROME_WEB_STORE_REFRESH_TOKEN,
			grant_type: 'refresh_token',
		}),
	});
	if (!response.ok) {
		throw new Error(`Chrome Web Store OAuth token refresh failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as { access_token?: string };
	if (!body.access_token) throw new Error('Chrome Web Store OAuth token refresh returned no access_token');
	return body.access_token;
}

/** How long `uploadFirefox` polls AMO's upload-status endpoint before giving up (2026-09-04 review
 * finding P0-3) — AMO validates the XPI asynchronously; a 202 from the initial upload call means
 * "accepted for processing", never "done". */
const AMO_UPLOAD_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const AMO_UPLOAD_POLL_INTERVAL_MS = 5 * 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

interface AmoUploadStatus {
	readonly uuid?: string;
	readonly processed?: boolean;
	readonly valid?: boolean;
	readonly validation?: { readonly messages?: ReadonlyArray<{ readonly message?: string }> };
}

/**
 * Polls `GET /api/v5/addons/upload/{uuid}/` until AMO reports the upload `processed`, throwing if
 * validation failed or the timeout elapses. A fresh, short-lived JWT is minted for every poll (each
 * one already carries its own 60s `exp`).
 */
async function pollAmoUploadUntilValid(uuid: string, issuer: string, secret: string): Promise<void> {
	const deadline = Date.now() + AMO_UPLOAD_POLL_TIMEOUT_MS;
	for (;;) {
		const jwt = await buildAmoJwt(issuer, secret);
		const response = await fetch(`https://addons.mozilla.org/api/v5/addons/upload/${uuid}/`, {
			headers: { Authorization: `JWT ${jwt}` },
		});
		if (!response.ok) {
			throw new Error(`AMO upload status check failed: ${response.status} ${await response.text()}`);
		}
		const status = (await response.json()) as AmoUploadStatus;
		if (status.processed) {
			if (!status.valid) {
				const messages = status.validation?.messages?.map((entry) => entry.message).filter(Boolean).join('; ');
				throw new Error(`AMO rejected the upload as invalid: ${messages || 'no validation detail returned'}`);
			}
			return;
		}
		if (Date.now() >= deadline) {
			throw new Error(`AMO upload ${uuid} did not finish processing within ${AMO_UPLOAD_POLL_TIMEOUT_MS}ms`);
		}
		await sleep(AMO_UPLOAD_POLL_INTERVAL_MS);
	}
}

/**
 * Step 4b. Firefox AMO's `/api/v5/addons/` upload-**and-sign** flow, JWT-authenticated with the
 * issuer + secret pair. The initial `POST …/upload/` only returns a `uuid` for asynchronous
 * validation (a 202 means "accepted for processing", never "submitted") — this function does not
 * return until that upload has been polled to a valid, `processed` state AND attached to an add-on
 * version via `POST …/addon/{guid}/versions/`, so a caller observing this promise resolve can trust
 * that a version was actually created (2026-09-04 review finding P0-3: the previous version stopped
 * at the 202 and reported success for a submission that never happened).
 *
 * `channel: 'listed'` (2026-09-04 review finding P0-5, resolved): an `unlisted` AMO add-on has no
 * listing page, which would leave `FIREFOX_AMO_LISTING_URL` permanently unfillable and the flag-gated
 * install section permanently dead for Firefox — `listed` matches Chrome's `trustedTesters` posture
 * (also a listed item) and keeps AC3's source review meaningful.
 */
async function uploadFirefox(credentials: Readonly<Record<string, string>>, xpiBytes: Buffer): Promise<void> {
	const issuer = credentials.AMO_JWT_ISSUER;
	const secret = credentials.AMO_JWT_SECRET;

	const uploadJwt = await buildAmoJwt(issuer, secret);
	const form = new FormData();
	form.set('upload', new Blob([new Uint8Array(xpiBytes)], { type: 'application/x-xpinstall' }), 'upload.xpi');
	form.set('channel', 'listed');

	const uploadResponse = await fetch('https://addons.mozilla.org/api/v5/addons/upload/', {
		method: 'POST',
		headers: { Authorization: `JWT ${uploadJwt}` },
		body: form,
	});
	if (!uploadResponse.ok) {
		throw new Error(`AMO upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
	}
	const uploadBody = (await uploadResponse.json()) as AmoUploadStatus;
	if (!uploadBody.uuid) {
		throw new Error('AMO upload response carried no uuid — cannot create a version without one');
	}

	await pollAmoUploadUntilValid(uploadBody.uuid, issuer, secret);

	const versionJwt = await buildAmoJwt(issuer, secret);
	const versionResponse = await fetch(
		`https://addons.mozilla.org/api/v5/addons/addon/${FIREFOX_ADDON_GUID}/versions/`,
		{
			method: 'POST',
			headers: { Authorization: `JWT ${versionJwt}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ upload: uploadBody.uuid }),
		},
	);
	if (!versionResponse.ok) {
		throw new Error(`AMO version creation failed: ${versionResponse.status} ${await versionResponse.text()}`);
	}
}

/** A minimal, dependency-free HS256 JWT for AMO's issuer/secret auth scheme — `node:crypto` only.
 * Exported so `submit.test.ts` can prove the signature is a real HMAC against an independently
 * computed vector (2026-09-04 review finding P0-2 — the previous version signed with a bare
 * `createHash('sha256')` over `header.payload+secret`, which AMO can never validate as HS256). */
export async function buildAmoJwt(issuer: string, secret: string): Promise<string> {
	const base64url = (input: Buffer | string): string =>
		Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

	const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const now = Math.floor(Date.now() / 1000);
	const payload = base64url(JSON.stringify({ iss: issuer, jti: `${now}`, iat: now, exp: now + 60 }));
	const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
	return `${header}.${payload}.${base64url(signature)}`;
}

export interface RunSubmitOptions {
	readonly releaseDir?: string;
	readonly env?: NodeJS.ProcessEnv;
}

export interface RunSubmitResult {
	readonly ok: boolean;
	readonly reason?: string;
}

/**
 * The orchestration AC2 describes, in its exact order. Accepts an injectable `releaseDir`/`env` so
 * `submit.test.ts` can point it at a synthetic fixture directory without touching the real
 * `dist/extensions/store-exporter/release/` — never the real credentials, never a real store.
 */
export async function runSubmit(store: StoreKey, options: RunSubmitOptions = {}): Promise<RunSubmitResult> {
	const releaseDir = options.releaseDir ?? RELEASE_DIR;
	const env = options.env ?? process.env;

	const manifestPath = join(releaseDir, 'submission.json');
	if (!existsSync(manifestPath)) {
		const reason = `${manifestPath} is absent — run "nx run store-exporter:package" first`;
		console.error(`submit.ts: ${reason}`);
		return { ok: false, reason };
	}
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SubmissionManifestFile;

	const credentialResult = resolveSubmitCredentials(store, env);
	if (!credentialResult.ok) {
		const reason = `missing required env var(s) for ${store}: ${credentialResult.missing.join(', ')}`;
		console.error(`submit.ts: ${reason}`);
		return { ok: false, reason };
	}

	const artifact = manifest.artifacts.find((entry) => entry.store === store);
	if (!artifact) {
		const reason = `submission.json records no "${store}" artifact`;
		console.error(`submit.ts: ${reason}`);
		return { ok: false, reason };
	}

	const checksumsPath = join(releaseDir, 'SHA256SUMS.txt');
	if (!existsSync(checksumsPath)) {
		const reason = `${checksumsPath} is absent — run "nx run store-exporter:package" first`;
		console.error(`submit.ts: ${reason}`);
		return { ok: false, reason };
	}
	const checksumsText = readFileSync(checksumsPath, 'utf8');
	const artifactPath = join(releaseDir, artifact.file);
	if (!existsSync(artifactPath)) {
		const reason = `${artifactPath} is absent — run "nx run store-exporter:package" first`;
		console.error(`submit.ts: ${reason}`);
		return { ok: false, reason };
	}
	const fileBytes = readFileSync(artifactPath);
	const verification = verifyArtifactChecksum(fileBytes, artifact.file, checksumsText);
	if (!verification.ok) {
		const reason = `refusing to upload a tampered artifact: ${verification.reason}`;
		console.error(`submit.ts: ${reason}`);
		return { ok: false, reason };
	}

	if (store === 'chrome') {
		await uploadChrome(credentialResult.credentials, fileBytes);
	} else {
		await uploadFirefox(credentialResult.credentials, fileBytes);
	}
	return { ok: true };
}

// Only auto-run when this file is the process entry point (`npx tsx submit.ts <chrome|firefox>`) —
// importing it (as `package.ts` does, for `REQUIRED_SECRETS`) must never trigger a real submission.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
	const requestedStore = process.argv[2];
	if (requestedStore !== 'chrome' && requestedStore !== 'firefox') {
		console.error('submit.ts: usage: npx tsx submit.ts <chrome|firefox>');
		process.exitCode = 1;
	} else {
		runSubmit(requestedStore).then(
			(result) => {
				if (!result.ok) process.exitCode = 1;
			},
			(err: unknown) => {
				console.error(err);
				process.exitCode = 1;
			},
		);
	}
}
