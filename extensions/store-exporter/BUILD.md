# Reproducing this build

This file is copied into the root of `…-source.zip` (Story 2.3, AC3) — the reproducible source
archive AMO requires whenever a reviewed add-on contains bundled or minified code, which
`background.js` (an esbuild bundle) is. These are the literal steps; there is no additional tooling. The build includes the one-click Write-Back
executor (`src/adapters/steam.ts`, `writeBack`), which posts only to `store.steampowered.com`.

1. **Node**: use the version pinned in the repo root's `.nvmrc` (currently `24`).
2. **Install the pinned dependencies** from the repo root, using the `package.json` and
   `package-lock.json` included in this archive:

   ```sh
   npm ci
   ```

3. **Build both browser bundles** through the repo's own Nx target:

   ```sh
   npx nx run store-exporter:build
   ```

4. **The output lands at** `dist/extensions/store-exporter/{chrome,firefox}/`, each directory a
   complete, loadable MV3 bundle (`manifest.json`, `background.js`, `icons/*.png`).

Packaging (the ZIP/XPI/checksums/`submission.json` this archive itself came from) is a separate,
deterministic step — `npx nx run store-exporter:package` — documented in this project's
`README.md`, not required to merely reproduce the bundle above.
