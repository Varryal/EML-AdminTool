import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { createFilteredManifest, OptionalModsError, parseOptionalSelection, type ManifestFile, type ManifestLoaderData } from '../src/lib/server/optional-mods.ts'

const loader: ManifestLoaderData = {
  type: 'NEOFORGE',
  minecraftVersion: '1.21.1',
  loaderVersion: '21.1.200',
  customVersion: null,
  file: null
}

function file(name: string, overrides: Partial<ManifestFile> = {}): ManifestFile {
  return {
    name,
    path: 'mods/',
    type: 'MOD',
    size: 12,
    sha1: '0123456789abcdef0123456789abcdef01234567',
    url: `https://launcher.varryal.ru/files/${name}`,
    ...overrides
  }
}

function manifestFiles(): ManifestFile[] {
  return [
    { name: 'config.txt', path: 'config/', type: 'CONFIG', size: 1, sha1: '0123456789abcdef0123456789abcdef01234567', url: 'https://launcher.varryal.ru/files/config.txt' },
    file('sodium-0.6.14.jar', { optional: true, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }),
    file('sodium-extra-0.6.14.jar', { optional: true, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }),
    file('shaders.jar', { optional: true, optionalId: 'shaders', title: 'Shaders', description: 'Shader support', enabledByDefault: false })
  ]
}

function codeOf(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    assert.ok(error instanceof OptionalModsError)
    return error.code
  }
  assert.fail('Expected OptionalModsError')
}

test('server filtering preserves mandatory files and filters only by optionalId', () => {
  const files = manifestFiles()
  const all = createFilteredManifest({ id: 'profile-1', slug: 'smp' }, files, { present: false, ids: [] }, loader)
  assert.equal(all.files.length, 4)

  const empty = createFilteredManifest(
    { id: 'profile-1', slug: 'smp' },
    files,
    { present: true, ids: [], snapshotToken: all.snapshotToken },
    loader
  )
  assert.deepEqual(empty.files.map((entry) => entry.name), ['config.txt'])

  const sodium = createFilteredManifest(
    { id: 'profile-1', slug: 'smp' },
    files,
    { present: true, ids: ['sodium'], snapshotToken: all.snapshotToken },
    loader
  )
  assert.deepEqual(sodium.files.map((entry) => entry.name), ['config.txt', 'sodium-0.6.14.jar', 'sodium-extra-0.6.14.jar'])
})

test('selection validation rejects unknown and malformed IDs, missing tokens, and oversized queries', () => {
  const token = 'a'.repeat(64)
  assert.equal(codeOf(() => parseOptionalSelection(new URLSearchParams('optional=Bad&snapshotToken=' + token))), 'invalid_optional_selection')
  assert.equal(codeOf(() => parseOptionalSelection(new URLSearchParams('optional=sodium'))), 'invalid_optional_selection')
  assert.equal(codeOf(() => parseOptionalSelection(new URLSearchParams('optional=a&snapshotToken=' + token), 32 * 1024 + 1)), 'optional_selection_too_large')
  assert.equal(codeOf(() => parseOptionalSelection(new URLSearchParams(`optional=${Array.from({ length: 2001 }, (_, index) => `g${index}`).join(',')}&snapshotToken=${token}`))), 'optional_selection_too_large')
})

test('unknown IDs are rejected instead of being silently ignored', () => {
  const files = manifestFiles()
  const response = createFilteredManifest({ id: 'profile-1', slug: 'smp' }, files, { present: false, ids: [] }, loader)
  assert.equal(
    codeOf(() => createFilteredManifest(
      { id: 'profile-1', slug: 'smp' },
      files,
      { present: true, ids: ['missing'], snapshotToken: response.snapshotToken },
      loader
    )),
    'invalid_optional_selection'
  )
})
