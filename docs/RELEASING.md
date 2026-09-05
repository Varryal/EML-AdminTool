# Выпуск новой версии Varryal EML AdminTool

Релизы форка Varryal используют формат:

```text
<upstream-version>-varryal.<revision>
```

Пример: `2.8.0-varryal.1`.

`package.json` хранит версию upstream EML AdminTool. `varryal.json` хранит собственную версию форка Varryal и обязан ссылаться на ту же upstream-версию.

Старые теги вида `v2.7.1`/`v2.7.2`, созданные до формализации форка, не являются шаблоном для новых релизов. Новые релизы публикуются только в формате `X.Y.Z-varryal.N`.

## 1. Подготовить файлы релиза

Работайте в отдельной reviewed-ветке, основанной на нужной upstream-версии. Запустите:

```sh
npm run release -- 2.8.0-varryal.1
```

Скрипт:

- проверит, что upstream-часть версии совпадает с `package.json.version`;
- обновит `varryal.json`;
- обновит badge версии в README;
- сгенерирует release Compose;
- создаст файл changelog в `.github/changelogs/`.

После этого заполните сгенерированный changelog.

## 2. Проверить исходники

Выполните:

```sh
npm ci
npx prisma generate --no-hints
npm run check
npm run build
```

Закоммитьте подготовленные файлы в отдельную ветку, откройте PR в `main` и дождитесь успешного CI. Не создавайте release tag на неслитой ветке.

## 3. Создать tag

После merge release-подготовки и успешного CI поставьте tag **на точный commit из `main`**:

```sh
git pull --ff-only
git tag -a v2.8.0-varryal.1 <commit-sha> -m "v2.8.0-varryal.1"
git push origin v2.8.0-varryal.1
```

Workflow `Релиз Varryal EML AdminTool` остановится с ошибкой, если:

- tag не содержится в `main`;
- версия tag не совпадает с `varryal.json`;
- `varryal.json.upstreamVersion` не совпадает с `package.json.version`;
- отсутствует changelog;
- проверка исходников не проходит.

Если все проверки успешны, GitHub Actions:

1. собирает Docker image для `linux/amd64` и `linux/arm64`;
2. публикует `ghcr.io/varryal/eml-admintool:<version>`;
3. обновляет `ghcr.io/varryal/eml-admintool:varryal-latest`;
4. создаёт GitHub Release.

## 4. Развернуть релиз отдельно

**Публикация релиза сама по себе ничего не меняет на VDS.** Production deployment выполняется отдельно из репозитория `VarryalLauncher`.

Нормальная последовательность:

1. проверить текущий `main` через `[HOTFIX] EML AdminTool`, если нужна проверка на live-сайте до релиза;
2. выпустить официальный Varryal-релиз по процедуре выше;
3. взять digest опубликованного release image;
4. обновить `infra/compose/compose.prod.yml` в `VarryalLauncher`, закрепив `<version>@sha256:<digest>`;
5. проверить изменение через PR/CI;
6. вручную запустить `[PROD] EML AdminTool`.

HOTFIX не заменяет официальный релиз и не меняет production pin в репозитории.

## Обновление с upstream

Не создавайте tag новой upstream-версии напрямую. Сначала выполните процедуру из `docs/UPSTREAM_SYNC.md`, полностью проверьте интеграцию и только после этого начинайте новую ревизию Varryal на обновлённой upstream-базе.
