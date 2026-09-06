import { AsyncLocalStorage } from 'node:async_hooks'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const OPTIONAL_MODS_SCHEMA_VERSION = 2
export const OPTIONAL_MOD_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const PROFILE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

const MAX_FILE_ENTRIES = 20_000
const MAX_OPTIONAL_GROUPS = 2_000
export const MAX_OPTIONAL_SELECTION_IDS = 2_000
export const MAX_OPTIONAL_QUERY_LENGTH = 32 * 1024
const SHA1 = /^[0-9a-f]{40}$/
const SNAPSHOT_TOKEN = /^[0-9a-f]{64}$/
const FILE_TYPES = new Set([
  'JAVA',
  'ASSET',
  'LIBRARY',
  'NATIVE',
  'MOD',
  'CONFIG',
  'BOOTSTRAP',
  'BACKGROUND',
  'FOLDER',
  'IMAGE',
  'OTHER'
])

export interface ManifestFile {
  name: string
  path: string
  type: string
  size?: unknown
  sha1?: unknown
  url?: unknown
  optional?: unknown
  optionalId?: unknown
  modId?: unknown
  id?: unknown
  title?: unknown
  description?: unknown
  enabledByDefault?: unknown
  [key: string]: unknown
}

export interface NormalizedOptionalMetadata {
  optional: true
  optionalId: string
  title: string
  description: string
  enabledByDefault: boolean
}

export type OptionalMetadataRecord = Record<string, NormalizedOptionalMetadata>

export interface OptionalGroup {
  title: string
  description: string
  enabledByDefault: boolean
  files: string[]
}

export type OptionalGroupRecord = Record<string, OptionalGroup>

export interface ManifestProfileBinding {
  id: string
  slug: string
}

export interface CanonicalManifestResponse {
  success: true
  profile: ManifestProfileBinding
  optionalModsSchemaVersion: 2
  files: ManifestFile[]
}

export interface OptionalGroupSummary {
  optionalId: string
  title: string
  description: string
  enabledByDefault: boolean
}

export interface ManifestLoaderData {
  type: string
  minecraftVersion: string
  loaderVersion: string
  customVersion: string | null
  file: unknown
}

export interface OptionalSelection {
  present: boolean
  ids: string[]
  snapshotToken?: string
}

export interface FilteredManifestResponse extends CanonicalManifestResponse {
  snapshotToken: string
  optional: OptionalGroupSummary[]
  loader: ManifestLoaderData
}

export interface OptionalMetadataSnapshot {
  exists: boolean
  metadata: OptionalMetadataRecord
  groups: OptionalGroupRecord
  migrated: boolean
}

export class OptionalModsError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly causeValue: unknown
  readonly responseFields: Readonly<Record<string, unknown>>

  constructor(
    code: string,
    message: string,
    httpStatus = 400,
    causeValue?: unknown,
    responseFields: Readonly<Record<string, unknown>> = {}
  ) {
    super(message)
    this.name = 'OptionalModsError'
    this.code = code
    this.httpStatus = httpStatus
    this.causeValue = causeValue
    this.responseFields = responseFields
  }
}

export function createManifestError(
  code: string,
  message: string,
  responseFields: Readonly<Record<string, unknown>> = {}
): { success: false; code: string; message: string; [key: string]: unknown } {
  return { ...responseFields, success: false, code, message }
}

function invalid(code: string, message: string, httpStatus = 400, causeValue?: unknown): OptionalModsError {
  return new OptionalModsError(code, message, httpStatus, causeValue)
}

function selectionInvalid(message: string): OptionalModsError {
  return new OptionalModsError('invalid_optional_selection', message, 400)
}

function selectionTooLarge(message: string): OptionalModsError {
  return new OptionalModsError('optional_selection_too_large', message, 400)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isValidManifestName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..' && !/[\\/\0]/.test(value)
}

function isValidManifestPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value === '') return true
  if (!value.endsWith('/') || value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('//')) return false
  const segments = value.slice(0, -1).split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isValidMetadataKey(value: string): boolean {
  const separator = value.lastIndexOf('/')
  const directory = separator < 0 ? '' : value.slice(0, separator + 1)
  const name = separator < 0 ? value : value.slice(separator + 1)
  return isValidManifestPath(directory) && isValidManifestName(name)
}

function metadataKey(file: Pick<ManifestFile, 'path' | 'name'>): string {
  return `${file.path}${file.name}`
}

