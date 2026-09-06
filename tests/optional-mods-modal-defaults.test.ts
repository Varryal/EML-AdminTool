import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { optionalModIdFromFilename, optionalModTitleFromFilename } from '../src/lib/utils/optional-mods-ui.ts'

test('new group defaults omit the version, loader suffix, and jar extension', () => {
  const filename = 'BiomesOPlenty-neoforge-1.21.1-21.1.0.14.jar'
  assert.equal(optionalModTitleFromFilename(filename).includes('.jar'), false)
  assert.equal(optionalModTitleFromFilename(filename).includes('21.1.0.14'), false)
  assert.equal(optionalModIdFromFilename(filename), 'biomesoplenty')
})

test('the default label is represented by a missing decision, not a new-profile claim', async () => {
  const locale = await fs.readFile(new URL('../src/lib/locales/en.ts', import.meta.url), 'utf8')
  const label = locale.match(/enabledByDefault: `([^`]+)`/)?.[1] ?? ''
  assert.match(label, /without a saved choice/i)
  assert.doesNotMatch(label, /new profile/i)
})
