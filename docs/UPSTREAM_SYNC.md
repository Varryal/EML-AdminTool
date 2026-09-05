# Правила синхронизации с upstream

`Varryal/EML-AdminTool` — поддерживаемый форк `Electron-Minecraft-Launcher/EML-AdminTool` для Varryal.

Форк не должен автоматически сливать или автоматически разворачивать новые upstream-релизы. В upstream могут появиться миграции базы данных, изменения API, Docker или интерфейса, конфликтующие с Varryal-специфичными возможностями, например с опциональными модами.

## Модель версий

Версии Varryal имеют формат:

```text
<upstream-version>-varryal.<revision>
```

Примеры:

```text
2.7.0-varryal.3
2.8.0-varryal.1
```

`package.json` хранит upstream-версию приложения. `varryal.json` хранит идентификатор релиза Varryal; его `upstreamVersion` должен совпадать с `package.json.version`.

## Процедура синхронизации

1. Определите точный upstream release/tag, который нужно интегрировать.
2. Создайте ветку `upstream-sync/<version>` от текущего Varryal `main`.
3. Влейте выбранный upstream tag в эту ветку. Никогда не сливайте upstream напрямую в `main`.
4. Разрешайте конфликты вручную и осознанно, сохраняя Varryal-специфичное поведение.
5. Для новой upstream-базы установите в `varryal.json` версию `<upstream-version>-varryal.1`.
6. До deployment обязательно просмотрите все upstream-изменения Prisma schema/migrations.
7. Отдельно проверьте области, чувствительные к совместимости:
   - контракты Files Updater manifest/API;
   - metadata и UI опциональных модов;
   - loader/profile API, которые использует VarryalLauncher;
   - Docker entrypoint, environment и ожидания по volumes;
   - authentication, maintenance и updater behavior.
8. Выполните:

```sh
npm ci
npx prisma generate --no-hints
npm run check
npm run build
```

9. Откройте PR в `main` и просмотрите полный upstream diff вместе со всеми разрешёнными конфликтами.
10. Выполняйте merge только после успешного CI и понимания изменений миграций/API.
11. Подготовьте Varryal-релиз командой `npm run release -- <upstream-version>-varryal.<revision>`.
12. Поставьте tag на проверенный commit из `main`. Workflow релиза опубликует неизменяемый GHCR image.
13. Production deployment остаётся отдельным ручным действием из инфраструктуры `VarryalLauncher`.

## Правило deployment

Сам факт появления нового upstream-релиза носит только информационный характер. Он не должен автоматически запускать production deployment.

Production должен использовать явно проверенный image, закреплённый по digest. База данных и постоянные volumes никогда не удаляются в рамках обычного обновления приложения.

Подробная процедура выпуска собственной версии Varryal описана в `docs/RELEASING.md`.