function validateMetadataEntry(filePath: string, value: unknown): NormalizedOptionalMetadata {
  if (!isValidMetadataKey(filePath)) throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional metadata path: ${filePath}`)
  if (!isPlainRecord(value)) throw invalid('OPTIONAL_METADATA_INVALID', `Invalid metadata for ${filePath}`)

  const allowedKeys = new Set(['optional', 'optionalId', 'title', 'description', 'enabledByDefault'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw invalid('OPTIONAL_METADATA_INVALID', `Unknown metadata field for ${filePath}`)
  }

  if (value.optional !== true) throw invalid('OPTIONAL_METADATA_INVALID', `Optional metadata must be enabled for ${filePath}`)
  if (typeof value.optionalId !== 'string' || !OPTIONAL_MOD_ID.test(value.optionalId)) {
    throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional ID for ${filePath}`)
  }

  const title = typeof value.title === 'string' ? value.title.trim() : null
  if (!title || title.length > 120) throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional title for ${filePath}`)
  if (typeof value.description !== 'string' || value.description.length > 500) {
    throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional description for ${filePath}`)
  }
  if (typeof value.enabledByDefault !== 'boolean') {
    throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional default for ${filePath}`)
  }

  return {
    optional: true,
    optionalId: value.optionalId,
    title,
    description: value.description,
    enabledByDefault: value.enabledByDefault
  }
}

function assertGroupConsistency(metadata: OptionalMetadataRecord): void {
  const groups = new Map<string, NormalizedOptionalMetadata>()
  for (const value of Object.values(metadata)) {
    const previous = groups.get(value.optionalId)
    if (!previous) {
      groups.set(value.optionalId, value)
      continue
    }
    if (
      previous.title !== value.title ||
      previous.description !== value.description ||
      previous.enabledByDefault !== value.enabledByDefault
    ) {
      throw invalid('OPTIONAL_GROUP_CONFLICT', `Conflicting metadata for optional group ${value.optionalId}`)
    }
  }
  if (groups.size > MAX_OPTIONAL_GROUPS) throw invalid('OPTIONAL_GROUP_LIMIT', 'Too many optional groups')
}

/**
 * Validate and normalize the sidecar/submission document before any string
 * manipulation or filesystem write. When files are supplied, every key must
 * point to one current MOD entry.
 */
export function validateOptionalMetadata(input: unknown, files?: readonly ManifestFile[]): OptionalMetadataRecord {
  if (!isPlainRecord(input)) throw invalid('OPTIONAL_METADATA_INVALID', 'Optional metadata must be an object')
  const entries = Object.entries(input)
  if (entries.length > MAX_FILE_ENTRIES) throw invalid('OPTIONAL_METADATA_LIMIT', 'Too many optional metadata entries')

  const validMods = files
    ? new Map(files.filter((file) => file.type === 'MOD').map((file) => [metadataKey(file), file]))
    : undefined
  const normalized: OptionalMetadataRecord = {}

  for (const [filePath, value] of entries) {
    if (validMods && !validMods.has(filePath)) {
      throw invalid('OPTIONAL_METADATA_INVALID', `Optional metadata does not match a current MOD: ${filePath}`)
    }
    normalized[filePath] = validateMetadataEntry(filePath, value)
  }

  assertGroupConsistency(normalized)
  return Object.fromEntries(Object.keys(normalized).sort().map((key) => [key, normalized[key]]))
}

function normalizeGroupFiles(value: unknown, groupId: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_FILE_ENTRIES) {
    throw invalid('OPTIONAL_METADATA_INVALID', `Invalid files for optional group ${groupId}`)
  }

  const seen = new Set<string>()
  const files: string[] = []
  for (const filePath of value) {
    if (typeof filePath !== 'string' || !isValidMetadataKey(filePath) || !filePath.startsWith('mods/')) {
      throw invalid('OPTIONAL_METADATA_INVALID', `Invalid file path for optional group ${groupId}`)
    }
    const collisionPath = normalizedCollisionKey(filePath)
    if (seen.has(collisionPath)) throw invalid('OPTIONAL_GROUP_CONFLICT', `Duplicate file in optional group ${groupId}`)
    seen.add(collisionPath)
    files.push(filePath)
  }

  return files.sort()
}

/** Validate the v2 sidecar. Empty file lists intentionally preserve orphan groups. */
export function validateOptionalGroups(input: unknown): OptionalGroupRecord {
  if (!isPlainRecord(input) || input.schemaVersion !== OPTIONAL_MODS_SCHEMA_VERSION || !isPlainRecord(input.groups)) {
    throw invalid('OPTIONAL_METADATA_SCHEMA_UNSUPPORTED', 'Optional metadata schema is unsupported')
  }

  const entries = Object.entries(input.groups)
  if (entries.length > MAX_OPTIONAL_GROUPS) throw invalid('OPTIONAL_GROUP_LIMIT', 'Too many optional groups')

  const normalized: OptionalGroupRecord = {}
  const filesToGroups = new Map<string, string>()
  for (const [groupId, value] of entries) {
    if (!OPTIONAL_MOD_ID.test(groupId) || !isPlainRecord(value)) {
      throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional group ${groupId}`)
    }

    const allowedKeys = new Set(['title', 'description', 'enabledByDefault', 'files'])
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
      throw invalid('OPTIONAL_METADATA_INVALID', `Unknown field for optional group ${groupId}`)
    }

    const title = typeof value.title === 'string' ? value.title.trim() : null
    if (!title || title.length > 120) throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional title for ${groupId}`)
    if (typeof value.description !== 'string' || value.description.length > 500) {
      throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional description for ${groupId}`)
    }
    if (typeof value.enabledByDefault !== 'boolean') {
      throw invalid('OPTIONAL_METADATA_INVALID', `Invalid optional default for ${groupId}`)
    }

    const files = normalizeGroupFiles(value.files, groupId)
    for (const filePath of files) {
      const previous = filesToGroups.get(normalizedCollisionKey(filePath))
      if (previous && previous !== groupId) {
        throw invalid('OPTIONAL_GROUP_CONFLICT', `File ${filePath} belongs to multiple optional groups`)
      }
      filesToGroups.set(normalizedCollisionKey(filePath), groupId)
    }

    normalized[groupId] = { title, description: value.description, enabledByDefault: value.enabledByDefault, files }
  }

  return Object.fromEntries(Object.keys(normalized).sort().map((key) => [key, normalized[key]]))
}

