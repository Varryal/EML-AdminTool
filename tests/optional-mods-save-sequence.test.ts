import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { applyOptionalMetadata, mergeOptionalMetadataIntoGroups, groupsFromOptionalMetadata, type ManifestFile } from '../src/lib/server/optional-mods.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { computePublishedOptionalModsRevision, matchesPublishedOptionalModsRevision } from '../src/lib/server/optional-mods-revision.ts'

function file(name: string): ManifestFile {
  return { name, path: 'mods/', type: 'MOD', size: 12, sha1: name.padEnd(40, '0').slice(0, 40) }
}

const initialMetadata = {
  'mods/sodium.jar': { optional: true as const, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true },
  'mods/iris.jar': { optional: true as const, optionalId: 'iris', title: 'Iris', description: 'Shaders', enabledByDefault: false }
}

test('delete-save-then-edit-save stays conflict-free in one editor session', () => {
  const inventory = [file('sodium.jar'), file('iris.jar')]
  let groups = groupsFromOptionalMetadata(initialMetadata)
  let published = applyOptionalMetadata(inventory, initialMetadata)
  let revision = computePublishedOptionalModsRevision(published)

  const afterDelete = {
    'mods/iris.jar': initialMetadata['mods/iris.jar']
  }
  assert.equal(matchesPublishedOptionalModsRevision(published, revision), true)
  groups = mergeOptionalMetadataIntoGroups(groups, afterDelete, inventory, ['sodium'])
  published = applyOptionalMetadata(inventory, afterDelete)
  revision = computePublishedOptionalModsRevision(published)

  const afterTitleEdit = {
    'mods/iris.jar': { ...afterDelete['mods/iris.jar'], title: 'Iris Updated' }
  }
  assert.equal(matchesPublishedOptionalModsRevision(published, revision), true)
  groups = mergeOptionalMetadataIntoGroups(groups, afterTitleEdit, inventory)

  assert.equal(groups.sodium, undefined)
  assert.equal(groups.iris.title, 'Iris Updated')
})
