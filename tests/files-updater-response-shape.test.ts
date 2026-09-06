import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { createFilteredManifest, type ManifestFile, type ManifestLoaderData } from '../src/lib/server/optional-mods.ts'

test('filtered response contains explicit groups, token, profile binding, and loader data', () => {
  const files: ManifestFile[] = [
    { name: 'sodium.jar', path: 'mods/', type: 'MOD', size: 1, sha1: '0123456789abcdef0123456789abcdef01234567', url: 'https://launcher.varryal.ru/files/sodium.jar', optional: true, optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }
  ]
  const loader: ManifestLoaderData = {
    type: 'NEOFORGE',
    minecraftVersion: '1.21.1',
    loaderVersion: '21.1.200',
    customVersion: 'custom',
    file: { url: 'https://launcher.varryal.ru/loader.json' }
  }

  const response = createFilteredManifest({ id: 'profile-1', slug: 'smp' }, files, { present: false, ids: [] }, loader)
  assert.deepEqual(response.profile, { id: 'profile-1', slug: 'smp' })
  assert.equal(response.optionalModsSchemaVersion, 2)
  assert.match(response.snapshotToken, /^[0-9a-f]{64}$/)
  assert.deepEqual(response.optional, [{ optionalId: 'sodium', title: 'Sodium', description: 'Renderer', enabledByDefault: true }])
  assert.deepEqual(response.loader, loader)
  assert.deepEqual(response.files, files)
})