function sidecarDocument(groups: OptionalGroupRecord): { schemaVersion: 2; groups: OptionalGroupRecord } {
  return { schemaVersion: OPTIONAL_MODS_SCHEMA_VERSION, groups: validateOptionalGroups({ schemaVersion: OPTIONAL_MODS_SCHEMA_VERSION, groups }) }
}

function cloneGroups(groups: OptionalGroupRecord): OptionalGroupRecord {
  return Object.fromEntries(Object.entries(groups).map(([id, group]) => [id, { ...group, files: [...group.files] }]))
}

function metadataFromGroups(groups: OptionalGroupRecord, files?: readonly ManifestFile[]): OptionalMetadataRecord {
  const currentMods = files
    ? new Map(files.filter((file) => file.type === 'MOD').map((file) => [metadataKey(file), file]))
    : undefined
  const metadata: OptionalMetadataRecord = {}

  for (const [optionalId, group] of Object.entries(groups)) {
    for (const filePath of group.files) {
      if (currentMods && !currentMods.has(filePath)) continue
      metadata[filePath] = {
        optional: true,
        optionalId,
        title: group.title,
        description: group.description,
        enabledByDefault: group.enabledByDefault
      }
    }
  }

  return validateOptionalMetadata(metadata, files)
}

export function groupsFromOptionalMetadata(metadata: OptionalMetadataRecord): OptionalGroupRecord {
  const normalized = validateOptionalMetadata(metadata)
  const groups: OptionalGroupRecord = {}
  for (const [filePath, value] of Object.entries(normalized)) {
    const group = groups[value.optionalId] ?? {
      title: value.title,
      description: value.description,
      enabledByDefault: value.enabledByDefault,
      files: []
    }
    group.files.push(filePath)
    groups[value.optionalId] = group
  }
  return validateOptionalGroups(sidecarDocument(groups))
}

