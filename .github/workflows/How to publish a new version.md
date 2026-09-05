# How to publish a Varryal release

Varryal releases use the version format:

```text
<upstream-version>-varryal.<revision>
```

Example: `2.8.0-varryal.1`.

`package.json` keeps the upstream EML AdminTool version. `varryal.json` stores the Varryal release version and must reference the same upstream version.

## 1. Prepare the release files

From a reviewed branch based on the intended upstream version, run:

```sh
npm run release -- 2.8.0-varryal.1
```

The release script validates that the upstream part of the requested version matches `package.json`, updates `varryal.json` and the README badge, and generates the release compose and changelog file.

Fill in the generated changelog under `.github/changelogs/`.

## 2. Verify the source

Run:

```sh
npm ci
npx prisma generate --no-hints
npm run check
npm run build
```

Commit the generated files through a reviewed PR into `main`. Do not tag an unmerged branch.

## 3. Create the tag

After the release preparation PR is merged and CI passes, tag the exact `main` commit:

```sh
git pull --ff-only
git tag -a v2.8.0-varryal.1 <commit-sha> -m "v2.8.0-varryal.1"
git push origin v2.8.0-varryal.1
```

The `Release Varryal EML AdminTool` workflow will refuse the release if:

- the tag is not contained in `main`;
- the tag does not match `varryal.json`;
- `varryal.json.upstreamVersion` does not match `package.json.version`;
- the changelog is missing;
- source verification fails.

If verification succeeds, Actions publishes `ghcr.io/varryal/eml-admintool:<version>` and `ghcr.io/varryal/eml-admintool:varryal-latest`, then creates the GitHub Release.

## 4. Deploy separately

Publishing a release does not deploy it to the Varryal VPS. Production deployment remains a separate, manual infrastructure action in `VarryalLauncher` and should pin the selected image by digest.

## Upstream releases

Never tag an upstream version directly in this repository. Follow `docs/UPSTREAM_SYNC.md` first, then start a new Varryal revision from the integrated upstream base.
