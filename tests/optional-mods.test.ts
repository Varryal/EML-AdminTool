import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { createCanonicalManifest, createManifestError, computeOptionalModsRevision, applyOptionalMetadata, OptionalModsError, optionalMetadataPath, pruneOptionalMetadataKeys, readOptionalMetadata, renameOptionalMetadataKeys, validateOptionalMetadata, validatePublishedManifest, withProfileMutations, writeAtomicText, type AtomicFileSystem, type ManifestFile } from '../src/lib/server/optional-mods.ts'

function file(name: string, overrides: Partial<ManifestFile> = {}): ManifestFile {
  return {
    name,
    path: 'mods/',
    type: 'MOD',
    size: 12,
    sha1: '0123456789abcdef0123456789abcdef01234567',
    url: `https://launcher.varryal.ru/files/files-updater/smp/mods/${name}`,
    ...overrides
  }
}

function errorCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof OptionalModsError && error.code === code)
}

test('optional metadata validates a multi-file logical group and normalizes deterministic keys', () => {
  const files = [file('b.jar'), file('a.jar')]
  const metadata = validateOptionalMetadata(
    {
      'mods/b.jar': { optional: true, optionalId: 'shared', title: ' Shared title ', description: 'same', enabledByDefault: true },
      'mods/a.jar': { optional: true, optionalId: 'shared', title: 'Shared title', description: 'same', enabledByDefault: true }
    },
    files
  )

  assert.deepEqual(Object.keys(metadata), ['mods/a.jar', 'mods/b.jar'])
  assert.equal(metadata['mods/a.jar'].title, 'Shared title')
  assert.equal(metadata['mods/b.jar'].optionalId, 'shared')
})

test('malformed sidecar/submission values are rejected before string operations', () => {
  const files = [file('example.jar')]
  errorCode(() => validateOptionalMetadata({ 'mods/example.jar': { optional: true, optionalId: 'x', title: 42, description: '', enabledByDefault: true } }, files), 'OPTIONAL_METADATA_INVALID')
  errorCode(() => validateOptionalMetadata({ 'mods/example.jar': { optional: true, optionalId: 'x', title: 'x', description: '', enabledByDefault: 'yes' } }, files), 'OPTIONAL_METADATA_INVALID')
  errorCode(() => validateOptionalMetadata({ 'mods/missing.jar': { optional: true, optionalId: 'x', title: 'x', description: '', enabledByDefault: true } }, files), 'OPTIONAL_METADATA_INVALID')
})

test('conflicting metadata for one optional ID is rejected instead of first-entry-wins', () => {
  const files = [file('a.jar'), file('b.jar')]
  errorCode(
    () => validateOptionalMetadata({
      'mods/a.jar': { optional: true, optionalId: 'shared', title: 'A', description: '', enabledByDefault: true },
      'mods/b.jar': { optional: true, optionalId: 'shared', title: 'B', description: '', enabledByDefault: true }
    }, files),
    'OPTIONAL_GROUP_CONFLICT'
  )
})

test('published manifests reject dangling optional fields, folder groups, and normalized path collisions', () => {
  errorCode(() => validatePublishedManifest([file('a.jar', { optional: false, title: 'dangling' })]), 'MANIFEST_OPTIONAL_FIELDS_INVALID')
  errorCode(() => validatePublishedManifest([{ name: 'mods', path: '', type: 'FOLDER', optional: true }]), 'MANIFEST_OPTIONAL_FIELDS_INVALID')
  errorCode(() => validatePublishedManifest([file('A.jar'), file('a.jar')]), 'MANIFEST_PATH_COLLISION')
})

test('manifest validation and projection preserve additive EML fields', () => {
  const entries = [
    file('a.jar', {
      optional: true,
      optionalId: 'shared',
      title: 'Shared',
      description: 'A group',
      enabledByDefault: false,
      futureField: { retained: true }
    }),
    file('b.jar', {
      optional: true,
      optionalId: 'shared',
      title: 'Shared',
      description: 'A group',
      enabledByDefault: false
    })
  ]
  validatePublishedManifest(entries)
  const projected = applyOptionalMetadata(entries.map(({ optional, optionalId, title, description, enabledByDefault, ...entry }) => entry), {
    'mods/a.jar': { optional: true, optionalId: 'shared', title: 'Shared', description: 'A group', enabledByDefault: false },
    'mods/b.jar': { optional: true, optionalId: 'shared', title: 'Shared', description: 'A group', enabledByDefault: false }
  })
  assert.deepEqual(projected[0].futureField, { retained: true })
  assert.equal(projected[1].optionalId, 'shared')
})

