import { error, redirect } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { db } from '$lib/server/db'
import { BusinessError, ServerError } from '$lib/utils/errors'
import { NotificationCode } from '$lib/utils/notifications'
import { verify } from '$lib/server/auth'
import { profileUserPermissionsSchema, profileSchema } from '$lib/utils/validations'
import { fail } from '$lib/server/action'
import { addProfile, getProfileById, updateProfileUserPermissions, updateProfile, deleteProfile } from '$lib/server/profile'
import { IUserStatus, type ProfilePayload } from '$lib/utils/db'
import { cacheFiles, deleteFile, renameFile, sanitizePath } from '$lib/server/files'
import { deleteLoader, getLoader, updateLoader } from '$lib/server/loader'
import bcrypt from 'bcrypt'
import { ProfileVisibility } from '@prisma/client'
import { existsSync } from 'node:fs'
import { computeSha1Hash, getDomain } from '$lib/utils/utils'
import fs from 'node:fs/promises'
import path_ from 'node:path'

export const load = (async (event) => {
  const user = event.locals.user

  if (!user?.isAdmin) {
    throw redirect(303, '/dashboard')
  }

  try {
    const [profiles, users, userPermissions] = await Promise.all([
      db.profile
        .findMany({ orderBy: { name: 'asc' }, omit: { password: true } })
        .then((profiles) => {
          const defaultIndex = profiles.findIndex((p) => p.isDefault)
          if (defaultIndex > 0) {
            const [defaultProfile] = profiles.splice(defaultIndex, 1)
            profiles.unshift(defaultProfile)
          }
          return profiles
        })
        .catch((err) => {
          console.error('Failed to load profiles:', err)
          throw new ServerError('Failed to load profiles', err, NotificationCode.DATABASE_ERROR, 500)
        }),
      db.user
        .findMany({ where: { status: IUserStatus.ACTIVE, isAdmin: false }, omit: { password: true }, orderBy: { username: 'asc' } })
        .catch((err) => {
          console.error('Failed to load users:', err)
          throw new ServerError('Failed to load users', err, NotificationCode.DATABASE_ERROR, 500)
        }),
      db.userProfilePermission.findMany().catch((err) => {
        console.error('Failed to load profile user permissions:', err)
        throw new ServerError('Failed to load profile user permissions', err, NotificationCode.DATABASE_ERROR, 500)
      })
    ])

    return { profiles, users, userPermissions }
  } catch (err) {
    if (err instanceof ServerError) throw error(err.httpStatus, { message: err.code })

    console.error('Unknown error:', err)
    throw error(500, { message: NotificationCode.INTERNAL_SERVER_ERROR })
  }
}) satisfies PageServerLoad

