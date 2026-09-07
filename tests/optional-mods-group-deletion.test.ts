import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { mergeOptionalMetadataIntoGroups, validateOptionalGroups, type ManifestFile } from '../src/lib/server/optional-mods.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { cloneOptionalModsDraft, rebaseOptionalModsDraft, type OptionalModsDraftState } from '../src/lib/utils/optional-mods-ui.ts'

function file(name: string): ManifestFile {
  return { name, path: 'mods/', type: 'MOD', size: 1, sha1: '0123456789abcdef0123456789abcdef01234567' }
}

function draftWithGroup(title = 'Sodium'): OptionalModsDraftState {
  return {
    groups: { sodium: { title, description: 'Renderer', enabledByDefault: true, files: ['mods/sodium.jar'] } },
    drafts: { 'mods/sodium.jar': { optional: true, optionalId: 'sodium', title, description: 'Renderer', enabledByDefault: true } }
  }
}

test('group deletion is explicit: omitted metadata preserves an orphan, removal IDs delete it', () => {
  const existing = validateOptionalGroups({ schemaVersion: 2, groups: { sodium: { title: 'Sodium', description: 'Renderer', enabledByDefault: true, files: ['mods/sodium.jar'] } } })
  const inventory = [file('sodium.jar')]
  const orphan = mergeOptionalMetadataIntoGroups(existing, {}, inventory)
  const deleted = mergeOptionalMetadataIntoGroups(existing, {}, inventory, ['sodium'])

  assert.deepEqual(orphan.sodium.files, [])
  assert.equal(deleted.sodium, undefined)
})

test('remote group deletion wins unless the operator edited that group locally', () => {
  const base = draftWithGroup()
  const unchangedLocal = cloneOptionalModsDraft(base)
  const remoteDeletion = { groups: {}, drafts: {} }
  assert.deepEqual(rebaseOptionalModsDraft(base, unchangedLocal, remoteDeletion).groups, {})

  const editedLocal = cloneOptionalModsDraft(base)
  editedLocal.groups.sodium.title = 'Edited locally'
  const preserved = rebaseOptionalModsDraft(base, editedLocal, remoteDeletion)
  assert.equal(preserved.groups.sodium.title, 'Edited locally')
})
