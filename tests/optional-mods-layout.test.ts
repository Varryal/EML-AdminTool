import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { createOptionalModsDraft, optionalModFileKey, type OptionalModFileLike } from '../src/lib/utils/optional-mods-ui.ts'

test('long file names remain stable row identities instead of changing group data', () => {
  const longName = `sodium-${'very-long-release-name-'.repeat(12)}1.21.1.jar`
  const file: OptionalModFileLike = { name: longName, path: 'mods/', type: 'MOD' }
  const key = optionalModFileKey(file)
  const state = createOptionalModsDraft([file], {})

  assert.equal(key, `mods/${longName}`)
  assert.equal(Object.keys(state.drafts).length, 1)
  assert.equal(state.drafts[key].optional, false)
})

test('changing the available group set does not remove the file row from draft state', () => {
  const file: OptionalModFileLike = { name: 'sodium.jar', path: 'mods/', type: 'MOD', optional: true, optionalId: 'sodium', title: 'Sodium', description: '', enabledByDefault: false }
  const state = createOptionalModsDraft([file], { sodium: { title: 'Sodium', description: '', enabledByDefault: false, files: ['mods/sodium.jar'] } })
  const withoutGroups = createOptionalModsDraft([file], {})

  assert.equal(Object.keys(state.drafts).length, 1)
  assert.equal(Object.keys(withoutGroups.drafts).length, 1)
  assert.equal(withoutGroups.drafts['mods/sodium.jar'].optional, true)
})
