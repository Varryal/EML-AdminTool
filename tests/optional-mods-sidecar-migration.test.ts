import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { optionalMetadataPath, OptionalModsError, readOptionalMetadata } from '../src/lib/server/optional-mods.ts'

test('v1 path-keyed metadata migrates once and remains byte-stable on the next read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eml-optional-migration-'))
  try {
    const sidecar = optionalMetadataPath(root, 'smp')
    await fs.mkdir(path.dirname(sidecar), { recursive: true })
    await fs.writeFile(sidecar, `${JSON.stringify({
      'mods/sodium-0.6.13.jar': {
        optional: true,
        optionalId: 'sodium',
        title: 'Sodium',
        description: 'Renderer optimization',
        enabledByDefault: true
      }
    })}\n`, 'utf8')

    const first = await readOptionalMetadata(root, 'smp')
    const migratedBytes = await fs.readFile(sidecar, 'utf8')
    assert.equal(first.migrated, true)
    assert.deepEqual(first.groups.sodium.files, ['mods/sodium-0.6.13.jar'])
    assert.match(migratedBytes, /"schemaVersion": 2/)

    const second = await readOptionalMetadata(root, 'smp')
    assert.equal(second.migrated, false)
    assert.equal(await fs.readFile(sidecar, 'utf8'), migratedBytes)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('an unknown sidecar schema is rejected without changing the existing file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eml-optional-schema-'))
  try {
    const sidecar = optionalMetadataPath(root, 'smp')
    await fs.mkdir(path.dirname(sidecar), { recursive: true })
    const original = '{"schemaVersion":99,"groups":{}}\n'
    await fs.writeFile(sidecar, original, 'utf8')

    await assert.rejects(
      readOptionalMetadata(root, 'smp'),
      (error: unknown) => error instanceof OptionalModsError && error.code === 'OPTIONAL_METADATA_SCHEMA_UNSUPPORTED'
    )
    assert.equal(await fs.readFile(sidecar, 'utf8'), original)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
