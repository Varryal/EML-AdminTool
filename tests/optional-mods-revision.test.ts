import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { applyOptionalMetadata, computeOptionalModsRevision, type ManifestFile } from '../src/lib/server/optional-mods.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { computePublishedOptionalModsRevision, matchesPublishedOptionalModsRevision } from '../src/lib/server/optional-mods-revision.ts'

function file(name: string, overrides: Partial<ManifestFile> = {}): ManifestFile {
  return {
    name,
    path: 'mods/',
    type: 'MOD',
    size: 12,
    sha1: `${name.replace(/[^a-z]/g, '0').padEnd(40, '0').slice(0, 40)}`,
    ...overrides
  }
}

const sodium = { optional: true as const, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }

test('editor revisions are compared against the published cache, not a live-only inventory', () => {
  const published = applyOptionalMetadata([file('sodium.jar')], { 'mods/sodium.jar': sodium })
  const liveOnlyInventory = [...published, file('debug-only.jar')]
  const revision = computePublishedOptionalModsRevision(published)

  assert.equal(matchesPublishedOptionalModsRevision(published, revision), true)
  assert.equal(matchesPublishedOptionalModsRevision(liveOnlyInventory, revision), false)
  assert.notEqual(computeOptionalModsRevision(liveOnlyInventory), revision)
})

test('a published metadata decision changes the next editor revision', () => {
  const inventory = [file('sodium.jar')]
  const enabled = applyOptionalMetadata(inventory, { 'mods/sodium.jar': sodium })
  const disabled = applyOptionalMetadata(inventory, { 'mods/sodium.jar': { ...sodium, enabledByDefault: false } })
  assert.notEqual(computePublishedOptionalModsRevision(enabled), computePublishedOptionalModsRevision(disabled))
})
