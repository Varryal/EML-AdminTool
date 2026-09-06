import { BusinessError, ServerError } from '$lib/utils/errors'
import { NotificationCode } from '$lib/utils/notifications'
import { getFileTypeFromPath } from '$lib/utils/utils'
import fs from 'node:fs/promises'
import path_ from 'node:path'
import type { DataDir, FileDir, File as File_ } from '$lib/utils/types'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  applyOptionalMetadata as applyOptionalMetadataCore,
  computeOptionalModsRevision,
  deleteOptionalProfileArtifacts,
  moveOptionalProfileArtifacts,
  mergeOptionalMetadataIntoGroups,
  OptionalModsError,
  pruneOptionalGroupFiles,
  readOptionalMetadata,
  renameOptionalGroupFiles,
  restoreOptionalMetadata,
  validatePublishedManifest,
  withProfileMutations,
  writeAtomicText,
  writeOptionalGroups,
  type ManifestFile,
  type OptionalGroupRecord,
} from './optional-mods'

const root = path_.join(process.cwd())

/**
 * Get files in a directory.
 * @param domain Domain to use for file URLs. Can be an empty string if URLs are not needed.
 * @param dir Directory to get files from (including the profile slug if applicable).
 */
export async function getFiles(domain: string, dir: FileDir | DataDir): Promise<File_[]> {
  const base = getBaseFolder(dir)
  await fs.mkdir(path_.join(root, base, dir), { recursive: true })
  const filesArray: File_[] = []
  await browse(filesArray, base, dir, '', domain)
  if (dir.startsWith('files-updater/')) {
    const slug = dir.slice('files-updater/'.length)
    const snapshot = await readOptionalMetadata(root, slug, filesArray as ManifestFile[])
    filesArray.splice(0, filesArray.length, ...(applyOptionalMetadataCore(filesArray as ManifestFile[], snapshot.metadata) as File_[]))
  }
  return filesArray
}

/**
 * Get cached files for a directory. If the cache does not exist, it will be generated.
 * @param domain Domain to use for file URLs. Can be an empty string if URLs are not needed.
 * @param dir Directory to get cached files from (including the profile slug if applicable).
 */
export async function getCachedFiles(domain: string, dir: FileDir): Promise<string> {
  const base = dir.startsWith('files-updater/') || dir.startsWith('.staging') ? dir.split('/')[0] : null
  const slug = dir.startsWith('files-updater/') || dir.startsWith('.staging') ? dir.split('/')[1] : undefined
  const cacheKey = base && slug ? `${base}-${slug}` : dir
  const target = sanitizePath('data', 'cache', `${cacheKey}.json`)
  let cache
  try {
    cache = (await fs.readFile(target, 'utf-8')).replaceAll('{{url}}', domain)
  } catch (err) {
    if (!isFileNotFound(err)) throw err
    console.warn('Cache file not found, generating new cache.')
    await cacheFiles(dir)
    cache = (await fs.readFile(target, 'utf-8')).replaceAll('{{url}}', domain)
  }

  return cache
}

/** Read a published cache without generating one. Public manifest endpoints must fail closed when it is absent. */
export async function getExistingCachedFiles(domain: string, dir: FileDir): Promise<string> {
  const base = dir.startsWith('files-updater/') || dir.startsWith('.staging') ? dir.split('/')[0] : null
  const slug = dir.startsWith('files-updater/') || dir.startsWith('.staging') ? dir.split('/')[1] : undefined
  const cacheKey = base && slug ? `${base}-${slug}` : dir
  const target = sanitizePath('data', 'cache', `${cacheKey}.json`)
  const cache = await fs.readFile(target, 'utf-8')
  return cache.replaceAll('{{url}}', domain)
}

/**
 * Get cached files for a directory and parse them. If the cache does not exist, it will be generated.
 * @param domain Domain to use for file URLs. Can be an empty string if URLs are not needed.
 * @param dir Directory to get cached files from (including the profile slug if applicable).
 */