test('rename and delete transforms preserve group identity without merging directory metadata', () => {
  const metadata = {
    'mods/old.jar': { optional: true as const, optionalId: 'shared', title: 'Shared', description: '', enabledByDefault: true },
    'mods/dir/one.jar': { optional: true as const, optionalId: 'dir', title: 'Directory', description: '', enabledByDefault: false }
  }
  const renamedFile = renameOptionalMetadataKeys(metadata, 'mods/old.jar', 'mods/new.jar', false)
  assert.equal(renamedFile['mods/new.jar'].optionalId, 'shared')
  assert.equal(renamedFile['mods/old.jar'], undefined)

  const renamedDirectory = renameOptionalMetadataKeys(renamedFile, 'mods/dir', 'mods/new-dir', true)
  assert.equal(renamedDirectory['mods/new-dir/one.jar'].optionalId, 'dir')
  assert.deepEqual(Object.keys(pruneOptionalMetadataKeys(renamedDirectory, 'mods/new-dir', true)), ['mods/new.jar'])
})

test('revision is independent of manifest entry order but changes with a decision or artifact', () => {
  const first = file('a.jar')
  const second = file('b.jar')
  const metadata = { 'mods/a.jar': { optional: true as const, optionalId: 'a', title: 'A', description: '', enabledByDefault: true } }
  const revisionA = computeOptionalModsRevision([first, second], metadata)
  const revisionB = computeOptionalModsRevision([second, first], metadata)
  assert.equal(revisionA, revisionB)
  assert.notEqual(revisionA, computeOptionalModsRevision([first, second], { ...metadata, 'mods/a.jar': { ...metadata['mods/a.jar'], enabledByDefault: false } }))
  assert.notEqual(revisionA, computeOptionalModsRevision([{ ...first, sha1: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' }, second], metadata))
})

test('canonical response has profile binding/version and errors have safe stable shape', () => {
  const response = createCanonicalManifest({ id: 'profile-1', slug: 'smp' }, [file('a.jar')])
  assert.deepEqual(response.profile, { id: 'profile-1', slug: 'smp' })
  assert.equal(response.optionalModsSchemaVersion, 2)
  assert.equal(response.success, true)
  assert.deepEqual(createManifestError('MANIFEST_INVALID', 'The files manifest is invalid'), {
    success: false,
    code: 'MANIFEST_INVALID',
    message: 'The files manifest is invalid'
  })
})

test('atomic publication replaces a complete target and cleans a failed temporary write', async () => {
  const storage = new Map<string, string>([['cache.json', 'old-json']])
  const renamed: string[] = []
  let failRename = false
  const fakeFileSystem: AtomicFileSystem = {
    mkdir: async () => undefined,
    writeFile: async (target, content) => {
      storage.set(target, content)
    },
    rename: async (source, target) => {
      renamed.push(`${source}->${target}`)
      if (failRename) throw new Error('simulated rename failure')
      const content = storage.get(source)
      storage.delete(source)
      storage.set(target, content!)
    },
    unlink: async (target) => {
      storage.delete(target)
    }
  }

  await writeAtomicText('cache.json', 'new-json', fakeFileSystem)
  assert.equal(storage.get('cache.json'), 'new-json')
  assert.equal([...storage.keys()].some((key) => key.includes('.tmp-')), false)

  failRename = true
  await assert.rejects(writeAtomicText('cache.json', 'broken-json', fakeFileSystem), /simulated rename failure/)
  assert.equal(storage.get('cache.json'), 'new-json')
  assert.equal([...storage.keys()].some((key) => key.includes('.tmp-')), false)
  assert.equal(renamed.length, 2)
})

test('missing sidecar is empty metadata while malformed sidecar is an operator-visible error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eml-optional-mods-'))
  try {
    const files = [file('example.jar')]
    assert.deepEqual(await readOptionalMetadata(root, 'smp', files), { exists: false, metadata: {}, groups: {}, migrated: false })

    const sidecar = optionalMetadataPath(root, 'smp')
    await fs.mkdir(path.dirname(sidecar), { recursive: true })
    await fs.writeFile(sidecar, '{"broken":', 'utf8')

    await assert.rejects(
      readOptionalMetadata(root, 'smp', files),
      (error: unknown) => error instanceof OptionalModsError && error.code === 'OPTIONAL_METADATA_INVALID'
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('profile mutation queue serializes same-profile operations and permits different profiles concurrently', async () => {
  const events: string[] = []
  let releaseFirst!: () => void
  const firstPaused = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const first = withProfileMutations('smp', async () => {
    events.push('smp:start')
    await firstPaused
    events.push('smp:end')
  })
  const second = withProfileMutations('smp', async () => {
    events.push('smp:second')
  })
  const other = withProfileMutations('other', async () => {
    events.push('other')
  })

  await other
  assert.deepEqual(events, ['smp:start', 'other'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['smp:start', 'other', 'smp:end', 'smp:second'])
})