export function mergeOptionalMetadataIntoGroups(
  existingGroups: OptionalGroupRecord,
  metadata: unknown,
  files: readonly ManifestFile[],
  removeGroupIds: readonly string[] = []
): OptionalGroupRecord {
  const existing = validateOptionalGroups(sidecarDocument(existingGroups))
  const normalized = validateOptionalMetadata(metadata, files)
  const next = cloneGroups(existing)

  for (const group of Object.values(next)) {
    // The submitted map is the authoritative assignment for the current
    // inventory. Rebuild memberships from it, while retaining empty groups so
    // a temporary file gap cannot destroy player decisions.
    group.files = []
  }

  for (const [filePath, value] of Object.entries(normalized)) {
    const group = next[value.optionalId] ?? {
      title: value.title,
      description: value.description,
      enabledByDefault: value.enabledByDefault,
      files: []
    }
    if (group.files.length === 0 || !next[value.optionalId]) {
      group.title = value.title
      group.description = value.description
      group.enabledByDefault = value.enabledByDefault
    } else if (
      group.title !== value.title ||
      group.description !== value.description ||
      group.enabledByDefault !== value.enabledByDefault
    ) {
      throw invalid('OPTIONAL_GROUP_CONFLICT', `Conflicting metadata for optional group ${value.optionalId}`)
    }
    group.files.push(filePath)
    next[value.optionalId] = group
  }

  for (const groupId of removeGroupIds) {
    if (typeof groupId !== 'string' || !OPTIONAL_MOD_ID.test(groupId)) {
      throw invalid('OPTIONAL_METADATA_INVALID', 'Invalid optional group removal')
    }
    delete next[groupId]
  }

  return validateOptionalGroups(sidecarDocument(next))
}

export function metadataFromManifest(files: readonly ManifestFile[]): OptionalMetadataRecord {
  const raw: Record<string, unknown> = {}
  for (const file of files) {
    const hasOptionalField = ['optional', 'optionalId', 'title', 'description', 'enabledByDefault'].some((key) => hasOwn(file, key))
    if (!hasOptionalField) continue
    if (file.optional !== true) throw invalid('MANIFEST_OPTIONAL_FIELDS_INVALID', `Dangling optional metadata for ${metadataKey(file)}`)
    raw[metadataKey(file)] = {
      optional: file.optional,
      optionalId: file.optionalId,
      title: file.title,
      description: file.description,
      enabledByDefault: file.enabledByDefault
    }
  }
  return validateOptionalMetadata(raw, files)
}

export function getOptionalGroupSummaries(metadata: OptionalMetadataRecord): OptionalGroupSummary[] {
  const normalized = validateOptionalMetadata(metadata)
  const groups = new Map<string, OptionalGroupSummary>()
  for (const value of Object.values(normalized)) {
    const existing = groups.get(value.optionalId)
    if (existing) continue
    groups.set(value.optionalId, {
      optionalId: value.optionalId,
      title: value.title,
      description: value.description,
      enabledByDefault: value.enabledByDefault
    })
  }

  return [...groups.values()].sort((left, right) => left.optionalId < right.optionalId ? -1 : left.optionalId > right.optionalId ? 1 : 0)
}

/** Hash only the player decision surface. File paths, hashes, sizes and mandatory files are excluded. */
export function computeSnapshotToken(groups: readonly OptionalGroupSummary[]): string {
  const decisionSurface = [...groups]
    .sort((left, right) => left.optionalId < right.optionalId ? -1 : left.optionalId > right.optionalId ? 1 : 0)
    .map(({ optionalId, title, description, enabledByDefault }) => ({
      optionalId,
      title,
      description,
      enabledByDefault
    }))
  return crypto.createHash('sha256').update(JSON.stringify(decisionSurface)).digest('hex')
}