export async function getCachedFilesParsed(domain: string, dir: FileDir): Promise<File_[]> {
  const cache = await getCachedFiles(domain, dir)
  try {
    const parsed = JSON.parse(cache) as unknown
    if (dir.startsWith('files-updater/')) validatePublishedManifest(parsed, { allowTemplateUrls: false })
    return parsed as File_[]
  } catch (err) {
    console.error('Failed to parse cached files:', err)
    throw new ServerError('Failed to parse cached files', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }
}

/**
 * Upload a file to the server.
 * @param dir Directory to upload the file to (including the profile slug if applicable).
 * @param path Path to the file, relative to the directory, without the file name.
 * @param file File object to upload.
 */
export async function uploadFile(dir: FileDir | DataDir, path: string, file: File): Promise<void> {
  if (!file) return

  const base = getBaseFolder(dir)
  let target, name, buffer
  try {
    target = sanitizePath(base, dir, path)
    name = path_.basename(file.name).removeUnwantedFilenameChars()
    buffer = Buffer.from(await file.arrayBuffer())
  } catch (err) {
    console.warn('Invalid path:', path, err)
    throw new BusinessError('Invalid path', NotificationCode.INVALID_REQUEST, 400)
  }

  try {
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path_.join(target, name), buffer)
  } catch (err) {
    console.error('Error writing file:', err)
    throw new ServerError('Failed to write file', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }
}

/**
 * Create an empty file.
 * @param dir Directory where the file to create is.
 * @param path Path to the file, relative to the directory, without the file name.
 * @param name Name of the file to create.
 */
export async function createFile(dir: FileDir | DataDir, path: string, name: string | undefined): Promise<void> {
  const base = getBaseFolder(dir)
  let target
  try {
    target = sanitizePath(base, dir, path)
  } catch (err) {
    console.warn('Invalid path:', path, err)
    throw new BusinessError('Invalid path', NotificationCode.INVALID_REQUEST, 400)
  }

  try {
    await fs.mkdir(target, { recursive: true })
  } catch (err) {
    console.error('Error creating directory:', err)
    throw new ServerError('Failed to create directory', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }

  if (name) {
    try {
      name = name.removeUnwantedFilenameChars()
      await fs.writeFile(path_.join(target, name), '')
    } catch (err) {
      console.error('Error creating file:', err)
      throw new ServerError('Failed to create file', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
    }
  }
}

/**
 * Edit a file's content.
 * @param dir Directory where the file to edit is.
 * @param path Path to the file, relative to the directory, without the file name.
 * @param name Name of the file to edit.
 * @param content New content for the file.
 */
export async function editFile(dir: FileDir | DataDir, path: string, name: string, content: string): Promise<void> {
  const base = getBaseFolder(dir)
  let fullPath
  try {
    name = name.removeUnwantedFilenameChars()
    fullPath = sanitizePath(base, dir, path, name)
  } catch (err) {
    console.warn('Invalid path:', path, err)
    throw new BusinessError('Invalid path', NotificationCode.INVALID_REQUEST, 400)
  }

  try {
    await fs.access(fullPath)
  } catch {
    console.warn('File does not exist:', fullPath)
    throw new BusinessError('File does not exist', NotificationCode.NOT_FOUND, 404)
  }

  try {
    await fs.writeFile(fullPath, content)
  } catch (err) {
    console.error('Error editing file:', err)
    throw new ServerError('Failed to edit file', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }
}

/**
 * Rename a file or folder within a directory.
 * @param dir Directory where the file to rename is.
 * @param path Path to the file, relative to the directory, without the file name.
 * @param name Current name of the file.
 * @param newName New name of the file.
 * @param throwError Whether to throw an error if the file does not exist.
 */
export async function renameFile(dir: FileDir | DataDir, path: string, name: string, newName: string, throwError: boolean = true): Promise<void> {
  const slug = getOptionalProfileSlug(dir)
  if (slug) return withProfileMutations(slug, () => renameFileInternal(dir, path, name, newName, throwError, slug))
  return renameFileInternal(dir, path, name, newName, throwError)
}

async function renameFileInternal(
  dir: FileDir | DataDir,
  path: string,
  name: string,
  newName: string,
  throwError: boolean,
  optionalSlug?: string
): Promise<void> {
  const base = getBaseFolder(dir)
  let fullPath, newFullPath
  try {
    name = name.removeUnwantedFilenameChars()
    newName = newName.removeUnwantedFilenameChars()
    fullPath = sanitizePath(base, dir, path, name)
    newFullPath = sanitizePath(base, dir, path, newName)
  } catch (err) {
    console.warn('Invalid path:', path, err)
    throw new BusinessError('Invalid path', NotificationCode.INVALID_REQUEST, 400)
  }

  try {
    await fs.access(fullPath)
  } catch {
    console.warn('File does not exist:', fullPath)
    if (throwError) {
      console.warn('File does not exist:', fullPath)
      throw new BusinessError('File does not exist', NotificationCode.NOT_FOUND, 404)
    } else {
      return // no need to rename anything
    }
  }

  const wasDirectory = (await fs.stat(fullPath)).isDirectory()
  const oldMetadata = optionalSlug ? await readOptionalMetadata(root, optionalSlug) : undefined
  const oldKey = `${path}${name}`.replace(/\\/g, '/')
  const newKey = `${path}${newName}`.replace(/\\/g, '/')
  const nextGroups = oldMetadata
    ? renameOptionalGroupFiles(oldMetadata.groups, oldKey, newKey, wasDirectory)
    : undefined
  const groupsChanged = oldMetadata?.exists && nextGroups && JSON.stringify(oldMetadata.groups) !== JSON.stringify(nextGroups)

  try {
    await fs.mkdir(path_.dirname(newFullPath), { recursive: true })
  } catch (err) {
    console.error('Error creating parent directory:', err)
    throw new ServerError('Failed to create parent directory', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }

  if (groupsChanged && nextGroups) await writeOptionalGroups(root, optionalSlug!, nextGroups)

  try {
    await fs.rename(fullPath, newFullPath)
  } catch (err) {
    if (groupsChanged && oldMetadata) await restoreOptionalMetadata(root, optionalSlug!, oldMetadata).catch(() => {})
    console.error('Error renaming file:', err)
    throw new ServerError('Failed to rename file', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }
}

/**
 * Move a file or folder to a new location.
 * @param oldDir Directory where the file to move is.
 * @param oldPath Path to the file, relative to the old directory, **including** the file name.
 * @param newDir Directory where the file should be moved to.
 * @param newPath Path to the file, relative to the new directory, **including** the file name.
 */
export async function moveFile(oldDir: FileDir | DataDir, oldPath: string, newDir: FileDir | DataDir, newPath: string): Promise<void> {
  const oldBase = getBaseFolder(oldDir)
  const newBase = getBaseFolder(newDir)
  let oldFullPath: string, newFullPath: string
  try {
    oldFullPath = sanitizePath(oldBase, oldDir, oldPath)
    newFullPath = sanitizePath(newBase, newDir, newPath)
  } catch (err) {
    console.warn('Invalid path:', oldPath, newPath, err)
    throw new BusinessError('Invalid path', NotificationCode.INVALID_REQUEST, 400)
  }

  try {
    await fs.access(oldFullPath)
  } catch {
    console.warn('File does not exist:', oldFullPath)
    throw new BusinessError('File does not exist', NotificationCode.NOT_FOUND, 404)
  }

  try {
    await fs.mkdir(path_.dirname(newFullPath), { recursive: true })
  } catch (err) {
    console.error('Error creating parent directory:', err)
    throw new ServerError('Failed to create parent directory', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }

  try {
    await fs.rename(oldFullPath, newFullPath)
  } catch (err) {
    console.error('Error moving file:', err)
    throw new ServerError('Failed to move file', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }
}

/**
 * Delete a file or folder.
 * @param dir Directory where the file to delete is.
 * @param path Path to the file, relative to the directory, **including** the file name.
 * @param throwError Whether to throw an error if the file does not exist.
 */
export async function deleteFile(dir: FileDir | DataDir, path: string, throwError: boolean = true): Promise<void> {
  const slug = getOptionalProfileSlug(dir)
  if (slug) return withProfileMutations(slug, () => deleteFileInternal(dir, path, throwError, slug))
  return deleteFileInternal(dir, path, throwError)
}

async function deleteFileInternal(dir: FileDir | DataDir, relativePath: string, throwError: boolean, optionalSlug?: string): Promise<void> {
  const base = getBaseFolder(dir)
  const targetRelativePath = relativePath.replace(/\\/g, '/')
  let fullPath: string
  try {
    fullPath = sanitizePath(base, dir, relativePath)
  } catch (err) {
    console.warn('Invalid path:', relativePath, err)
    throw new BusinessError('Invalid path', NotificationCode.INVALID_REQUEST, 400)
  }

  try {
    await fs.access(fullPath)
  } catch {
    console.warn('File does not exist:', fullPath)
    if (throwError) {
      console.warn('File does not exist:', fullPath)
      throw new BusinessError('File does not exist', NotificationCode.NOT_FOUND, 404)
    }
    return
  }

  const wasDirectory = (await fs.stat(fullPath)).isDirectory()
  const oldMetadata = optionalSlug ? await readOptionalMetadata(root, optionalSlug) : undefined
  const nextMetadata = oldMetadata
    ? pruneOptionalGroupFiles(oldMetadata.groups, targetRelativePath, wasDirectory)
    : undefined
  const groupsChanged = oldMetadata?.exists && nextMetadata && JSON.stringify(oldMetadata.groups) !== JSON.stringify(nextMetadata)
  if (groupsChanged && nextMetadata) await writeOptionalGroups(root, optionalSlug!, nextMetadata)

  try {
    await fs.rm(fullPath, { recursive: true })
  } catch (err) {
    if (groupsChanged && oldMetadata) await restoreOptionalMetadata(root, optionalSlug!, oldMetadata).catch(() => {})
    console.error('Error deleting file:', err)
    throw new ServerError('Failed to delete file', err, NotificationCode.INTERNAL_SERVER_ERROR, 500)
  }
}

/**
 * Sanitize a path by resolving it and ensuring it is within the root directory. This prevents directory traversal attacks.
 * @param path Segments of the path to sanitize. They will be joined together and resolved.
 */
export function sanitizePath(...path: string[]): string {
  const sanitizedPath = path_.resolve(root, path_.join(...path).replace(/^\\+/, ''))
  if (sanitizedPath !== root && !sanitizedPath.startsWith(`${root}${path_.sep}`)) throw new Error('Invalid path')
  return sanitizedPath
}

/**
 * Generate a cache file for a directory by browsing the directory and saving the file metadata in a JSON file.
 * The cache file will be saved in `data/cache/{dir}.json`.
 * @param dir Directory to generate the cache for (including the profile slug if applicable). This should be the same directory used in `getCachedFiles` and `getCachedFilesParsed`.
 */
export async function cacheFiles(dir: FileDir): Promise<void> {
  const slug = getOptionalProfileSlug(dir)
  if (slug) return withProfileMutations(slug, () => cacheFilesUnsafe(dir))
  return cacheFilesUnsafe(dir)
}

async function cacheFilesUnsafe(dir: FileDir): Promise<void> {
  const base = dir.startsWith('files-updater/') || dir.startsWith('.staging') ? dir.split('/')[0] : null
  const slug = dir.startsWith('files-updater/') || dir.startsWith('.staging') ? dir.split('/')[1] : undefined
  const cacheKey = base && slug ? `${base}-${slug}` : dir
  const files = await getFiles('{{url}}', dir)
  validatePublishedManifest(files as ManifestFile[], { allowTemplateUrls: true })
  await writeAtomicText(path_.join(root, 'data', 'cache', `${cacheKey}.json`), `${JSON.stringify(files, null, 2)}\n`)
}

export function getOptionalModsRevision(files: File_[]): string {
  return computeOptionalModsRevision(files as ManifestFile[])
}

export async function getOptionalModGroups(slug: string): Promise<OptionalGroupRecord> {
  const snapshot = await readOptionalMetadata(root, slug)
  return snapshot.groups
}

export async function saveOptionalModMetadata(
  slug: string,
  metadata: unknown,
  files: File_[],
  removeGroupIds: readonly string[] = []
): Promise<void> {
  const current = await readOptionalMetadata(root, slug, files as ManifestFile[])
  const nextGroups = mergeOptionalMetadataIntoGroups(current.groups, metadata, files as ManifestFile[], removeGroupIds)
  await writeOptionalGroups(root, slug, nextGroups)

  try {
    await cacheFilesUnsafe(`files-updater/${slug}` as FileDir)
  } catch (error) {
    await restoreOptionalMetadata(root, slug, current).catch(() => {})
    throw error
  }
}

export async function renameOptionalProfileState(oldSlug: string, newSlug: string): Promise<void> {
  await withProfileMutations([oldSlug, newSlug], async () => {
    const oldDirectory = sanitizePath('files', 'files-updater', oldSlug)
    const newDirectory = sanitizePath('files', 'files-updater', newSlug)
    const oldDirectoryExists = await pathExists(oldDirectory)
    const newDirectoryExists = await pathExists(newDirectory)
    if (oldDirectoryExists && newDirectoryExists) {
      throw new OptionalModsError('PROFILE_DIRECTORY_CONFLICT', 'Both old and new profile directories exist', 409)
    }

    let directoryMoved = false
    let artifactsMoved = false
    try {
      if (oldDirectoryExists) {
        await renameFileInternal('files-updater', '', oldSlug, newSlug, false)
        directoryMoved = true
      }
      await moveOptionalProfileArtifacts(root, oldSlug, newSlug)
      artifactsMoved = true
      await cacheFilesUnsafe(`files-updater/${newSlug}` as FileDir)
    } catch (error) {
      if (artifactsMoved) await moveOptionalProfileArtifacts(root, newSlug, oldSlug).catch(() => {})
      if (directoryMoved) await renameFileInternal('files-updater', '', newSlug, oldSlug, false).catch(() => {})
      await cacheFilesUnsafe(`files-updater/${oldSlug}` as FileDir).catch(() => {})
      throw error
    }
  })
}

export async function deleteOptionalProfileState(slug: string): Promise<void> {
  await withProfileMutations(slug, () => deleteOptionalProfileArtifacts(root, slug))
}

function getOptionalProfileSlug(dir: string): string | undefined {
  if (!dir.startsWith('files-updater/')) return undefined
  const slug = dir.slice('files-updater/'.length)
  return slug && !slug.includes('/') ? slug : undefined
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch (error) {
    if (isFileNotFound(error)) return false
    throw error
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function getBaseFolder(dir: FileDir | DataDir): 'files' | 'data' {
  if (dir === 'cache' || dir === 'crash-reports') return 'data'
  return 'files'
}

/**
 * Browse files in a directory and add them to the filesArray.
 * @param filesArray Array to store the files in.
 * @param dir Directory to browse.
 * @param subdir Subdirectory to browse.
 * @param domain Domain to use for file URLs.
 */
async function browse(filesArray: File_[], base: 'files' | 'data', dir: FileDir | DataDir, subdir: string, domain: string): Promise<void> {
  const fullDir = subdir === '' ? dir : `${dir}/${subdir}`
  const absDir = `${root}/${base}/${fullDir}`

  try {
    const entries = await fs.readdir(absDir)
    entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    for (const name of entries) {
      const abs = `${root}/${base}/${fullDir}/${name}`
      const path = `${subdir}/`.formatPath()
      const url = base === 'files' ? `${domain}/${base}/${fullDir}/${name}`.replace(/\\/g, '/') : ''
      const type = await getType(path_.join(absDir, name))

      if (type === 'FOLDER') {
        await browse(filesArray, base, dir, `${subdir}/${name}`.replace(/^\/+/, ''), domain)
        filesArray.push({ name, path, url, type })
      } else {
        const size = (await fs.stat(abs)).size
        const sha1 = await getFileSha1(abs)
        filesArray.push({ name, path, size, sha1, url, type })
      }
    }
  } catch (err) {
    console.warn('Error reading directory:', absDir, err)
    throw err
  }
}

/**
 * Get the type of a file based on its path.
 * @param path Path to the file.
 */
async function getType(path: string): Promise<'FOLDER' | 'ASSET' | 'LIBRARY' | 'MOD' | 'CONFIG' | 'BOOTSTRAP' | 'BACKGROUND' | 'IMAGE' | 'OTHER'> {
  if ((await fs.stat(path)).isDirectory()) return 'FOLDER'
  return getFileTypeFromPath(path)
}

/**
 * Get the SHA-1 hash of a file. This is used to check if a file has changed without having to read the entire file content.
 * @param path Path to the file.
 */
async function getFileSha1(path: string): Promise<string> {
  const hash = crypto.createHash('sha1')
  const stream = createReadStream(path)

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

