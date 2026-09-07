<script lang="ts">
  import type { File as File_ } from '$lib/utils/types'
  import type { Profile } from '@prisma/client'
  import ModalTemplate from './__ModalTemplate.svelte'
  import OptionalGroupPicker, { type GroupPickerOption } from '../OptionalGroupPicker.svelte'
  import Switch from '../Switch.svelte'
  import { enhance } from '$app/forms'
  import type { SubmitFunction } from '@sveltejs/kit'
  import { addNotification } from '$lib/stores/notifications'
  import { currentLanguage, l } from '$lib/stores/language'
  import {
    cloneOptionalModsDraft,
    createOptionalModsDraft,
    fileCountTranslationKey,
    optionalModFileKey,
    optionalModIdFromFilename,
    optionalModTitleFromFilename,
    rebaseOptionalModsDraft,
    type OptionalGroupDraft,
    type OptionalModsDraftState
  } from '$lib/utils/optional-mods-ui'

  interface Props {
    show: boolean
    selectedProfile: Profile
    files: File_[]
    groups: Record<string, OptionalGroupDraft>
    revision: string
  }

  interface PickerTarget {
    fileKey: string
    pending: boolean
    previousOptional: boolean
    previousId: string
  }

  interface ConflictSnapshot {
    revision: string
    files: File_[]
    groups: Record<string, OptionalGroupDraft>
  }

  const OPTIONAL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

  let { show = $bindable(), selectedProfile, files, groups, revision }: Props = $props()

  let currentRevision = $state('')
  let groupDrafts = $state<Record<string, OptionalGroupDraft>>({})
  let drafts = $state<OptionalModsDraftState['drafts']>({})
  let baseDraft = $state<OptionalModsDraftState>({ groups: {}, drafts: {} })
  let lastIncomingSignature = $state('')
  let searchQuery = $state('')
  let saving = $state(false)
  let saveError = $state('')
  let conflict = $state(false)
  let localError = $state('')
  let removeGroupIds = $state<string[]>([])
  let identityWarnings = $state<Record<string, boolean>>({})
  let pickerTarget = $state<PickerTarget | null>(null)
  let openOrphanPicker = $state<string | null>(null)
  let conflictSnapshot = $state<ConflictSnapshot | null>(null)
  let conflictChanges = $state<string[]>([])

  const incomingSignature = $derived.by(() => JSON.stringify({
    revision,
    files: files.map((file) => ({ path: file.path, name: file.name, type: file.type, size: file.size, sha1: file.sha1, optional: file.optional, optionalId: file.optionalId, title: file.title, description: file.description, enabledByDefault: file.enabledByDefault })),
    groups
  }))
  const mods = $derived(files.filter((file) => file.type === 'MOD'))
  const query = $derived(searchQuery.trim().toLowerCase())
  const requiredMods = $derived(mods.filter((file) => !drafts[optionalModFileKey(file)]?.optional))
  const filteredMods = $derived(mods.filter((file) => {
    if (!query) return true
    const key = optionalModFileKey(file).toLowerCase()
    const draft = drafts[optionalModFileKey(file)]
    const group = draft ? groupDrafts[draft.optionalId] : undefined
    return [key, draft?.optionalId ?? '', group?.title ?? '', group?.description ?? ''].some((value) => value.toLowerCase().includes(query))
  }))

  function filesForGroup(id: string): File_[] {
    return mods.filter((file) => drafts[optionalModFileKey(file)]?.optional && drafts[optionalModFileKey(file)]?.optionalId === id)
  }

  const optionalGroups = $derived.by(() => Object.entries(groupDrafts)
    .map(([id, group]) => ({ id, ...group, files: filesForGroup(id) }))
    .sort((left, right) => left.id.localeCompare(right.id)))
  const orphanGroups = $derived(optionalGroups.filter((group) => group.files.length === 0))
  const selectedCount = $derived(optionalGroups.filter((group) => group.files.length > 0 && !removeGroupIds.includes(group.id)).length)
  const filteredGroups = $derived(optionalGroups.filter((group) => {
    if (!query) return true
    return [group.id, group.title, group.description, ...group.files.map(optionalModFileKey)].some((value) => value.toLowerCase().includes(query))
  }))
  const groupOptions = $derived<GroupPickerOption[]>(optionalGroups
    .filter((group) => !removeGroupIds.includes(group.id))
    .map((group) => ({ id: group.id, title: group.title || $l.dashboard.optionalMods.unnamedGroup, fileCount: fileCountText(group.files.length) })))
  const validationErrors = $derived.by(() => {
    const errors: string[] = []
    for (const group of optionalGroups) {
      if (!OPTIONAL_ID.test(group.id)) errors.push($l.dashboard.optionalMods({ id: group.id || '(empty)' }).invalidGroupId)
      if (!group.title.trim() || group.title.trim().length > 120) errors.push($l.dashboard.optionalMods({ id: group.id || '(empty)' }).invalidTitle)
      if (group.description.length > 500) errors.push($l.dashboard.optionalMods({ id: group.id }).descriptionTooLong)
    }
    return errors
  })

  function applyDraftState(next: OptionalModsDraftState): void {
    groupDrafts = next.groups
    drafts = next.drafts
  }

  function currentDraftState(): OptionalModsDraftState {
    return { groups: groupDrafts, drafts }
  }

  function syncIncomingState(): void {
    const incoming = createOptionalModsDraft(files, groups)
    if (!lastIncomingSignature) {
      applyDraftState(incoming)
      baseDraft = cloneOptionalModsDraft(incoming)
    } else {
      const merged = rebaseOptionalModsDraft(baseDraft, currentDraftState(), incoming, removeGroupIds)
      applyDraftState(merged)
      baseDraft = cloneOptionalModsDraft(incoming)
    }
    currentRevision = revision
    lastIncomingSignature = incomingSignature
  }

  $effect(() => {
    if (incomingSignature !== lastIncomingSignature) syncIncomingState()
  })

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value
  }

  function uniqueId(base: string): string {
    let candidate = base.slice(0, 64) || 'mod'
    let suffix = 2
    while (groupDrafts[candidate]) {
      const suffixText = `-${suffix++}`
      candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`
    }
    return candidate
  }

  function updateGroup(id: string, field: 'optionalId' | 'title' | 'description' | 'enabledByDefault', value: string | boolean): void {
    if (field === 'optionalId') {
      if (typeof value !== 'string' || (value !== id && groupDrafts[value])) {
        localError = $l.dashboard.optionalMods({ id: String(value) }).duplicateGroupId
        return
      }
      if (!OPTIONAL_ID.test(value)) {
        localError = $l.dashboard.optionalMods({ id: value || '(empty)' }).invalidGroupId
        return
      }
      const group = groupDrafts[id]
      if (!group || value === id) return
      delete groupDrafts[id]
      groupDrafts[value] = group
      for (const draft of Object.values(drafts)) {
        if (draft.optional && draft.optionalId === id) draft.optionalId = value
      }
      removeGroupIds = removeGroupIds.map((groupId) => groupId === id ? value : groupId)
      if (identityWarnings[id]) {
        delete identityWarnings[id]
        identityWarnings[value] = true
      } else {
        identityWarnings[value] = true
      }
      localError = ''
      return
    }

    const group = groupDrafts[id]
    if (!group) return
    group[field] = value as never
    for (const draft of Object.values(drafts)) {
      if (draft.optional && draft.optionalId === id && (field === 'title' || field === 'description' || field === 'enabledByDefault')) {
        draft[field] = value as never
      }
    }
    localError = ''
  }

  function syncGroupFiles(): void {
    for (const group of Object.values(groupDrafts)) group.files = []
    for (const [fileKey, draft] of Object.entries(drafts)) {
      if (draft.optional && groupDrafts[draft.optionalId]) groupDrafts[draft.optionalId].files.push(fileKey)
    }
    for (const group of Object.values(groupDrafts)) group.files.sort()
  }

  function bindFile(file: File_, id: string): void {
    const group = groupDrafts[id]
    const draft = drafts[optionalModFileKey(file)]
    if (!group || !draft || removeGroupIds.includes(id)) return
    draft.optional = true
    draft.optionalId = id
    draft.title = group.title
    draft.description = group.description
    draft.enabledByDefault = group.enabledByDefault
    syncGroupFiles()
    localError = ''
  }

  function startGroupPicker(file: File_): void {
    const fileKey = optionalModFileKey(file)
    const draft = drafts[fileKey]
    if (!draft) return
    pickerTarget = {
      fileKey,
      pending: !draft.optional,
      previousOptional: draft.optional,
      previousId: draft.optionalId
    }
    if (!draft.optional) draft.optional = true
  }

  function toggleFile(file: File_, checked: boolean): void {
    const fileKey = optionalModFileKey(file)
    const draft = drafts[fileKey]
    if (!draft) return
    if (checked) {
      startGroupPicker(file)
    } else {
      draft.optional = false
      pickerTarget = null
      syncGroupFiles()
    }
  }

  function selectGroup(fileKey: string, id: string): void {
    const file = mods.find((candidate) => optionalModFileKey(candidate) === fileKey)
    if (!file) return
    bindFile(file, id)
    pickerTarget = null
  }

  function createGroupForFile(file: File_): void {
    const id = uniqueId(optionalModIdFromFilename(file.name))
    groupDrafts[id] = {
      title: optionalModTitleFromFilename(file.name),
      description: '',
      enabledByDefault: false,
      files: []
    }
    bindFile(file, id)
    pickerTarget = null
  }

  function cancelGroupPicker(): void {
    if (!pickerTarget) return
    const target = pickerTarget
    const draft = drafts[target.fileKey]
    if (target.pending && draft) {
      draft.optional = target.previousOptional
      draft.optionalId = target.previousId
      syncGroupFiles()
    }
    pickerTarget = null
  }

  function markGroupForRemoval(id: string): void {
    if (!removeGroupIds.includes(id)) removeGroupIds = [...removeGroupIds, id]
    if (pickerTarget && drafts[pickerTarget.fileKey]?.optionalId === id) cancelGroupPicker()
  }

  function undoGroupRemoval(id: string): void {
    removeGroupIds = removeGroupIds.filter((groupId) => groupId !== id)
  }

  function toggleOrphanPicker(id: string): void {
    openOrphanPicker = openOrphanPicker === id ? null : id
  }

  function bindOrphan(id: string, fileKey: string): void {
    const file = requiredMods.find((candidate) => optionalModFileKey(candidate) === fileKey)
    if (!file) return
    bindFile(file, id)
    openOrphanPicker = null
  }

  function fileCountText(count: number): string {
    const key = fileCountTranslationKey($currentLanguage, count)
    if (key === 'fileCountOne') return $l.dashboard.optionalMods.fileCountOne
    return ($l.dashboard.optionalMods({ count }) as any)[key]
  }

  function fileStateLabel(file: File_): string {
    return drafts[optionalModFileKey(file)]?.optional ? $l.dashboard.optionalMods.optionalState : $l.dashboard.optionalMods.requiredState
  }

  function getFailureCode(result: any): string {
    const value = result?.data?.failure
    return typeof value === 'string' ? value : 'INTERNAL_SERVER_ERROR'
  }

  function failureMessage(code: string): string {
    if (code === 'OPTIONAL_MODS_CONFLICT') return $l.dashboard.optionalMods.conflict
    if (code === 'OPTIONAL_METADATA_INVALID' || code === 'OPTIONAL_GROUP_CONFLICT') return $l.dashboard.optionalMods.invalid
    if (code === 'OPTIONAL_METADATA_READ_FAILED') return $l.dashboard.optionalMods.readFailed
    return $l.dashboard.optionalMods.saveFailed
  }

  function conflictChangeList(nextFiles: File_[], nextGroups: Record<string, OptionalGroupDraft>): string[] {
    const changes: string[] = []
    const oldFiles = files.map((file) => `${file.path}${file.name}:${file.size}:${file.sha1}`).sort().join('|')
    const newFiles = nextFiles.map((file) => `${file.path}${file.name}:${file.size}:${file.sha1}`).sort().join('|')
    if (oldFiles !== newFiles) changes.push($l.dashboard.optionalMods.changedFiles)
    if (JSON.stringify(groups) !== JSON.stringify(nextGroups)) changes.push($l.dashboard.optionalMods.changedGroups)
    return changes
  }

  function responseSnapshot(result: any): ConflictSnapshot | null {
    const data = result?.data
    if (!data || typeof data.revision !== 'string' || !Array.isArray(data.files) || !data.groups || typeof data.groups !== 'object') return null
    return { revision: data.revision, files: data.files as File_[], groups: data.groups as Record<string, OptionalGroupDraft> }
  }

  function applyServerSnapshot(snapshot: ConflictSnapshot, preserveLocal: boolean): void {
    const fresh = createOptionalModsDraft(snapshot.files, snapshot.groups)
    const next = preserveLocal
      ? rebaseOptionalModsDraft(baseDraft, currentDraftState(), fresh, removeGroupIds)
      : fresh
    applyDraftState(next)
    baseDraft = cloneOptionalModsDraft(fresh)
    currentRevision = snapshot.revision
    lastIncomingSignature = incomingSignature
  }

  function refreshConflict(): void {
    if (!conflictSnapshot) return
    applyServerSnapshot(conflictSnapshot, true)
    conflictSnapshot = null
    conflictChanges = []
    conflict = false
    saveError = ''
  }

  const submit: SubmitFunction = ({ formData }) => {
    if (validationErrors.length > 0) return undefined
    saving = true
    saveError = ''
    conflict = false
    conflictSnapshot = null
    conflictChanges = []
    formData.set('profile-id', selectedProfile.id)
    formData.set('revision', currentRevision)
    formData.set('remove-group-ids', JSON.stringify(removeGroupIds))
    formData.set(
      'metadata',
      JSON.stringify(Object.fromEntries(
        Object.entries(drafts)
          .filter(([, value]) => value.optional)
          .map(([fileKey, value]) => [fileKey, {
            optional: true,
            optionalId: value.optionalId,
            title: value.title,
            description: value.description,
            enabledByDefault: value.enabledByDefault
          }])
      ))
    )

    return async ({ result, update }) => {
      if (result.type === 'failure') {
        const code = getFailureCode(result)
        saveError = failureMessage(code)
        conflict = code === 'OPTIONAL_MODS_CONFLICT'
        saving = false
        if (conflict) {
          conflictSnapshot = responseSnapshot(result)
          if (conflictSnapshot) conflictChanges = conflictChangeList(conflictSnapshot.files, conflictSnapshot.groups)
        }
        addNotification('ERROR', saveError)
        await update({ reset: false })
        return
      }

      if (result.type !== 'success') {
        saving = false
        return
      }

      const data = result.data as { revision?: string; files?: File_[]; groups?: Record<string, OptionalGroupDraft> }
      await update({ reset: false, invalidateAll: true })
      if (data.revision && data.files && data.groups) {
        applyServerSnapshot({ revision: data.revision, files: data.files, groups: data.groups }, false)
      } else {
        currentRevision = data.revision ?? currentRevision
      }
      removeGroupIds = []
      identityWarnings = {}
      saving = false
      saveError = ''
      conflict = false
    }
  }
</script>

<ModalTemplate size="l" bind:show>
  <form class="mods-form" method="POST" action="?/saveOptionalMods" use:enhance={submit}>
    <header class="modal-header">
      <div class="title-block">
        <h2><i class="fa-solid fa-puzzle-piece"></i>&nbsp;{$l.dashboard.optionalMods.title} · {selectedProfile.name}</h2>
        <p>{$l.dashboard.optionalMods.subtitle}</p>
      </div>
      <div class="header-tools">
        <label class="search-box">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input type="search" aria-label={$l.dashboard.optionalMods.searchLabel} placeholder={$l.dashboard.optionalMods.searchPlaceholder} bind:value={searchQuery} />
        </label>
        <span class="count">{$l.dashboard.optionalMods({ selected: selectedCount, files: mods.length }).count}</span>
      </div>
    </header>

    {#if saveError}
      <div class:error-banner={conflict} class="error-banner" role="alert">
        <span>{saveError}</span>
        {#if conflict}<button type="button" class="secondary small inline-action" onclick={refreshConflict}>{$l.dashboard.optionalMods.refreshConflict}</button>{/if}
        {#if conflict}
          <div class="conflict-details">
            <strong>{$l.dashboard.optionalMods.conflictChanges}</strong>
            {#if conflictChanges.length > 0}<ul>{#each conflictChanges as change}<li>{change}</li>{/each}</ul>{:else}<p>{$l.dashboard.optionalMods.conflictNoChanges}</p>{/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if localError}<div class="error-banner" role="alert">{localError}</div>{/if}
    {#if validationErrors.length > 0}
      <ul class="validation-errors" role="alert">{#each validationErrors as validationError}<li>{validationError}</li>{/each}</ul>
    {/if}

    {#if orphanGroups.length > 0}
      <section class="orphan-banner" aria-labelledby="orphan-title">
        <strong id="orphan-title">{$l.dashboard.optionalMods.orphanTitle}</strong>
        <p>{$l.dashboard.optionalMods.orphanDescription}</p>
        {#each orphanGroups as group (group.id)}
          <div class="orphan-row">
            <span title={`${group.title} · ${group.id}`}><b>{group.title || $l.dashboard.optionalMods.unnamedGroup}</b> · {group.id}</span>
            <div class="orphan-actions">
              <button type="button" class="secondary small" disabled={removeGroupIds.includes(group.id)} onclick={() => toggleOrphanPicker(group.id)}>{$l.dashboard.optionalMods.bindFile}</button>
              {#if openOrphanPicker === group.id}
                <div class="orphan-file-picker" role="list" aria-label={$l.dashboard.optionalMods.selectFile}>
                  {#if requiredMods.length === 0}<span>{$l.dashboard.optionalMods.noUnboundFile}</span>{/if}
                  {#each requiredMods as file (optionalModFileKey(file))}<button type="button" class="link-button" onclick={() => bindOrphan(group.id, optionalModFileKey(file))} title={optionalModFileKey(file)}>{optionalModFileKey(file)}</button>{/each}
                </div>
              {/if}
              <button type="button" class="danger small" onclick={() => markGroupForRemoval(group.id)} disabled={removeGroupIds.includes(group.id)}>{$l.dashboard.optionalMods.deleteGroup}</button>
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if mods.length === 0}
      <div class="empty"><i class="fa-solid fa-box-open"></i><strong>{$l.dashboard.optionalMods.noMods}</strong><span>{$l.dashboard.optionalMods.uploadHint}</span></div>
    {:else if filteredGroups.length === 0 && filteredMods.length === 0}
      <div class="empty search-empty"><i class="fa-solid fa-magnifying-glass"></i><strong>{$l.dashboard.optionalMods.noMatches}</strong><span>{$l.dashboard.optionalMods.tryAnotherSearch}</span></div>
    {:else}
      <div class="mod-list">
        {#if filteredGroups.length > 0}
          <section class="groups-list" aria-label={$l.dashboard.optionalMods.title}>
            {#each filteredGroups as group (group.id)}
              {@const pendingRemoval = removeGroupIds.includes(group.id)}
              <article class:pending-removal={pendingRemoval} class="group-row">
                <div class="group-header">
                  <div class="mod-icon"><i class="fa-solid fa-cubes"></i></div>
                  <div class="group-heading"><strong title={group.title || $l.dashboard.optionalMods.unnamedGroup}>{group.title || $l.dashboard.optionalMods.unnamedGroup}</strong><span>{fileCountText(group.files.length)} · {group.id}</span></div>
                  {#if pendingRemoval}<button type="button" class="secondary small" onclick={() => undoGroupRemoval(group.id)}>{$l.dashboard.optionalMods.undoDelete}</button>{:else}<button type="button" class="secondary small" onclick={() => markGroupForRemoval(group.id)}>{$l.dashboard.optionalMods.removeGroup}</button>{/if}
                </div>
                {#if identityWarnings[group.id]}<div class="warning-banner" role="status">{$l.dashboard.optionalMods.identityWarning}</div>{/if}
                {#if pendingRemoval}
                  <div class="deletion-note" role="status"><strong>{$l.dashboard.optionalMods.deleteGroupPending}</strong><p>{$l.dashboard.optionalMods.deleteGroupDetails}</p><span>{fileCountText(group.files.length)}</span></div>
                {/if}
                <div class="group-fields">
                  <label>{$l.dashboard.optionalMods.groupId}<input aria-label={`${$l.dashboard.optionalMods.groupId}: ${group.id}`} value={group.id} disabled={pendingRemoval} oninput={(event) => updateGroup(group.id, 'optionalId', inputValue(event))} /></label>
                  <label>{$l.dashboard.optionalMods.groupTitle}<input aria-label={`${$l.dashboard.optionalMods.groupTitle}: ${group.id}`} value={group.title} maxlength="120" disabled={pendingRemoval} oninput={(event) => updateGroup(group.id, 'title', inputValue(event))} /></label>
                  <label>{$l.dashboard.optionalMods.groupDescription}<input aria-label={`${$l.dashboard.optionalMods.groupDescription}: ${group.id}`} value={group.description} maxlength="500" disabled={pendingRemoval} oninput={(event) => updateGroup(group.id, 'description', inputValue(event))} /></label>
                  <label class="default-switch"><Switch checked={group.enabledByDefault} disabled={pendingRemoval} label={`${$l.dashboard.optionalMods.enabledByDefault}: ${group.id}`} onchange={(checked) => updateGroup(group.id, 'enabledByDefault', checked)} /><span>{$l.dashboard.optionalMods.enabledByDefault}</span></label>
                </div>
                <ul class="membership" aria-label={`${$l.dashboard.optionalMods.groupTitle}: ${group.id}`}>
                  {#if group.files.length === 0}<li class="empty-membership">{$l.dashboard.optionalMods.orphanDescription}</li>{/if}
                  {#each group.files as file (optionalModFileKey(file))}<li><span title={optionalModFileKey(file)}>{optionalModFileKey(file)}</span><button type="button" class="link-button" onclick={() => startGroupPicker(file)} disabled={pendingRemoval}>{$l.dashboard.optionalMods.changeGroup}</button></li>{/each}
                </ul>
              </article>
            {/each}
          </section>
        {/if}

        {#if filteredMods.length > 0}
          <section class="files-list" aria-label={$l.dashboard.optionalMods.makeOptional}>
            {#each filteredMods as file (optionalModFileKey(file))}
              {@const fileKey = optionalModFileKey(file)}
              {@const draft = drafts[fileKey]}
              {@const selectedGroup = draft?.optional ? groupDrafts[draft.optionalId] : undefined}
              <article class="file-row" class:optional-file={draft?.optional}>
                <div class="file-main">
                  <span class="file-name" title={fileKey}><i class="fa-solid fa-cube" aria-hidden="true"></i> {fileKey}</span>
                  {#if draft?.optional && selectedGroup}<span class="assigned-group" title={fileKey}>{$l.dashboard.optionalMods({ title: selectedGroup.title, id: draft.optionalId }).assignedTo}</span>{/if}
                </div>
                <div class="file-controls">
                  {#if draft?.optional}<button type="button" class="link-button" onclick={() => startGroupPicker(file)}>{$l.dashboard.optionalMods.changeGroup}</button><button type="button" class="link-button" onclick={() => toggleFile(file, false)}>{$l.dashboard.optionalMods.detachGroup}</button>{/if}
                  <Switch checked={draft?.optional ?? false} label={`${fileStateLabel(file)}: ${fileKey}`} onchange={(checked) => toggleFile(file, checked)} />
                </div>
                {#if pickerTarget?.fileKey === fileKey}
                  <div class="picker-slot">
                    <OptionalGroupPicker
                      groups={groupOptions}
                      currentGroupId={draft?.optionalId}
                      fileLabel={fileKey}
                      groupPickerLabel={$l.dashboard.optionalMods.groupPickerLabel}
                      searchLabel={$l.dashboard.optionalMods.groupSearchLabel}
                      searchPlaceholder={$l.dashboard.optionalMods.groupSearchPlaceholder}
                      chooseExisting={$l.dashboard.optionalMods.chooseExisting}
                      createNew={$l.dashboard.optionalMods.createNew}
                      noGroupMatches={$l.dashboard.optionalMods.noGroupMatches}
                      cancelLabel={$l.dashboard.optionalMods.cancelGroupSelection}
                      onselect={(id) => selectGroup(fileKey, id)}
                      oncreate={() => createGroupForFile(file)}
                      oncancel={cancelGroupPicker}
                    />
                  </div>
                {/if}
              </article>
            {/each}
          </section>
        {/if}
      </div>
    {/if}

    <p class="hint"><i class="fa-solid fa-circle-info"></i> {$l.dashboard.optionalMods.hint}</p>
    <div class="actions">
      <button type="button" class="secondary" onclick={() => (show = false)}>{$l.common.cancel}</button>
      <button type="submit" class="primary" disabled={mods.length === 0 || validationErrors.length > 0 || saving}>{saving ? $l.dashboard.optionalMods.saving : $l.common.save}</button>
    </div>
  </form>
</ModalTemplate>

<style lang="scss">
  @use '../../../static/scss/modals.scss';

  .mods-form { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .modal-header { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: start; margin-bottom: 18px; }
  .title-block { min-width: 0; }
  h2 { margin: 0 0 6px; }
  .modal-header p, .orphan-banner p { margin: 0; color: var(--text-secondary-color, #6b7280); }
  .header-tools { display: flex; align-items: center; gap: 10px; }
  .search-box { position: relative; width: min(320px, 27vw); margin: 0; font-weight: 400; }
  .search-box i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); z-index: 1; color: var(--text-secondary-color, #6b7280); pointer-events: none; }
  .search-box input { width: 100%; box-sizing: border-box; margin: 0; padding-left: 34px; }
  .count { flex: none; padding: 7px 10px; border-radius: 999px; background: var(--secondary-color, #f1f3f5); color: var(--text-secondary-color, #6b7280); font-size: .85rem; white-space: nowrap; }
  .error-banner, .validation-errors, .warning-banner, .orphan-banner { flex: none; margin: 0 0 10px; padding: 10px 12px; border: 1px solid #b84a4a; border-radius: 7px; color: #8b1e1e; background: #fff0f0; }
  .warning-banner { border-color: #b27a18; color: #7a4b00; background: #fff8e5; }
  .validation-errors { padding-left: 28px; }
  .orphan-banner { border-color: #b27a18; color: #5f4300; background: #fff8e5; }
  .orphan-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; margin-top: 8px; }
  .orphan-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orphan-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .orphan-file-picker { display: grid; flex-basis: 100%; max-height: 140px; gap: 3px; overflow-y: auto; padding: 6px; border: 1px solid color-mix(in srgb, var(--primary-color) 45%, transparent); border-radius: 6px; background: #fff; }
  .mod-list { flex: 1 1 auto; min-height: 0; height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 2px 4px 2px 2px; }
  .groups-list, .files-list { display: grid; gap: 10px; }
  .group-row, .file-row { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; background: var(--background-color, #fff); }
  .group-row { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color)); background: color-mix(in srgb, var(--primary-color) 5%, transparent); }
  .group-row.pending-removal { border-color: #b27a18; background: #fffaf0; }
  .group-header { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
  .mod-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 7px; color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
  .group-heading { min-width: 0; display: grid; gap: 2px; }
  .group-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-heading span, .membership { color: var(--text-secondary-color, #6b7280); font-size: .8rem; }
  .group-fields { display: grid; grid-template-columns: minmax(130px, .7fr) minmax(160px, 1fr) minmax(200px, 1.5fr) minmax(180px, 1fr); gap: 10px; align-items: end; margin: 12px 0 8px 50px; }
  .group-fields label { min-width: 0; margin: 0; font-size: .76rem; font-weight: 600; color: var(--text-secondary-color, #6b7280); }
  .group-fields input:not([type='checkbox']) { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; min-width: 0; }
  .default-switch { display: flex; min-width: 0; align-items: center; gap: 6px; padding-bottom: 8px; }
  .default-switch span { min-width: 0; }
  .membership { display: grid; gap: 4px; list-style: none; padding: 0 0 0 50px; margin: 0; }
  .membership li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
  .membership li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-membership { font-style: italic; }
  .deletion-note { display: grid; gap: 3px; margin: 10px 0 0 50px; padding: 8px 10px; border-left: 3px solid #b27a18; color: #7a4b00; }
  .deletion-note p, .deletion-note span { margin: 0; font-size: .82rem; }
  .file-row { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 12px; align-items: center; }
  .file-row.optional-file { border-color: color-mix(in srgb, var(--primary-color) 35%, var(--border-color)); }
  .file-main { display: grid; min-width: 0; gap: 4px; }
  .file-name, .assigned-group { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-name { color: var(--text-secondary-color, #6b7280); }
  .assigned-group { color: var(--primary-color); font-size: .78rem; }
  .file-controls { display: grid; grid-template-columns: minmax(0, 1fr) 42px; align-items: center; justify-items: end; gap: 6px; }
  .file-controls .link-button { justify-self: start; }
  .picker-slot { grid-column: 1 / -1; min-width: 0; }
  .link-button { border: 0; background: none; color: var(--primary-color); cursor: pointer; padding: 3px 0; white-space: nowrap; }
  .link-button:disabled { opacity: .5; cursor: not-allowed; }
  .inline-action { display: inline-block; margin: 0 0 0 10px; }
  .conflict-details { margin-top: 8px; }
  .conflict-details ul, .conflict-details p { margin: 4px 0 0; }
  .empty { display: grid; justify-items: center; gap: 8px; padding: 45px 20px; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-secondary-color, #6b7280); }
  .search-empty { flex: 1 1 auto; align-content: center; }
  .empty i { font-size: 2rem; color: var(--primary-color); }
  .hint { margin: 12px 2px 0; color: var(--text-secondary-color, #6b7280); font-size: .82rem; }
  .actions { flex: none; margin-top: 14px; }

  @media (max-width: 1000px) {
    .modal-header { grid-template-columns: 1fr; }
    .header-tools { justify-content: space-between; }
    .search-box { width: min(420px, 60vw); }
    .group-fields { grid-template-columns: 1fr 1fr; margin-left: 0; }
    .membership { padding-left: 0; }
  }

  @media (max-width: 640px) {
    .header-tools { align-items: stretch; flex-direction: column; }
    .search-box { width: 100%; }
    .count { align-self: flex-start; }
    .group-header { grid-template-columns: 34px minmax(0, 1fr); }
    .group-header button { grid-column: 2; justify-self: start; }
    .group-fields { grid-template-columns: 1fr; }
    .membership li, .orphan-row { align-items: flex-start; grid-template-columns: 1fr; flex-direction: column; }
    .orphan-actions { justify-content: flex-start; }
    .file-row { grid-template-columns: 1fr; }
    .file-controls { grid-template-columns: minmax(0, 1fr) 42px; }
  }
</style>
