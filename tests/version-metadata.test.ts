import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { formatVersionLabel, resolveVersionMetadata } from '../src/lib/utils/version.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replaceAll('\r\n', '\n')
}

test('PREPROD metadata is explicit and uses the short main build identifier', () => {
  const metadata = resolveVersionMetadata('2.7.0-varryal.3', {
    VARRYAL_CHANNEL: 'preprod',
    VARRYAL_VERSION: '2.7.0-varryal.1',
    VARRYAL_BUILD_ID: 'main-a58f6b1'
  })

  assert.deepEqual(metadata, {
    channel: 'preprod',
    varryalVersion: '2.7.0-varryal.1',
    buildId: 'main-a58f6b1'
  })
  assert.equal(formatVersionLabel(metadata), 'EML AdminTool 2.7.0-varryal.1 · PREPROD · main-a58f6b1')
})

test('production metadata has safe repository fallbacks', () => {
  const metadata = resolveVersionMetadata('2.7.0-varryal.1')

  assert.deepEqual(metadata, {
    channel: 'prod',
    varryalVersion: '2.7.0-varryal.1',
    buildId: 'release-2.7.0-varryal.1'
  })
  assert.equal(formatVersionLabel(metadata), 'EML AdminTool 2.7.0-varryal.1 · PROD · release-2.7.0-varryal.1')
})

test('invalid deployment metadata is rejected instead of being displayed as production', () => {
  assert.throws(() => resolveVersionMetadata('2.7.0-varryal.1', { VARRYAL_CHANNEL: 'staging' }), /VARRYAL_CHANNEL/)
  assert.throws(() => resolveVersionMetadata('2.7.0-varryal.1', { VARRYAL_BUILD_ID: 'main sha' }), /VARRYAL_BUILD_ID/)
})

test('footer renders two lines, colors both channels, and keeps the existing link order', () => {
  const footer = read('src/components/layouts/Footer.svelte')

  assert.match(footer, /EML AdminTool \{env\.varryalVersion\}/)
  assert.match(footer, /class:preprod=\{env\.channel === 'preprod'\}/)
  assert.match(footer, /class:prod=\{env\.channel === 'prod'\}/)
  assert.match(footer, /#e67e22/)
  assert.match(footer, /#2e9b50/)
  assert.ok(footer.indexOf('<br />') < footer.indexOf('https://emlproject.com/discord/other'))

  const links = [
    'https://emlproject.com/discord/other',
    'https://emlproject.com/docs',
    'https://github.com/Electron-Minecraft-Launcher/EML-AdminTool',
    'https://github.com/Electron-Minecraft-Launcher/EML-AdminTool/issues/new?template=bug.md'
  ]
  const positions = links.map((link) => footer.indexOf(link))
  assert.ok(positions.every((position) => position >= 0))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  assert.doesNotMatch(footer, /upstreamVersion|env\.version/)
})
