import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { createOptionalModsDraft, optionalModFileKey, rebaseOptionalModsDraft, switchValueForKey, type OptionalModFileLike } from '../src/lib/utils/optional-mods-ui.ts'

function file(name: string, optional = false): OptionalModFileLike {
  return { name, path: 'mods/', type: 'MOD', optional, optionalId: optional ? 'sodium' : undefined, title: optional ? 'Sodium' : undefined, description: optional ? 'Renderer' : undefined, enabledByDefault: optional }
}

test('file state and group assignment are represented independently', () => {
  const state = createOptionalModsDraft([file('sodium.jar', true), file('iris.jar')], {
    sodium: { title: 'Sodium', description: 'Renderer', enabledByDefault: true, files: ['mods/sodium.jar'] }
  })

  assert.equal(state.drafts['mods/sodium.jar'].optional, true)
  assert.equal(state.drafts['mods/sodium.jar'].optionalId, 'sodium')
  assert.equal(state.drafts['mods/iris.jar'].optional, false)
  assert.deepEqual(state.groups.sodium.files, ['mods/sodium.jar'])
})

test('a keyboard switch changes only on Enter or Space', () => {
  assert.equal(switchValueForKey(false, 'Enter'), true)
  assert.equal(switchValueForKey(true, ' '), false)
  assert.equal(switchValueForKey(false, 'ArrowRight'), undefined)
})

test('rebase keeps every file addressable after an assignment change', () => {
  const oldFile = file('very-long-sodium-neoforge-1.21.1-21.1.0.14.jar', true)
  const base = createOptionalModsDraft([oldFile], {
    sodium: { title: 'Sodium', description: 'Renderer', enabledByDefault: true, files: ['mods/very-long-sodium-neoforge-1.21.1-21.1.0.14.jar'] }
  })
  const local = createOptionalModsDraft([oldFile], {
    sodium: { title: 'Sodium', description: 'Renderer', enabledByDefault: true, files: ['mods/very-long-sodium-neoforge-1.21.1-21.1.0.14.jar'] }
  })
  local.drafts[optionalModFileKey(oldFile)].optional = false
  const fresh = createOptionalModsDraft([oldFile], base.groups)
  const rebased = rebaseOptionalModsDraft(base, local, fresh)
  assert.deepEqual(Object.keys(rebased.drafts), [optionalModFileKey(oldFile)])
  assert.equal(rebased.drafts[optionalModFileKey(oldFile)].optional, false)
})
