import { ServerError } from '$lib/utils/errors'
import { NotificationCode } from '$lib/utils/notifications'
import semver from 'semver'
import fork from '../../../varryal.json'

export async function getUpdate(): Promise<{
  currentVersion: string
  upstreamVersion: string
  latestVersion: string
  upstreamUpdateAvailable: boolean
  releaseDate: string
  logoUrl: string
  changelogs: string
}> {
  let data

  try {
    const response = await fetch(`https://api.github.com/repos/${fork.upstreamRepository}/releases/latest`)
    if (response.ok) {
      data = (await response.json()) as { tag_name: string; published_at: string; body: string }
    } else {
      console.error('Failed to fetch latest upstream release:', response.statusText)
      data = { tag_name: `v${fork.upstreamVersion}`, published_at: new Date().toISOString(), body: '' }
    }
  } catch (err) {
    console.error('Failed to fetch latest upstream release:', err)
    data = { tag_name: `v${fork.upstreamVersion}`, published_at: new Date().toISOString(), body: '' }
  }

  const currentVersion = fork.version
  const upstreamVersion = fork.upstreamVersion
  const latestVersion = data.tag_name.replace(/^v/, '') || upstreamVersion
  const releaseDate = data.published_at.split('T')[0] ?? new Date().toISOString().split('T')[0]
  const shortLastVersion = latestVersion.split('.').slice(0, 2).join('.')
  const logoUrl = `https://raw.githubusercontent.com/${fork.upstreamRepository}/refs/heads/main/.github/changelogs/v${shortLastVersion}.png`
  const changelogs = data.body
  const upstreamUpdateAvailable =
    semver.valid(latestVersion) !== null && semver.valid(upstreamVersion) !== null
      ? semver.gt(latestVersion, upstreamVersion)
      : latestVersion !== upstreamVersion

  return { currentVersion, upstreamVersion, latestVersion, upstreamUpdateAvailable, releaseDate, logoUrl, changelogs }
}

export async function update(): Promise<void> {
  console.warn('Direct EML AdminTool self-update is disabled in the Varryal fork.')
  throw new ServerError(
    'Direct upstream updates are disabled for the Varryal fork. Use the controlled Varryal deployment workflow.',
    null,
    NotificationCode.UPDATER_ERROR,
    409
  )
}
