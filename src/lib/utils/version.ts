export type AppChannel = 'prod' | 'preprod'

export type VersionMetadata = {
  channel: AppChannel
  varryalVersion: string
  buildId: string
}

type VersionEnvironment = {
  VARRYAL_CHANNEL?: string
  VARRYAL_VERSION?: string
  VARRYAL_BUILD_ID?: string
}

const SAFE_METADATA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isAppChannel(value: string): value is AppChannel {
  return value === 'prod' || value === 'preprod'
}

function resolveSafeValue(name: string, value: string | undefined, fallback: string): string {
  const resolved = value?.trim() || fallback

  if (!SAFE_METADATA_PATTERN.test(resolved)) {
    throw new Error(`${name} must contain only letters, digits, dots, underscores, and hyphens`)
  }

  return resolved
}

export function resolveVersionMetadata(fallbackVarryalVersion: string, environment: VersionEnvironment = {}): VersionMetadata {
  const channel = environment.VARRYAL_CHANNEL?.trim() || 'prod'

  if (!isAppChannel(channel)) {
    throw new Error(`VARRYAL_CHANNEL must be either prod or preprod (received ${channel})`)
  }

  const varryalVersion = resolveSafeValue('VARRYAL_VERSION', environment.VARRYAL_VERSION, fallbackVarryalVersion)
  const buildId = resolveSafeValue('VARRYAL_BUILD_ID', environment.VARRYAL_BUILD_ID, `release-${varryalVersion}`)

  return { channel, varryalVersion, buildId }
}

export function formatVersionLabel(metadata: VersionMetadata): string {
  const channelLabel = metadata.channel === 'preprod' ? 'PREPROD' : 'PROD'
  return `EML AdminTool ${metadata.varryalVersion} · ${channelLabel} · ${metadata.buildId}`
}