export function parseOptionalSelection(searchParams: URLSearchParams, queryLength = 0): OptionalSelection {
  if (queryLength > MAX_OPTIONAL_QUERY_LENGTH) {
    throw selectionTooLarge('Optional selection query is too large')
  }

  const optionalValues = searchParams.getAll('optional')
  const tokenValues = searchParams.getAll('snapshotToken')
  if (optionalValues.length > 1 || tokenValues.length > 1) {
    throw selectionInvalid('Optional selection parameters must not be repeated')
  }

  if (optionalValues.length === 0) {
    if (tokenValues.length > 0) throw selectionInvalid('snapshotToken requires optional')
    return { present: false, ids: [] }
  }

  const rawIds = optionalValues[0]
  const ids = rawIds === '' ? [] : rawIds.split(',')
  if (ids.length > MAX_OPTIONAL_SELECTION_IDS) {
    throw selectionTooLarge('Too many optional groups selected')
  }
  if (ids.some((id) => !OPTIONAL_MOD_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw selectionInvalid('Optional group selection is invalid')
  }

  const snapshotToken = tokenValues[0]
  if (!snapshotToken || !SNAPSHOT_TOKEN.test(snapshotToken)) {
    throw selectionInvalid('A valid snapshotToken is required with optional')
  }

  return { present: true, ids, snapshotToken }
}

function validateOptionalSelection(selection: OptionalSelection, groups: readonly OptionalGroupSummary[], currentToken: string): void {
  if (!selection.present) return
  if (!selection.snapshotToken || !SNAPSHOT_TOKEN.test(selection.snapshotToken)) {
    throw selectionInvalid('A valid snapshotToken is required with optional')
  }
  if (selection.snapshotToken !== currentToken) {
    throw new OptionalModsError(
      'optional_selection_stale',
      'Optional selection is stale',
      409,
      undefined,
      { snapshotToken: currentToken }
    )
  }

  const knownIds = new Set(groups.map((group) => group.optionalId))
  if (selection.ids.some((id) => !OPTIONAL_MOD_ID.test(id) || !knownIds.has(id))) {
    throw selectionInvalid('Optional group selection is invalid')
  }
}

export function createFilteredManifest(
  profile: ManifestProfileBinding,
  files: unknown,
  selection: OptionalSelection,
  loader: ManifestLoaderData
): FilteredManifestResponse {
  if (!Array.isArray(files)) throw invalid('MANIFEST_INVALID', 'Manifest files must be an array')
  const manifestFiles = files as ManifestFile[]
  const metadata = validatePublishedManifest(manifestFiles)
  const optional = getOptionalGroupSummaries(metadata)
  const snapshotToken = computeSnapshotToken(optional)
  validateOptionalSelection(selection, optional, snapshotToken)

  const selectedIds = new Set(selection.ids)
  const filteredFiles = selection.present
    ? manifestFiles.filter((file) => file.optional !== true || selectedIds.has(typeof file.optionalId === 'string' ? file.optionalId : ''))
    : manifestFiles

  return {
    success: true,
    profile: { id: profile.id, slug: profile.slug },
    optionalModsSchemaVersion: OPTIONAL_MODS_SCHEMA_VERSION,
    snapshotToken,
    optional,
    loader,
    files: filteredFiles
  }
}

function normalizedCollisionKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
}

function validateFileUrl(value: unknown, allowTemplateUrls: boolean): void {
  if (typeof value !== 'string' || value.length === 0) throw invalid('MANIFEST_INVALID', 'File URL is required')
  if (allowTemplateUrls && value.startsWith('{{url}}/')) return
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw invalid('MANIFEST_INVALID', 'File URL is invalid', 400, error)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
    throw invalid('MANIFEST_INVALID', 'File URL is not a safe HTTP URL')
  }
}

/**
 * Validate a complete files-updater manifest before it becomes public cache.
 * Unknown additive fields are deliberately retained by callers.
 */
export function validatePublishedManifest(input: unknown, options: { allowTemplateUrls?: boolean } = {}): OptionalMetadataRecord {
  if (!Array.isArray(input)) throw invalid('MANIFEST_INVALID', 'Manifest files must be an array')
  if (input.length > MAX_FILE_ENTRIES) throw invalid('MANIFEST_LIMIT', 'Manifest contains too many files')

  const seenPaths = new Set<string>()
  const rawOptional: Record<string, unknown> = {}
  const optionalIds = new Set<string>()

  for (const value of input) {
    if (!isPlainRecord(value)) throw invalid('MANIFEST_INVALID', 'Manifest entry must be an object')
    const entry = value as ManifestFile
    if (!isValidManifestName(entry.name)) throw invalid('MANIFEST_INVALID', 'Manifest file name is invalid')
    if (!isValidManifestPath(entry.path)) throw invalid('MANIFEST_INVALID', 'Manifest file path is invalid')
    if (typeof entry.type !== 'string' || !FILE_TYPES.has(entry.type)) throw invalid('MANIFEST_INVALID', 'Manifest file type is invalid')

    const exactPath = metadataKey(entry)
    const collisionPath = normalizedCollisionKey(exactPath)
    if (seenPaths.has(collisionPath)) throw invalid('MANIFEST_PATH_COLLISION', `Manifest path collision: ${exactPath}`)
    seenPaths.add(collisionPath)

    if (entry.type === 'FOLDER') {
      if (['optional', 'optionalId', 'modId', 'id', 'title', 'description', 'enabledByDefault'].some((key) => hasOwn(entry, key))) {
        throw invalid('MANIFEST_OPTIONAL_FIELDS_INVALID', 'Directories cannot be optional')
      }
      continue
    }

    if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0) throw invalid('MANIFEST_INVALID', 'Manifest file size is invalid')
    if (typeof entry.sha1 !== 'string' || !SHA1.test(entry.sha1)) throw invalid('MANIFEST_INVALID', 'Manifest SHA-1 is invalid')
    validateFileUrl(entry.url, options.allowTemplateUrls === true)

    const hasOptionalField = ['optional', 'optionalId', 'modId', 'id', 'title', 'description', 'enabledByDefault'].some((key) => hasOwn(entry, key))
    if (!hasOptionalField) continue
    if (entry.optional !== true || entry.type !== 'MOD') throw invalid('MANIFEST_OPTIONAL_FIELDS_INVALID', 'Only MOD entries can be optional')
    if (hasOwn(entry, 'modId') || hasOwn(entry, 'id')) throw invalid('MANIFEST_OPTIONAL_FIELDS_INVALID', 'Published metadata must use optionalId')

    const metadata = validateMetadataEntry(exactPath, {
      optional: entry.optional,
      optionalId: entry.optionalId,
      title: entry.title,
      description: entry.description,
      enabledByDefault: entry.enabledByDefault
    })
    rawOptional[exactPath] = metadata
    optionalIds.add(metadata.optionalId)
  }

  if (optionalIds.size > MAX_OPTIONAL_GROUPS) throw invalid('MANIFEST_LIMIT', 'Manifest contains too many optional groups')
  const metadata = validateOptionalMetadata(rawOptional, input as ManifestFile[])
  return metadata
}

