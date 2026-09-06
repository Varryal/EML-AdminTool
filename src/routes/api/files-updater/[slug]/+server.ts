import { getProfileBySlug } from '$lib/server/profile'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDomain } from '$lib/utils/utils'
import { getBearerToken } from '$lib/server/request'
import { ProfileVisibility } from '@prisma/client'
import { verifyScopedToken } from '$lib/server/jwt'
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
  const slug = event.params.slug
  const token = getBearerToken(event.request)

  let profile
  try {
    profile = await getProfileBySlug(slug)
  } catch (err) {
    return manifestError(500, 'PROFILE_LOOKUP_FAILED', 'Unable to resolve the requested profile')
  }

  if (!profile) {
    return manifestError(404, 'PROFILE_NOT_FOUND', 'The requested profile does not exist')
  }

  if (profile.visibility === ProfileVisibility.PROTECTED) {
    if (!token) {
      return manifestError(401, 'AUTHORIZATION_REQUIRED', 'Authorization is required for this profile')
    }
    const isValid = await verifyScopedToken(token, `profile`, { slug })
    if (!isValid) {
      return manifestError(401, 'AUTHORIZATION_INVALID', 'The profile authorization is invalid or expired')
    }
  }

  try {
    const response = await buildFilesUpdaterManifest(profile, domain, event.url.searchParams, event.url.search.length)
    return json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleManifestError(err)
  }
}
