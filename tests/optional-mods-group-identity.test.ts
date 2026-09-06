import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { mergeOptionalMetadataIntoGroups, pruneOptionalGroupFiles, validateOptionalGroups, type ManifestFile } from '../src/lib/server/optional-mods.ts'

function file(name: string): ManifestFile {
  return {
    name,
    path: 'mods/',
    type: 'MOD',
    size: 12,
    sha1: '0123456789abcdef0123456789abcdef01234567',
    url: `https://launcher.varryal.ru/files/${name}`
  }
}

test('a replacement file can bind to the old group without changing its identity or metadata', () => {
  const oldGroups = validateOptionalGroups({
    schemaVersion: 2,
    groups: {
      sodium: { title: 'Sodium', description: 'Renderer optimization', enabledByDefault: true, files: [] }
    }
  })
  const next = mergeOptionalMetadataIntoGroups(
    oldGroups,
    {
      'mods/sodium-0.6.14.jar': {
        optional: true,
        optionalId: 'sodium',
        title: 'Sodium',
        description: 'Renderer optimization',
        enabledByDefault: true
      }
    },
    [file('sodium-0.6.14.jar')]
  )

  assert.deepEqual(next, {
    sodium: {
      title: 'Sodium',
      description: 'Renderer optimization',
      enabledByDefault: true,
      files: ['mods/sodium-0.6.14.jar']
    }
  })
})

test('removing the last file leaves an orphan group instead of deleting its metadata', () => {
  const groups = validateOptionalGroups({
    schemaVersion: 2,
    groups: {
      sodium: { title: 'Sodium', description: 'Keep this choice', enabledByDefault: true, files: ['mods/sodium.jar'] }
    }
  })
  const orphan = pruneOptionalGroupFiles(groups, 'mods/sodium.jar', false)
  assert.deepEqual(orphan.sodium, {
    title: 'Sodium',
    description: 'Keep this choice',
    enabledByDefault: true,
    files: []
  })
})

test('omitting a current file from the save payload preserves the group as an orphan', () => {
  const existing = validateOptionalGroups({
    schemaVersion: 2,
    groups: {
      sodium: { title: 'Sodium', description: 'Keep this choice', enabledByDefault: true, files: ['mods/sodium.jar'] }
    }
  })
  const next = mergeOptionalMetadataIntoGroups(existing, {}, [file('sodium.jar')])
  assert.deepEqual(next.sodium, {
    title: 'Sodium',
    description: 'Keep this choice',
    enabledByDefault: true,
    files: []
  })
})

test('a file cannot be assigned to two logical groups', () => {
  assert.throws(
    () => validateOptionalGroups({
      schemaVersion: 2,
      groups: {
        first: { title: 'First', description: '', enabledByDefault: false, files: ['mods/shared.jar'] },
        second: { title: 'Second', description: '', enabledByDefault: false, files: ['mods/shared.jar'] }
      }
    }),
    (error: unknown) => (error as { code?: string }).code === 'OPTIONAL_GROUP_CONFLICT'
  )
})
