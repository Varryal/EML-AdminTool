export interface OptionalModFileLike {
  name: string
  path: string
  type: string
  optional?: boolean
  optionalId?: string
  title?: string
  description?: string
  enabledByDefault?: boolean
}

export interface OptionalGroupLike {
  title: string
  description: string
  enabledByDefault: boolean
  files: string[]
}

export interface OptionalGroupDraft {
  title: string
  description: string
  enabledByDefault: boolean
  files: string[]
}

export interface OptionalDraftEntry {
  optional: boolean
  optionalId: string
  title: string
  description: string
  enabledByDefault: boolean
}

export interface OptionalModsDraftState {
  groups: Record<string, OptionalGroupDraft>
  drafts: Record<string, OptionalDraftEntry>
}

export function optionalModTitleFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '')
  const withoutLoader = stem.replace(/[-_.](?:neoforge|forge|fabric|quilt|vanilla)(?:[-_.].*)?$/i, '')
  const withoutVersion = withoutLoader.replace(/[-_.]\d[\w.-]*$/, '')
  return (withoutVersion || stem).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function optionalModIdFromFilename(name: string): string {
  return optionalModTitleFromFilename(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'mod'
}

export function optionalModFileKey(file: Pick<OptionalModFileLike, 'path' | 'name'>): string {
  return `${file.path}${file.name}`
}

export function cloneOptionalModsDraft(state: OptionalModsDraftState): OptionalModsDraftState {
  return {
    groups: Object.fromEntries(Object.entries(state.groups).map(([id, group]) => [id, { ...group, files: [...group.files] }])),
    drafts: Object.fromEntries(Object.entries(state.drafts).map(([key, draft]) => [key, { ...draft }]))
  }
}

function syncDraftGroupFiles(
  groups: Record<string, OptionalGroupDraft>,
  drafts: Record<string, OptionalDraftEntry>
): void {
  for (const group of Object.values(groups)) group.files = []
  for (const [fileKey, draft] of Object.entries(drafts)) {
    if (draft.optional && groups[draft.optionalId]) groups[draft.optionalId].files.push(fileKey)
  }
  for (const group of Object.values(groups)) group.files.sort()
}

/** Build the editable UI state without mutating server data or the input arrays. */
export function createOptionalModsDraft(
  files: readonly OptionalModFileLike[],
  sourceGroups: Record<string, OptionalGroupLike>
): OptionalModsDraftState {
  const groups: Record<string, OptionalGroupDraft> = Object.fromEntries(
    Object.entries(sourceGroups).map(([id, group]) => [id, {
      title: group.title,
      description: group.description,
      enabledByDefault: group.enabledByDefault,
      files: []
    }])
  )
  const drafts: Record<string, OptionalDraftEntry> = {}
  const mods = files.filter((file) => file.type === 'MOD')

  for (const file of mods) {
    const fileKey = optionalModFileKey(file)
    const sidecarGroup = Object.entries(sourceGroups).find(([, group]) => group.files.includes(fileKey))
    const optionalId = file.optionalId ?? sidecarGroup?.[0] ?? optionalModIdFromFilename(file.name)
    const isOptional = file.optional === true

    if (isOptional && !groups[optionalId]) {
      groups[optionalId] = {
        title: file.title ?? optionalModTitleFromFilename(file.name),
        description: file.description ?? '',
        enabledByDefault: file.enabledByDefault ?? false,
        files: []
      }
    }

    const group = groups[optionalId]
    drafts[fileKey] = {
      optional: isOptional,
      optionalId,
      title: group?.title ?? file.title ?? optionalModTitleFromFilename(file.name),
      description: group?.description ?? file.description ?? '',
      enabledByDefault: group?.enabledByDefault ?? file.enabledByDefault ?? false
    }
  }

  syncDraftGroupFiles(groups, drafts)
  return { groups, drafts }
}

function groupFieldsEqual(left: OptionalGroupDraft | undefined, right: OptionalGroupDraft | undefined): boolean {
  if (!left || !right) return left === right
  return left.title === right.title && left.description === right.description && left.enabledByDefault === right.enabledByDefault
}

function draftFieldsEqual(left: OptionalDraftEntry | undefined, right: OptionalDraftEntry | undefined): boolean {
  if (!left || !right) return left === right
  return left.optional === right.optional && left.optionalId === right.optionalId && left.title === right.title && left.description === right.description && left.enabledByDefault === right.enabledByDefault
}

/** Rebase local edits onto a fresh server snapshot while retaining unsaved local fields. */
export function rebaseOptionalModsDraft(
  base: OptionalModsDraftState,
  local: OptionalModsDraftState,
  fresh: OptionalModsDraftState,
  removedGroupIds: readonly string[] = []
): OptionalModsDraftState {
  const groups = Object.fromEntries(Object.entries(fresh.groups).map(([id, group]) => [id, { ...group, files: [...group.files] }]))
  const drafts = Object.fromEntries(Object.entries(fresh.drafts).map(([key, draft]) => [key, { ...draft }]))
  const removed = new Set(removedGroupIds)

  for (const [id, group] of Object.entries(local.groups)) {
    if (removed.has(id)) continue
    // A group missing from the fresh snapshot was removed remotely. Keep it
    // only when the operator also changed it locally (or created it after the
    // base snapshot); otherwise the remote deletion must win the rebase.
    if (base.groups[id] === undefined || !groupFieldsEqual(group, base.groups[id])) {
      groups[id] = { ...group, files: [...group.files] }
    }
  }

  for (const [key, draft] of Object.entries(local.drafts)) {
    if (!fresh.drafts[key]) continue
    if (!draftFieldsEqual(draft, base.drafts[key])) drafts[key] = { ...draft }
  }

  for (const id of removed) delete groups[id]
  for (const [key, draft] of Object.entries(drafts)) {
    if (!groups[draft.optionalId]) draft.optional = false
  }
  syncDraftGroupFiles(groups, drafts)
  return { groups, drafts }
}

export type FileCountTranslationKey = 'fileCountOne' | 'fileCountFew' | 'fileCountMany'

export function fileCountTranslationKey(language: string, count: number): FileCountTranslationKey {
  if (count === 1 || (language === 'ru' && count % 10 === 1 && count % 100 !== 11)) return 'fileCountOne'
  if (language === 'ru') {
    const modulo10 = count % 10
    const modulo100 = count % 100
    if (modulo10 >= 2 && modulo10 <= 4 && (modulo100 < 12 || modulo100 > 14)) return 'fileCountFew'
  }
  return 'fileCountMany'
}

export function switchValueForKey(current: boolean, key: string): boolean | undefined {
  if (key !== 'Enter' && key !== ' ') return undefined
  return !current
}