export function createCanonicalManifest(profile: ManifestProfileBinding, files: unknown): CanonicalManifestResponse {
  validatePublishedManifest(files)
  return {
    success: true,
    profile: { id: profile.id, slug: profile.slug },
    optionalModsSchemaVersion: OPTIONAL_MODS_SCHEMA_VERSION,
    files: files as ManifestFile[]
  }
}

export function applyOptionalMetadata(files: readonly ManifestFile[], metadata: OptionalMetadataRecord): ManifestFile[] {
  return files.map((file) => {
    const item = metadata[metadataKey(file)]
    return item && file.type === 'MOD' ? { ...file, ...item } : { ...file }
  })
}

export function canonicalizeOptionalMetadata(metadata: OptionalMetadataRecord): string {
  const normalized = validateOptionalMetadata(metadata)
  return JSON.stringify(Object.fromEntries(Object.keys(normalized).sort().map((key) => [key, normalized[key]])))
}

export function computeOptionalModsRevision(files: readonly ManifestFile[], metadata?: OptionalMetadataRecord): string {
  const resolvedMetadata = metadata ?? metadataFromManifest(files)
  const inventory = files
    .filter((file) => file.type === 'MOD')
    .map((file) => ({ name: file.name, path: file.path, type: file.type, size: file.size, sha1: file.sha1 }))
    .sort((a, b) => {
      const left = `${a.path}${a.name}`
      const right = `${b.path}${b.name}`
      return left < right ? -1 : left > right ? 1 : 0
    })
  return crypto.createHash('sha256').update(JSON.stringify({ inventory, metadata: JSON.parse(canonicalizeOptionalMetadata(resolvedMetadata)) })).digest('hex')
}

export function renameOptionalMetadataKeys(
  metadata: OptionalMetadataRecord,
  oldPath: string,
  newPath: string,
  directory: boolean
): OptionalMetadataRecord {
  const normalized = validateOptionalMetadata(metadata)
  if (oldPath === newPath) return normalized

  const result: OptionalMetadataRecord = { ...normalized }
  if (!directory) {
    const oldValue = result[oldPath]
    if (!oldValue) return result
    if (!result[newPath]) result[newPath] = oldValue
    delete result[oldPath]
    return Object.fromEntries(Object.keys(result).sort().map((key) => [key, result[key]]))
  }

  const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`
  const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`
  const sourceKeys = Object.keys(result).filter((key) => key.startsWith(oldPrefix))
  const targetKeys = Object.keys(result).filter((key) => key.startsWith(newPrefix))
  if (sourceKeys.length > 0 && targetKeys.length > 0) {
    throw invalid('OPTIONAL_METADATA_CONFLICT', 'Cannot merge optional metadata during directory rename')
  }
  for (const key of sourceKeys) {
    result[`${newPrefix}${key.slice(oldPrefix.length)}`] = result[key]
    delete result[key]
  }
  return Object.fromEntries(Object.keys(result).sort().map((key) => [key, result[key]]))
}

