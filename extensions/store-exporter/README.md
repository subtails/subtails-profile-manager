# subtails Profile Manager

A browser extension (Chrome and Firefox, one manifest source) that exports a player's Steam
preference record (dismissals, exclusions, wishlist) to subtails in one click, under the player's own
subtails session. It is the one-click alternative to the copy-and-paste and export-snippet paths
`/profile/settings/steam` already offers — never required for a first import.

It also reads a player's Epic order history (`ajaxGetOrderHistory`, one GET per page, under the
player's own Epic session) from `/profile/settings/epic` and hands subtails only the games the player
currently owns: offer id, namespace, title and acquisition time, never an order id, price or payment
field. If the worker cannot reach Epic, the same reader runs inside an open `accounts.epicgames.com`
tab; with no such tab the page is told `tab-required`. The only permission it added is the host
`https://accounts.epicgames.com/*`; Firefox needs 127.0 or later.

Since 1.1.0 it also carries out the Write-Back the player reviewed on that page. When the page has
armed a batch, the same click removes each named dismissal from the player's Steam ignore list (one
`ignorerecommendation` POST per game, from the background worker, under the player's own Steam
session), re-reads `dynamicstore/userdata` to observe which dismissals are really gone, and hands a
per-game `executed` or `failed` result back to the page through a page-owned function. Nothing is sent
to subtails by the extension, and no manifest permission was added for it.

This project is a first-class Nx project (`extensions/store-exporter`) but is deliberately
**unimportable** from the rest of the monorepo and **not a deployable**: nothing in
`packages/**`/`apps/**`/`src/**` may depend on it, it may depend on nothing but
`@subtails/contracts`, and the root `project.json`/`vercel.json` name no `extensions/` path
(`packages/workspace-guards/src/__tests__/store-exporter-import-isolation.guard.test.ts` locks all of
this mechanically). The root `subtails` Next app remains the sole deployable.

## Licence

**SPDX: `GPL-3.0-only`.**

This licence covers `extensions/store-exporter/**` **only**. The rest of the monorepo (everything
outside this directory) stays private: the repo root carries no `LICENSE` file and the root
`package.json` is `"private": true` with no `license` field. GPLv3 was applied here by owner decision
(2026-09-01, AD-12) ahead of the first Chrome Web Store / Firefox AMO submission.

No per-file licence headers are added — the repo convention is a purpose docblock at the top of every
file, with zero licence headers anywhere in `packages/**`, `apps/**` or `extensions/**`. GPLv3 headers
are recommended practice, not a validity condition; this one `LICENSE` file plus this statement keep
the convention uniform across the monorepo.

### Third-party attribution

The only third-party code **in the shipped bundle** (`background.js`) is:

- **zod** (MIT) — pulled in through `@subtails/contracts/discovery`. Its licence is copied into every
  release's reproducible source archive as `third-party/zod-LICENSE.txt` (Story 2.3, AC3).

Build-time-only tools that ship nothing into the bundle: **esbuild** (MIT) and **tsx** (MIT).

### Source availability

AMO requires a source submission whenever the reviewed add-on contains bundled or minified code
(`background.js` is an esbuild bundle) — `npx nx run store-exporter:package` always produces
`subtails-store-exporter-<version>-source.zip` for exactly this reason, regardless of how the source
is otherwise made available.

**The source is published in the public repository `subtails/subtails-profile-manager`** (owner
decision, 2026-11-01), and the store listings link to it (`STORE-LISTING.md`). Every new
`EXTENSION_VERSION` on `main` is copied there by `.github/workflows/extension-source-mirror.yml`: it
packages the release, unzips the source archive as one commit and tags it `v<version>`. A change
without a version bump copies nothing. Its front page is `PUBLIC-README.md`, shipped in the source
archive as `README.md`. The workflow pushes with the deploy key in the Actions secret
`EXTENSION_MIRROR_DEPLOY_KEY`.

## Build, package, submit

Every command below runs from the repo root; each Nx target's own `cwd` is pinned to this directory.

```sh
# Build both browser bundles (release channel by default — see "Channel" below).
npx nx run store-exporter:build

# Build + validate + zip + checksum: produces the store-submittable artifacts.
npx nx run store-exporter:package

# Operator-only. Never run in CI, never part of the gate, never uploads without every required
# credential present (see "Secrets" below). Pass the target store as the one CLI argument.
cd extensions/store-exporter
npx tsx submit.ts chrome
npx tsx submit.ts firefox
```

