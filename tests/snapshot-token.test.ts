import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { computeSnapshotToken, createFilteredManifest, OptionalModsError, type ManifestFile, type OptionalGroupSummary, type ManifestLoaderData } from '../src/lib/server/optional-mods.ts'

const loader: ManifestLoaderData = {
  type: 'VANILLA',
  minecraftVersion: 'latest_release',
  loaderVersion: 'latest_release',
  customVersion: null,
  file: null
}

const groups: OptionalGroupSummary[] = [
  { optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }
]

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

test('snapshotToken hashes only the decision surface', () => {
  const token = computeSnapshotToken(groups)
  assert.equal(computeSnapshotToken([...groups].reverse()), token)
  assert.equal(
    computeSnapshotToken([{ ...groups[0], title: 'Sodium', description: 'Renderer', enabledByDefault: true }]),
    token
  )
  assert.notEqual(computeSnapshotToken([{ ...groups[0], title: 'Different' }]), token)
  assert.notEqual(computeSnapshotToken([...groups, { optionalId: 'shaders', title: 'Shaders', description: '', enabledByDefault: false }]), token)
})

test('changing a file version or mandatory inventory does not change snapshotToken', () => {
  const first = [
    file('sodium-0.6.13.jar', { optional: true, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }),
    file('mandatory.jar')
  ]
  const second = [
    file('sodium-0.6.14.jar', { size: 99, sha1: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd', optional: true, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }),
    file('mandatory-new.jar')
  ]
  const firstResponse = createFilteredManifest({ id: 'profile-1', slug: 'smp' }, first, { present: false, ids: [] }, loader)
  const secondResponse = createFilteredManifest({ id: 'profile-1', slug: 'smp' }, second, { present: false, ids: [] }, loader)
  assert.equal(firstResponse.snapshotToken, secondResponse.snapshotToken)
})

test('stale selection returns the current token for retry', () => {
  const files = [file('sodium.jar', { optional: true, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true })]
  const current = createFilteredManifest({ id: 'profile-1', slug: 'smp' }, files, { present: false, ids: [] }, loader)
  assert.throws(
    () => createFilteredManifest({ id: 'profile-1', slug: 'smp' }, files, { present: true, ids: ['sodium'], snapshotToken: '0'.repeat(64) }, loader),
    (error: unknown) => error instanceof OptionalModsError && error.code === 'optional_selection_stale' && error.httpStatus === 409 && error.responseFields.snapshotToken === current.snapshotToken
  )
})