export function pruneOptionalMetadataKeys(metadata: OptionalMetadataRecord, targetPath: string, directory: boolean): OptionalMetadataRecord {
  const normalized = validateOptionalMetadata(metadata)
  const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`
  const result = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => (directory ? !key.startsWith(prefix) : key !== targetPath))
  ) as OptionalMetadataRecord
  return Object.fromEntries(Object.keys(result).sort().map((key) => [key, result[key]]))
}

export function renameOptionalGroupFiles(
  groups: OptionalGroupRecord,
  oldPath: string,
  newPath: string,
  directory: boolean
): OptionalGroupRecord {
  const normalized = validateOptionalGroups(sidecarDocument(groups))
  if (oldPath === newPath) return normalized

  const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`
  const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`
  const result = cloneGroups(normalized)
  const targetOwners = new Map<string, string>()
  for (const [groupId, group] of Object.entries(result)) {
    for (const filePath of group.files) targetOwners.set(filePath, groupId)
  }

  for (const [groupId, group] of Object.entries(result)) {
    const renamed: string[] = []
    for (const filePath of group.files) {
      const matches = directory ? filePath.startsWith(oldPrefix) : filePath === oldPath
      if (!matches) {
        renamed.push(filePath)
        continue
      }

      const nextPath = directory ? `${newPrefix}${filePath.slice(oldPrefix.length)}` : newPath
      const owner = targetOwners.get(nextPath)
      if (owner && owner !== groupId) throw invalid('OPTIONAL_GROUP_CONFLICT', 'Renaming would merge optional groups')
      renamed.push(nextPath)
    }
    group.files = [...new Set(renamed)].sort()
  }

  return validateOptionalGroups(sidecarDocument(result))
}

export function pruneOptionalGroupFiles(groups: OptionalGroupRecord, targetPath: string, directory: boolean): OptionalGroupRecord {
  const normalized = validateOptionalGroups(sidecarDocument(groups))
  const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`
  const result = cloneGroups(normalized)
  for (const group of Object.values(result)) {
    group.files = group.files.filter((filePath) => (directory ? !filePath.startsWith(prefix) : filePath !== targetPath))
  }
  return validateOptionalGroups(sidecarDocument(result))
}

export function optionalMetadataPath(root: string, slug: string): string {
  if (!PROFILE_SLUG.test(slug)) throw invalid('PROFILE_SLUG_INVALID', 'Invalid profile slug')
  return path.join(root, 'data', 'optional-mods', `${slug}.json`)
}

