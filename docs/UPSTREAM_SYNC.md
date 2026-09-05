# Upstream sync policy

`Varryal/EML-AdminTool` is a maintained Varryal fork of `Electron-Minecraft-Launcher/EML-AdminTool`.

The fork must never auto-merge or auto-deploy an upstream release. Upstream changes can include database migrations, API changes, Docker changes, or UI changes that conflict with Varryal-specific features such as optional mods.

## Version model

Varryal versions use:

```text
<upstream-version>-varryal.<revision>
```

Examples:

```text
2.7.0-varryal.3
2.8.0-varryal.1
```

`package.json` keeps the upstream application version. `varryal.json` records the Varryal release identity and must have an `upstreamVersion` equal to `package.json.version`.

## Sync procedure

1. Identify the exact upstream release/tag to integrate.
2. Create `upstream-sync/<version>` from the current Varryal `main`.
3. Merge the selected upstream tag into that branch. Never merge upstream directly into `main`.
4. Resolve conflicts deliberately, preserving Varryal-specific behavior.
5. Set `varryal.json` to `<upstream-version>-varryal.1` for a new upstream base.
6. Review all upstream Prisma schema/migration changes before deployment.
7. Review compatibility-sensitive areas:
   - Files Updater manifest/API contracts.
   - Optional mod metadata and UI.
   - Loader/profile APIs consumed by VarryalLauncher.
   - Docker entrypoint, environment and volume expectations.
   - Authentication, maintenance and updater behavior.
8. Run:

```sh
npm ci
npx prisma generate --no-hints
npm run check
npm run build
```

9. Open a PR into `main` and review the complete upstream diff plus conflict resolutions.
10. Merge only after CI passes and migration/API compatibility is understood.
11. Prepare a Varryal release with `npm run release -- <upstream-version>-varryal.<revision>`.
12. Tag the reviewed `main` commit. The Release workflow publishes the immutable GHCR image.
13. Production deployment remains a separate manual action from `VarryalLauncher` infrastructure.

## Deployment rule

An upstream release becoming available is informational only. It must not trigger a production deployment by itself.

Production must use an explicitly reviewed image, preferably pinned by digest. Database and persistent data volumes must never be deleted as part of an ordinary application update.
