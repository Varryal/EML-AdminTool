import fs from 'node:fs/promises'

const VERSION_PATTERN = /^(\d+\.\d+\.\d+)-varryal\.(\d+)$/

async function run() {
  const requestedVersion = process.argv[2]

  if (!requestedVersion) {
    console.error('❌ Please provide a Varryal version. Example: npm run release -- 2.8.0-varryal.1')
    process.exit(1)
  }

  const cleanVersion = requestedVersion.replace(/^v/, '')
  const match = VERSION_PATTERN.exec(cleanVersion)

  if (!match) {
    console.error('❌ Invalid Varryal version. Expected X.Y.Z-varryal.N')
    process.exit(1)
  }

  const upstreamVersion = match[1]
  const revision = Number(match[2])
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))

  if (pkg.version !== upstreamVersion) {
    console.error(`❌ package.json is ${pkg.version}, but this release is based on upstream ${upstreamVersion}.`)
    console.error('Sync the requested upstream version first, then prepare the Varryal release.')
    process.exit(1)
  }

  console.log(`🚀 Preparing Varryal EML AdminTool ${cleanVersion}...`)

  const forkMetadata = {
    version: cleanVersion,
    upstreamVersion,
    revision,
    upstreamRepository: 'Electron-Minecraft-Launcher/EML-AdminTool'
  }
  await fs.writeFile('varryal.json', `${JSON.stringify(forkMetadata, null, 2)}\n`)

  console.log('📝 Updating README.md...')
  let readme = await fs.readFile('README.md', 'utf-8')
  readme = readme.replace(
    /badge\/version-([a-zA-Z0-9.\-]+)-orangered/,
    `badge/version-${cleanVersion.replace(/-/g, '--')}-orangered`
  )
  await fs.writeFile('README.md', readme)

  console.log('⚙️ Generating release files from templates...')
  const templates = [
    { name: 'docker-compose.prod.yml', target: 'docker/docker-compose.prod.yml' },
    { name: 'changelog.md', target: `.github/changelogs/v${cleanVersion}.md` }
  ]

  for (const file of templates) {
    let content = await fs.readFile(`.github/templates/${file.name}`, 'utf-8')
    content = content.replace(/\{\{VERSION\}\}/g, cleanVersion)
    await fs.writeFile(file.target, content)
  }

  console.log('✅ Release preparation complete!')
  console.log('\nNext steps:')
  console.log(`1. Write the changelog in .github/changelogs/v${cleanVersion}.md`)
  console.log('2. Run npm ci, npx prisma generate --no-hints, npm run check and npm run build')
  console.log('3. Commit the generated files to main through a reviewed PR')
  console.log(`4. Tag the merged main commit as v${cleanVersion}`)
  console.log(`5. Push the tag; the Release workflow will verify metadata before publishing`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