export function optionalCachePath(root: string, slug: string): string {
  if (!PROFILE_SLUG.test(slug)) throw invalid('PROFILE_SLUG_INVALID', 'Invalid profile slug')
  return path.join(root, 'data', 'cache', `files-updater-${slug}.json`)
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

export async function readOptionalMetadata(
  root: string,
  slug: string,
  files?: readonly ManifestFile[]
): Promise<OptionalMetadataSnapshot> {
  const target = optionalMetadataPath(root, slug)
  let rawText: string
  try {
    rawText = await fs.readFile(target, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return { exists: false, metadata: {}, groups: {}, migrated: false }
    throw invalid('OPTIONAL_METADATA_READ_FAILED', 'Unable to read optional metadata', 500, error)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    throw invalid('OPTIONAL_METADATA_INVALID', 'Optional metadata JSON is malformed', 400, error)
  }

  let groups: OptionalGroupRecord
  let migrated = false
  if (isPlainRecord(parsed) && hasOwn(parsed, 'schemaVersion')) {
    if (parsed.schemaVersion !== OPTIONAL_MODS_SCHEMA_VERSION) {
      throw invalid('OPTIONAL_METADATA_SCHEMA_UNSUPPORTED', 'Optional metadata schema is unsupported')
    }
    groups = validateOptionalGroups(parsed)
  } else {
    // S1 wrote a path-keyed record. Migrate it once, preserving every logical ID
    // and retaining missing paths so an orphan group can be repaired later.
    const legacy = validateOptionalMetadata(parsed)
    groups = groupsFromOptionalMetadata(legacy)
    await writeOptionalGroups(root, slug, groups)
    migrated = true
  }

  return { exists: true, metadata: metadataFromGroups(groups, files), groups, migrated }
}

export interface AtomicFileSystem {
  mkdir(target: string, options: { recursive: boolean }): Promise<unknown>
  writeFile(target: string, content: string, options: { encoding: 'utf8'; mode: number }): Promise<void>
  rename(source: string, target: string): Promise<void>
  unlink(target: string): Promise<void>
}

export async function writeAtomicText(target: string, content: string, fileSystem: AtomicFileSystem = fs as unknown as AtomicFileSystem): Promise<void> {
  await fileSystem.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await fileSystem.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await fileSystem.rename(temporary, target)
  } catch (error) {
    await fileSystem.unlink(temporary).catch(() => {})
    throw error
  }
}

export async function writeOptionalMetadata(root: string, slug: string, metadata: OptionalMetadataRecord): Promise<void> {
  await writeOptionalGroups(root, slug, groupsFromOptionalMetadata(metadata))
}

export async function writeOptionalGroups(root: string, slug: string, groups: OptionalGroupRecord): Promise<void> {
  const document = sidecarDocument(groups)
  await writeAtomicText(optionalMetadataPath(root, slug), `${JSON.stringify(document, null, 2)}\n`)
}

export async function deleteOptionalMetadata(root: string, slug: string): Promise<void> {
  try {
    await fs.unlink(optionalMetadataPath(root, slug))
  } catch (error) {
    if (!isNotFound(error)) throw invalid('OPTIONAL_METADATA_DELETE_FAILED', 'Unable to delete optional metadata', 500, error)
  }
}

export async function restoreOptionalMetadata(root: string, slug: string, snapshot: OptionalMetadataSnapshot): Promise<void> {
  if (snapshot.exists) await writeOptionalGroups(root, slug, snapshot.groups)
  else await deleteOptionalMetadata(root, slug)
}

export async function moveOptionalProfileArtifacts(root: string, oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return
  const pairs = [
    [optionalMetadataPath(root, oldSlug), optionalMetadataPath(root, newSlug)],
    [optionalCachePath(root, oldSlug), optionalCachePath(root, newSlug)]
  ] as const
  const existingPairs = [] as Array<readonly [string, string]>
  for (const pair of pairs) {
    const [oldPath, newPath] = pair
    const oldExists = await fileExists(oldPath)
    const newExists = await fileExists(newPath)
    if (oldExists && newExists) throw invalid('PROFILE_ARTIFACT_CONFLICT', 'Both old and new profile artifacts exist', 409)
    if (oldExists) existingPairs.push(pair)
  }

  const moved: Array<readonly [string, string]> = []
  try {
    for (const [oldPath, newPath] of existingPairs) {
      await fs.mkdir(path.dirname(newPath), { recursive: true })
      await fs.rename(oldPath, newPath)
      moved.push([oldPath, newPath])
    }
  } catch (error) {
    for (const [oldPath, newPath] of moved.reverse()) await fs.rename(newPath, oldPath).catch(() => {})
    throw invalid('PROFILE_ARTIFACT_MOVE_FAILED', 'Unable to migrate profile optional artifacts', 500, error)
  }
}

export async function deleteOptionalProfileArtifacts(root: string, slug: string): Promise<void> {
  await deleteOptionalMetadata(root, slug)
  try {
    await fs.unlink(optionalCachePath(root, slug))
  } catch (error) {
    if (!isNotFound(error)) throw invalid('OPTIONAL_CACHE_DELETE_FAILED', 'Unable to delete the optional manifest cache', 500, error)
  }
}

type MutationOperation<T> = () => Promise<T>
const profileQueues = new Map<string, Promise<void>>()
const mutationContext = new AsyncLocalStorage<ReadonlySet<string>>()

/** Serialize all mutations that can affect one profile's sidecar/cache. */
export async function withProfileMutations<T>(slugs: string | readonly string[], operation: MutationOperation<T>): Promise<T> {
  const requested = [...new Set(typeof slugs === 'string' ? [slugs] : slugs)].sort()
  for (const slug of requested) if (!PROFILE_SLUG.test(slug)) throw invalid('PROFILE_SLUG_INVALID', 'Invalid profile slug')

  const active = mutationContext.getStore() ?? new Set<string>()
  const toAcquire = requested.filter((slug) => !active.has(slug))
  if (toAcquire.length === 0) return operation()

  let release!: () => void
  const ticket = new Promise<void>((resolve) => {
    release = resolve
  })
  const previous = toAcquire.map((slug) => profileQueues.get(slug)).filter((promise): promise is Promise<void> => Boolean(promise))
  for (const slug of toAcquire) profileQueues.set(slug, ticket)
  await Promise.all(previous.map((promise) => promise.catch(() => {})))

  try {
    const nextContext = new Set(active)
    for (const slug of toAcquire) nextContext.add(slug)
    return await mutationContext.run(nextContext, operation)
  } finally {
    for (const slug of toAcquire) if (profileQueues.get(slug) === ticket) profileQueues.delete(slug)
    release()
  }
}