export const actions: Actions = {
  addEditProfile: async (event) => {
    const user = event.locals.user
    const session = event.cookies.get('session') ?? ''
    const domain = getDomain(event)

    if (!user?.isAdmin) {
      throw error(403, { message: NotificationCode.FORBIDDEN })
    }

    const user_ = await verify(session) // over-security measure to ensure the user is still valid
    if (!user_?.isAdmin) {
      throw error(403, { message: NotificationCode.FORBIDDEN })
    }

    const form = await event.request.formData()
    const raw = {
      profileId: form.get('profile-id'),
      name: form.get('name'),
      visibility: form.get('visibility') || ProfileVisibility.PUBLIC,
      allowedPseudos: form.getAll('allowed-pseudos'),
      password: form.get('password') || undefined,
      ip: form.get('ip') || undefined,
      port: form.get('port') ? Number(form.get('port')) : undefined,
      tcpProtocol: form.get('tcp-protocol') || undefined
    }
    const result = profileSchema.safeParse(raw)

    if (!result.success) {
      return fail(event, 400, { failure: JSON.parse(result.error.message)[0].message })
    }

    const { profileId, name, visibility, allowedPseudos, password, ip, port, tcpProtocol } = result.data

    const rawPermissions = { permissions: form.get('permissions') || undefined }

    const permissionsResult = profileUserPermissionsSchema.safeParse(rawPermissions)

    if (!permissionsResult.success) {
      return fail(event, 400, { failure: JSON.parse(permissionsResult.error.message)[0].message })
    }

    const { permissions } = permissionsResult.data

    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined

    const profile = {
      name: name,
      slug: slug,
      visibility: visibility,
      allowedPseudos: allowedPseudos ?? [],
      password: hashedPassword as string | undefined | null,
      ip: ip ?? null,
      port: port ?? null,
      tcpProtocol: tcpProtocol ?? null
    }
    if (!hashedPassword) delete profile.password

    try {
      if (profileId) {
        const existingProfile = await getProfileById(profileId)
        if (!existingProfile) {
          console.warn(`Profile with ID ${profileId} not found`)
          throw new BusinessError('Profile not found', NotificationCode.NOT_FOUND, 404)
        }

        if (existingProfile.isDefault) {
          profile.visibility = ProfileVisibility.PUBLIC
          profile.allowedPseudos = []
          if (profile.password) profile.password = null
        }

        if (profile.visibility === ProfileVisibility.PROTECTED && !existingProfile.password && !profile.password) {
          return fail(event, 400, { failure: NotificationCode.INVALID_INPUT })
        }

        await updateProfile(profileId, profile)

        if (slug !== existingProfile.slug) {
          await renameFile('files-updater', '', existingProfile.slug, slug, false)
          await deleteFile('cache', `files-updater-${existingProfile.slug}.json`, false)
          await cacheFiles(`files-updater/${slug}`)

          const oldLoaderPath = sanitizePath('files', 'loaders', existingProfile.slug)

          if (existsSync(oldLoaderPath)) {
            await renameFile('loaders', '', existingProfile.slug, slug, false)

            const loader = await getLoader(profileId)

            if (loader?.customVersion) {
              const basePath = path_.join('files', 'loaders', slug)
              const baseUrlOld = `${domain}/files/loaders/${existingProfile.slug}`
              const baseUrlNew = `${domain}/files/loaders/${slug}`

              const versionFilePath = sanitizePath(basePath, 'versions', loader.customVersion, `${loader.customVersion}.json`)
              let versionString = (await fs.readFile(versionFilePath, 'utf-8')).replaceAll(baseUrlOld, baseUrlNew)
              const versionJson = JSON.parse(versionString)

              if (versionJson.assetIndex?.id) {
                const oldAssetIndexId = versionJson.assetIndex.id
                const assetIndexFilePath = sanitizePath(basePath, 'assets', 'indexes', `${oldAssetIndexId}.json`)

                if (existsSync(assetIndexFilePath)) {
                  const assetIndexString = (await fs.readFile(assetIndexFilePath, 'utf-8')).replaceAll(baseUrlOld, baseUrlNew)
                  const assetIndexFile = new File([assetIndexString], `${oldAssetIndexId}.json`, { type: 'application/json' })
                  const assetIndexSha1 = await computeSha1Hash(assetIndexFile)

                  versionJson.assetIndex.sha1 = assetIndexSha1
                  versionJson.assetIndex.size = assetIndexFile.size
                  versionJson.assetIndex.id = assetIndexSha1.slice(0, 8)
                  versionJson.assetIndex.url = `${baseUrlNew}/assets/indexes/${assetIndexSha1.slice(0, 8)}.json`
                  versionJson.assets = assetIndexSha1.slice(0, 8)

                  await fs.writeFile(sanitizePath(basePath, 'assets', 'indexes', `${versionJson.assetIndex.id}.json`), assetIndexString)
                  if (oldAssetIndexId !== versionJson.assetIndex.id) await fs.unlink(assetIndexFilePath)

                  versionString = JSON.stringify(versionJson, null, 2)
                }
              }

              const finalVersionFile = new File([versionString], `${loader.customVersion}.json`, { type: 'application/json' })
              const finalVersionSha1 = await computeSha1Hash(finalVersionFile)
              await fs.writeFile(versionFilePath, versionString)

              // Mise à jour de la BDD
              if (loader.file) {
                ;(loader.file as any).sha1 = finalVersionSha1
                ;(loader.file as any).size = finalVersionFile.size
                ;(loader.file as any).url = (loader.file as any).url.replace(`/loaders/${existingProfile.slug}/`, `/loaders/${slug}/`)
                await updateLoader(loader, profileId)
              }
            }
          }
        }

        if (permissions) {
          await updateProfileUserPermissions(profileId, permissions)
        }
      } else {
        const profileId = await addProfile(profile as ProfilePayload)
        return { profileId }
      }
    } catch (err) {
      if (err instanceof BusinessError) return fail(event, err.httpStatus, { failure: err.code })
      if (err instanceof ServerError) throw error(err.httpStatus, { message: err.code })

      console.error('Unknown error:', err)
      throw error(500, { message: NotificationCode.INTERNAL_SERVER_ERROR })
    }
  },

  deleteProfile: async (event) => {
    const user = event.locals.user

    if (!user?.isAdmin) {
      throw error(403, { message: NotificationCode.FORBIDDEN })
    }

    const form = await event.request.formData()
    const profileId = form.get('profile-id')

    if (!profileId || typeof profileId !== 'string') {
      return fail(event, 400, { failure: NotificationCode.MISSING_INPUT })
    }

    try {
      const existingProfile = await getProfileById(profileId)

      if (!existingProfile) {
        return fail(event, 404, { failure: NotificationCode.NOT_FOUND })
      }

      if (existingProfile.isDefault) {
        return fail(event, 403, { failure: NotificationCode.FORBIDDEN })
      }

      await deleteLoader(existingProfile.id)
      await deleteFile('files-updater', existingProfile.slug, false)
      await deleteFile('loaders', existingProfile.slug, false)
      await deleteFile('cache', `files-updater-${existingProfile.slug}.json`, false)
      await deleteProfile(profileId)
    } catch (err) {
      if (err instanceof BusinessError) return fail(event, err.httpStatus, { failure: err.code })
      if (err instanceof ServerError) throw error(err.httpStatus, { message: err.code })

      console.error('Unknown error:', err)
      throw error(500, { message: NotificationCode.INTERNAL_SERVER_ERROR })
    }
  }
}


