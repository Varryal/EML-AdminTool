import { defaultLoader, getLoader } from './loader'
import { getExistingCachedFiles } from './files'
import {
  createFilteredManifest,
  OptionalModsError,
  parseOptionalSelection,
  type FilteredManifestResponse,
  type ManifestLoaderData
} from './optional-mods'

type ManifestProfile = { id: string; slug: string }

function toLoaderData(source: typeof defaultLoader | NonNullable<Awaited<ReturnType<typeof getLoader>>>, domain: string): ManifestLoaderData {
  let file = source.file as unknown
  if (file && typeof file === 'object' && !Array.isArray(file)) {
    const fileRecord = { ...(file as Record<string, unknown>) }
    if (typeof fileRecord.url === 'string') {
      fileRecord.url = fileRecord.url.replaceAll('{{url}}', domain)
    }
    file = fileRecord
  }

  return {
    type: source.type,
    minecraftVersion: source.minecraftVersion,
    loaderVersion: source.loaderVersion,
    customVersion: source.customVersion ?? null,
    file
  }
}

export async function buildFilesUpdaterManifest(
  profile: ManifestProfile,
  domain: string,
  searchParams: URLSearchParams,
  queryLength: number
): Promise<FilteredManifestResponse> {
  const selection = parseOptionalSelection(searchParams, queryLength)

  let cache: string
  try {
    cache = await getExistingCachedFiles(domain, `files-updater/${profile.slug}`)
  } catch (error) {
    throw new OptionalModsError('MANIFEST_UNAVAILABLE', 'The files manifest is temporarily unavailable', 500, error)
  }

  let parsedCache: unknown
  try {
    parsedCache = JSON.parse(cache)
  } catch (error) {
    throw new OptionalModsError('MANIFEST_INVALID', 'The files manifest is invalid', 500, error)
  }

  let loader: ManifestLoaderData
  try {
    loader = toLoaderData((await getLoader(profile.id)) ?? defaultLoader, domain)
  } catch (error) {
    throw new OptionalModsError('LOADER_UNAVAILABLE', 'The loader data is temporarily unavailable', 500, error)
  }

  try {
    return createFilteredManifest(profile, parsedCache, selection, loader)
  } catch (error) {
    if (error instanceof OptionalModsError && (error.code === 'invalid_optional_selection' || error.code === 'optional_selection_too_large' || error.code === 'optional_selection_stale')) {
      throw error
    }
    throw new OptionalModsError('MANIFEST_INVALID', 'The files manifest is invalid', 500, error)
  }
}