`package` writes to `dist/extensions/store-exporter/release/`:

- `subtails-store-exporter-<version>-chrome-unsigned.zip`
- `subtails-store-exporter-<version>-firefox-unsigned.xpi`
- `subtails-store-exporter-<version>-source.zip`
- `SHA256SUMS.txt`
- `submission.json` (machine data `submit.ts` reads — never prose)

Every filename says `-unsigned` and every `submission.json` entry carries `"signed": false`, on
purpose: neither store accepts a locally-signed artifact. The Chrome Web Store signs and packages the
CRX server-side after a credentialed upload; Firefox AMO signs the XPI as part of its own
submission/review flow. Signing is a store-side act that follows the credentialed hand-off `submit.ts`
performs — nothing this repo can produce is signed.

### Channel

`build.ts`'s `resolveChannel()` defaults to `release` unless `STORE_EXPORTER_CHANNEL=dev` is
explicitly set. `package.ts` **refuses** to package a `dev`-channel build (a dev-channel bundle trusts
any `http://localhost:<port>` page as subtails.com, which must never reach a store). Use the `dev`
channel only for local manual verification against a dev server, never for a build you intend to
package or submit.

### Release steps

1. Bump `EXTENSION_VERSION` in `src/manifest.config.ts`. Every artifact filename, both manifests'
   `version`, and `submission.json`'s `version` all derive from this one constant — never a second
   version literal anywhere in this project
   (`packages/workspace-guards/src/__tests__/store-exporter-version-single-source.guard.test.ts`
   enforces it).
2. Run `npx nx run store-exporter:package`.
3. Both the Chrome Web Store and Firefox AMO **reject a re-used or lower version number** — this is a
   store-enforced fact; there is no local version-history file to check it against, so just bump
   forward.
4. Run `submit.ts` for each store once its six required secrets (below) are present in your shell. Without them nothing is uploaded and the install section on the settings pages stays hidden until both listing URLs in `apps/account/src/lib/extension-install.helpers.ts` are filled.
   Listing text and permission justifications live in `STORE-LISTING.md`; `store-listing.test.ts` fails when a manifest permission has none.
5. Before enabling the `steam-export-extension-install` feature flag (`/profile/settings/steam`,
   Story 2.3 AC5): **`tierGate: 'all'` shows the install section to every signed-in player, in all
   eight locales, the moment the flag is flipped on** — there is no per-tester allow-list in this
   repo, and building one is out of scope for this pipeline. That is a real mismatch with the Chrome
   side, which publishes to `publishTarget=trustedTesters` only (a non-tester who follows the Chrome
   link reaches an item they cannot install); the Firefox side is `channel: 'listed'`, i.e. a public
   AMO listing, so a non-tester following the Firefox link *can* install it. Decide, and record the
   decision here or in the alpha rollout notes, before flipping the flag: either accept that a
   non-tester who finds the Chrome link during the alpha window hits an install they cannot use (the
   alpha is small and short), or hold the flag until the Chrome item's audience is widened to match.
   Silence is not an option — AC5's own reasoning is that a link nobody can use is worse than no link,
   and `tierGate: 'all'` plus `trustedTesters` is exactly that link for anyone outside the tester list.

### Secrets (operator-only, never committed)

`submit.ts` fails loudly and uploads nothing when any of these are absent, naming the exact missing
variable(s). They are documented, commented-out, and value-less in the repo root's `.env.example`.

| Store | Variable |
| --- | --- |
| Chrome Web Store | `CHROME_WEB_STORE_EXTENSION_ID` |
| Chrome Web Store | `CHROME_WEB_STORE_CLIENT_ID` |
| Chrome Web Store | `CHROME_WEB_STORE_CLIENT_SECRET` |
| Chrome Web Store | `CHROME_WEB_STORE_REFRESH_TOKEN` |
| Firefox AMO | `AMO_JWT_ISSUER` |
| Firefox AMO | `AMO_JWT_SECRET` |

Set these in the operator's own shell for a manual run. If submission is ever automated, they belong
in a CircleCI **context** — never a literal value in `.circleci/config.yml`, never `.env.local`, never
a committed file. This project wires no CI credential and creates no CI job for `submit`.
