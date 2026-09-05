import fs from 'node:fs/promises'

const VERSION_PATTERN = /^(\d+\.\d+\.\d+)-varryal\.(\d+)$/

async function run() {
  const requestedVersion = process.argv[2]

  if (!requestedVersion) {
    console.error('❌ Укажите версию Varryal. Пример: npm run release -- 2.8.0-varryal.1')
    process.exit(1)
  }

  const cleanVersion = requestedVersion.replace(/^v/, '')
  const match = VERSION_PATTERN.exec(cleanVersion)

  if (!match) {
    console.error('❌ Некорректная версия Varryal. Ожидается формат X.Y.Z-varryal.N')
    process.exit(1)
  }

  const upstreamVersion = match[1]
  const revision = Number(match[2])
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))

  if (pkg.version !== upstreamVersion) {
    console.error(`❌ В package.json указано ${pkg.version}, а релиз основан на upstream ${upstreamVersion}.`)
    console.error('Сначала синхронизируйте нужную upstream-версию, затем готовьте Varryal-релиз.')
    process.exit(1)
  }

  console.log(`🚀 Подготовка Varryal EML AdminTool ${cleanVersion}...`)

  const forkMetadata = {
    version: cleanVersion,
    upstreamVersion,
    revision,
    upstreamRepository: 'Electron-Minecraft-Launcher/EML-AdminTool'
  }
  await fs.writeFile('varryal.json', `${JSON.stringify(forkMetadata, null, 2)}\n`)

  console.log('📝 Обновление README.md...')
  let readme = await fs.readFile('README.md', 'utf-8')
  readme = readme.replace(
    /badge\/version-([a-zA-Z0-9.\-]+)-orangered/,
    `badge/version-${cleanVersion.replace(/-/g, '--')}-orangered`
  )
  await fs.writeFile('README.md', readme)

  console.log('⚙️ Генерация release-файлов из шаблонов...')
  const templates = [
    { name: 'docker-compose.prod.yml', target: 'docker/docker-compose.prod.yml' },
    { name: 'changelog.md', target: `.github/changelogs/v${cleanVersion}.md` }
  ]

  for (const file of templates) {
    let content = await fs.readFile(`.github/templates/${file.name}`, 'utf-8')
    content = content.replace(/\{\{VERSION\}\}/g, cleanVersion)
    await fs.writeFile(file.target, content)
  }

  console.log('✅ Подготовка релиза завершена!')
  console.log('\nСледующие шаги:')
  console.log(`1. Заполните changelog .github/changelogs/v${cleanVersion}.md`)
  console.log('2. Выполните npm ci, npx prisma generate --no-hints, npm run check и npm run build')
  console.log('3. Закоммитьте сгенерированные файлы в отдельную ветку и влейте их в main через проверенный PR')
  console.log(`4. Поставьте tag v${cleanVersion} на слитый commit из main`)
  console.log('5. Отправьте tag; workflow релиза проверит metadata и только после этого опубликует релиз')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
