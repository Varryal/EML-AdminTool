import { getDefaultProfile } from '$lib/server/profile'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDomain } from '$lib/utils/utils'
import { OptionalModsError, createManifestError } from '$lib/server/optional-mods'
import { buildFilesUpdaterManifest } from '$lib/server/files-updater-manifest'

function manifestError(status: number, code: string, message: string, responseFields: Readonly<Record<string, unknown>> = {}) {
  return json(
    createManifestError(code, message, responseFields),
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}

function handleManifestError(error: unknown) {
  if (error instanceof OptionalModsError) {
    if (error.code === 'invalid_optional_selection') {
      return manifestError(400, error.code, 'Optional group selection is invalid')
    }
    if (error.code === 'optional_selection_too_large') {
      return manifestError(400, error.code, 'Optional group selection is too large')
    }
    if (error.code === 'optional_selection_stale') {
      return manifestError(409, error.code, 'Optional group selection is stale', error.responseFields)
    }
    if (error.code === 'MANIFEST_UNAVAILABLE') {
      return manifestError(500, error.code, 'The files manifest is temporarily unavailable')
    }
    if (error.code === 'LOADER_UNAVAILABLE') {
      return manifestError(500, error.code, 'The loader data is temporarily unavailable')
    }
    if (error.code === 'MANIFEST_INVALID') {
      return manifestError(500, error.code, 'The files manifest is invalid')
    }
  }
  return manifestError(500, 'MANIFEST_UNAVAILABLE', 'The files manifest is temporarily unavailable')
}

export const GET: RequestHandler = async (event) => {
  const domain = getDomain(event)

  let profile
  try {
    profile = await getDefaultProfile()
  } catch (err) {
    return manifestError(500, 'PROFILE_LOOKUP_FAILED', 'Unable to resolve the default profile')
  }

  if (!profile) {
    return manifestError(404, 'PROFILE_NOT_FOUND', 'No default profile is configured')
  }

  try {
    const response = await buildFilesUpdaterManifest(profile, domain, event.url.searchParams, event.url.search.length)
    return json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleManifestError(err)
  }
}

