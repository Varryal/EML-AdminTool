<script lang="ts">
  import type { File as File_ } from '$lib/utils/types'
  import type { Profile } from '@prisma/client'
  import ModalTemplate from './__ModalTemplate.svelte'
  import { enhance } from '$app/forms'
  import type { SubmitFunction } from '@sveltejs/kit'
  import { addNotification } from '$lib/stores/notifications'
  import { l } from '$lib/stores/language'
  import { optionalModIdFromFilename, optionalModTitleFromFilename } from '$lib/utils/optional-mods-ui'

  interface GroupDraft {
    title: string
    description: string
    enabledByDefault: boolean
    files: string[]
  }

  interface DraftEntry {
    optional: boolean
    optionalId: string
    title: string
    description: string
    enabledByDefault: boolean
  }

  interface Props {
    show: boolean
    selectedProfile: Profile
    files: File_[]
    groups: Record<string, GroupDraft>
    revision: string
  }

  const OPTIONAL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

  function keyOf(file: File_): string {
    return `${file.path}${file.name}`
  }

  function copyGroup(group: GroupDraft): GroupDraft {
    return { ...group, files: [...group.files] }
  }

  function formatText(template: string, values: Record<string, string | number>): string {
    return template.replace(/{{(\w+)}}/g, (_, key) => values[key] === undefined ? `{${key}}` : String(values[key]))
  }

  let { show = $bindable(), selectedProfile, files, groups, revision }: Props = $props()
  const mods = files.filter((file) => file.type === 'MOD')
  const initialGroups: Record<string, GroupDraft> = Object.fromEntries(
    Object.entries(groups).map(([id, group]) => [id, copyGroup(group)])
  )
  const initialDrafts: Record<string, DraftEntry> = {}

  for (const file of mods) {
    const fileKey = keyOf(file)
    const sidecarGroup = Object.entries(initialGroups).find(([, group]) => group.files.includes(fileKey))
    const optionalId = file.optionalId ?? sidecarGroup?.[0] ?? optionalModIdFromFilename(file.name)
    if (file.optional === true && !initialGroups[optionalId]) {
      initialGroups[optionalId] = {
        title: file.title ?? optionalModTitleFromFilename(file.name),
        description: file.description ?? '',
        enabledByDefault: file.enabledByDefault ?? false,
        files: [fileKey]
      }
    }
    const group = initialGroups[optionalId]
    initialDrafts[fileKey] = {
      optional: file.optional === true,
      optionalId,
      title: group?.title ?? file.title ?? optionalModTitleFromFilename(file.name),
      description: group?.description ?? file.description ?? '',
      enabledByDefault: group?.enabledByDefault ?? file.enabledByDefault ?? false
    }
  }

  let groupDrafts = $state<Record<string, GroupDraft>>(initialGroups)
  let drafts = $state<Record<string, DraftEntry>>(initialDrafts)
  let searchQuery = $state('')
  let saving = $state(false)
  let saveError = $state('')
  let conflict = $state(false)
  let localError = $state('')
  let removeGroupIds = $state<string[]>([])
  let bindSelections = $state<Record<string, string>>({})

  function filesForGroup(id: string): File_[] {
    return mods.filter((file) => drafts[keyOf(file)]?.optional && drafts[keyOf(file)]?.optionalId === id)
  }

  const optionalGroups = $derived.by(() =>
    Object.entries(groupDrafts)
      .map(([id, group]) => ({ id, ...group, files: filesForGroup(id) }))
      .sort((a, b) => a.id.localeCompare(b.id))
  )
  const requiredMods = $derived(mods.filter((file) => !drafts[keyOf(file)]?.optional))
  const orphanGroups = $derived(optionalGroups.filter((group) => group.files.length === 0))
  const selectedCount = $derived(optionalGroups.filter((group) => group.files.length > 0).length)
  const query = $derived(searchQuery.trim().toLowerCase())
  const filteredGroups = $derived(
    optionalGroups.filter((group) => {
      if (!query) return true
      return [group.id, group.title, group.description, ...group.files.map(keyOf)].some((value) => value.toLowerCase().includes(query))
    })
  )
  const filteredRequiredMods = $derived(requiredMods.filter((file) => !query || keyOf(file).toLowerCase().includes(query)))
  const validationErrors = $derived.by(() => {
    const errors: string[] = []
    for (const group of optionalGroups) {
      if (!OPTIONAL_ID.test(group.id)) errors.push(formatText($l.dashboard.optionalMods.invalidGroupId, { id: group.id || '(empty)' }))
      if (!group.title.trim() || group.title.trim().length > 120) errors.push(formatText($l.dashboard.optionalMods.invalidTitle, { id: group.id || '(empty)' }))
      if (group.description.length > 500) errors.push(formatText($l.dashboard.optionalMods.descriptionTooLong, { id: group.id }))
    }
    return errors
  })

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value
  }

  function checkedValue(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked
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
        localError = formatText($l.dashboard.optionalMods.duplicateGroupId, { id: String(value) })
        return
      }
      if (!OPTIONAL_ID.test(value)) {
        localError = formatText($l.dashboard.optionalMods.invalidGroupId, { id: value || '(empty)' })
        return
      }
      const group = groupDrafts[id]
      delete groupDrafts[id]
      groupDrafts[value] = group
      for (const draft of Object.values(drafts)) {
        if (draft.optional && draft.optionalId === id) draft.optionalId = value
      }
      localError = ''
      return
    }

    const group = groupDrafts[id]
    if (!group) return
    group[field] = value as never
    for (const draft of Object.values(drafts)) {
      if (draft.optional && draft.optionalId === id) {
        if (field === 'title' || field === 'description' || field === 'enabledByDefault') draft[field] = value as never
      }
    }
    localError = ''
  }

  function bindFile(file: File_, id: string): void {
    const group = groupDrafts[id]
    if (!group) return
    drafts[keyOf(file)] = {
      optional: true,
      optionalId: id,
      title: group.title,
      description: group.description,
      enabledByDefault: group.enabledByDefault
    }
    localError = ''
  }

  function makeOptional(file: File_, selectedId: string): void {
    if (!selectedId) return
    if (selectedId === '__new__') {
      const id = uniqueId(optionalModIdFromFilename(file.name))
      groupDrafts[id] = { title: optionalModTitleFromFilename(file.name), description: '', enabledByDefault: false, files: [] }
      bindFile(file, id)
    } else {
      bindFile(file, selectedId)
    }
  }

  function selectedValue(event: Event): string {
    return (event.currentTarget as HTMLSelectElement).value
  }

  function bindOrphan(id: string): void {
    const fileKey = bindSelections[id]
    const file = requiredMods.find((candidate) => keyOf(candidate) === fileKey)
    if (!file) return
    bindFile(file, id)
    delete bindSelections[id]
  }

  function removeGroup(id: string): void {
    if (!window.confirm($l.dashboard.optionalMods.deleteGroupConfirm)) return
    removeGroupIds = [...new Set([...removeGroupIds, id])]
    delete groupDrafts[id]
    for (const draft of Object.values(drafts)) {
      if (draft.optionalId === id) draft.optional = false
    }
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

  const submit: SubmitFunction = ({ formData }) => {
    if (validationErrors.length > 0) return undefined
    saving = true
    saveError = ''
    conflict = false
    formData.set('profile-id', selectedProfile.id)
    formData.set('revision', revision)
    formData.set('remove-group-ids', JSON.stringify(removeGroupIds))
    formData.set(
      'metadata',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(drafts)
            .filter(([, value]) => value.optional)
            .map(([fileKey, value]) => [fileKey, {
              optional: true,
              optionalId: value.optionalId,
              title: value.title,
              description: value.description,
              enabledByDefault: value.enabledByDefault
            }])
        )
      )
    )

    return async ({ result, update }) => {
      if (result.type === 'failure') {
        const code = getFailureCode(result)
        saveError = failureMessage(code)
        conflict = code === 'OPTIONAL_MODS_CONFLICT'
        saving = false
        addNotification('ERROR', saveError)
        await update({ reset: false })
        return
      }

      await update({ reset: false, invalidateAll: true })
      saving = false
      show = false
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
        <span class="count">{formatText($l.dashboard.optionalMods.count, { selected: selectedCount, files: mods.length })}</span>
      </div>
    </header>

    {#if saveError}<div class:error-banner={conflict} class="error-banner" role="alert">{saveError}</div>{/if}
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
            <span><b>{group.title || $l.dashboard.optionalMods.unnamedGroup}</b> · {group.id}</span>
            <select aria-label={`${$l.dashboard.optionalMods.selectFile}: ${group.id}`} value={bindSelections[group.id] ?? ''} onchange={(event) => (bindSelections[group.id] = selectedValue(event))}>
              <option value="">{$l.dashboard.optionalMods.selectFile}</option>
              {#each requiredMods as file (keyOf(file))}<option value={keyOf(file)}>{keyOf(file)}</option>{/each}
            </select>
            <button type="button" class="secondary small" disabled={!bindSelections[group.id]} onclick={() => bindOrphan(group.id)}>{$l.dashboard.optionalMods.bindFile}</button>
            <button type="button" class="danger small" onclick={() => removeGroup(group.id)}>{$l.dashboard.optionalMods.deleteGroup}</button>
          </div>
        {/each}
      </section>
    {/if}

    {#if mods.length === 0}
      <div class="empty"><i class="fa-solid fa-box-open"></i><strong>{$l.dashboard.optionalMods.noMods}</strong><span>{$l.dashboard.optionalMods.uploadHint}</span></div>
    {:else if filteredGroups.length === 0 && filteredRequiredMods.length === 0}
      <div class="empty search-empty"><i class="fa-solid fa-magnifying-glass"></i><strong>{$l.dashboard.optionalMods.noMatches}</strong><span>{$l.dashboard.optionalMods.tryAnotherSearch}</span></div>
    {:else}
      <div class="mod-list" role="list" aria-label={`${$l.dashboard.optionalMods.title}: ${selectedProfile.name}`}>
        {#each filteredGroups as group (group.id)}
          <article class="group-row" role="listitem">
            <div class="group-header">
              <div class="mod-icon"><i class="fa-solid fa-cubes"></i></div>
              <div class="group-heading"><strong>{group.title || $l.dashboard.optionalMods.unnamedGroup}</strong><span>{group.files.length === 1 ? $l.dashboard.optionalMods.fileCountOne : formatText($l.dashboard.optionalMods.fileCountMany, { count: group.files.length })} · {group.id}</span></div>
              <button type="button" class="secondary small" onclick={() => removeGroup(group.id)}>{$l.dashboard.optionalMods.removeGroup}</button>
            </div>
            <div class="group-fields">
              <label>{$l.dashboard.optionalMods.groupId}<input aria-label={`${$l.dashboard.optionalMods.groupId}: ${group.id}`} value={group.id} oninput={(event) => updateGroup(group.id, 'optionalId', inputValue(event))} /></label>
              <label>{$l.dashboard.optionalMods.groupTitle}<input aria-label={`${$l.dashboard.optionalMods.groupTitle}: ${group.id}`} value={group.title} maxlength="120" oninput={(event) => updateGroup(group.id, 'title', inputValue(event))} /></label>
              <label>{$l.dashboard.optionalMods.groupDescription}<input aria-label={`${$l.dashboard.optionalMods.groupDescription}: ${group.id}`} value={group.description} maxlength="500" oninput={(event) => updateGroup(group.id, 'description', inputValue(event))} /></label>
              <label class="default-check"><input type="checkbox" aria-label={`${$l.dashboard.optionalMods.enabledByDefault}: ${group.id}`} checked={group.enabledByDefault} onchange={(event) => updateGroup(group.id, 'enabledByDefault', checkedValue(event))} /> {$l.dashboard.optionalMods.enabledByDefault}</label>
            </div>
            <ul class="membership" aria-label={`${$l.dashboard.optionalMods.groupTitle}: ${group.id}`}>
              {#each group.files as file (keyOf(file))}<li><span>{keyOf(file)}</span><button type="button" class="link-button" onclick={() => (drafts[keyOf(file)].optional = false)}>{$l.dashboard.optionalMods.removeFile}</button></li>{/each}
            </ul>
          </article>
        {/each}

        {#each filteredRequiredMods as file (keyOf(file))}
          <article class="file-row" role="listitem">
            <span><i class="fa-solid fa-cube" aria-hidden="true"></i> {keyOf(file)}</span>
            <label class="bind-select"><span class="sr-only">{$l.dashboard.optionalMods.makeOptional}: {keyOf(file)}</span><select value="" onchange={(event) => makeOptional(file, selectedValue(event))}>
              <option value="">{$l.dashboard.optionalMods.required}</option>
              {#each optionalGroups as group (group.id)}<option value={group.id}>{$l.dashboard.optionalMods.chooseExisting}: {group.title} ({group.id})</option>{/each}
              <option value="__new__">{$l.dashboard.optionalMods.createNew}</option>
            </select></label>
          </article>
        {/each}
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
  .orphan-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(170px, 1fr) auto auto; gap: 8px; align-items: center; margin-top: 8px; }
  .orphan-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mod-list { flex: 1 1 auto; min-height: 0; height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 2px 4px 2px 2px; }
  .group-row, .file-row { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; background: var(--background-color, #fff); }
  .group-row { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color)); background: color-mix(in srgb, var(--primary-color) 5%, transparent); }
  .group-header { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
  .mod-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 7px; color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
  .group-heading { min-width: 0; display: grid; gap: 2px; }
  .group-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-heading span, .membership { color: var(--text-secondary-color, #6b7280); font-size: .8rem; }
  .group-fields { display: grid; grid-template-columns: minmax(130px, .7fr) minmax(160px, 1fr) minmax(200px, 1.5fr) auto; gap: 10px; align-items: end; margin: 12px 0 8px 50px; }
  .group-fields label { margin: 0; font-size: .76rem; font-weight: 600; color: var(--text-secondary-color, #6b7280); }
  .group-fields input:not([type='checkbox']) { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; min-width: 0; }
  .default-check { display: flex; align-items: center; gap: 6px; white-space: normal; padding-bottom: 8px; }
  .membership { display: grid; gap: 4px; list-style: none; padding: 0 0 0 50px; margin: 0; }
  .membership li, .file-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .membership li span, .file-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-row { color: var(--text-secondary-color, #6b7280); }
  .bind-select select { margin: 0; min-width: 220px; }
  .link-button { border: 0; background: none; color: var(--primary-color); cursor: pointer; padding: 3px 0; white-space: nowrap; }
  .empty { display: grid; justify-items: center; gap: 8px; padding: 45px 20px; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-secondary-color, #6b7280); }
  .search-empty { flex: 1 1 auto; align-content: center; }
  .empty i { font-size: 2rem; color: var(--primary-color); }
  .hint { margin: 12px 2px 0; color: var(--text-secondary-color, #6b7280); font-size: .82rem; }
  .actions { flex: none; margin-top: 14px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  code { font-size: .9em; }

  @media (max-width: 1000px) {
    .modal-header { grid-template-columns: 1fr; }
    .header-tools { justify-content: space-between; }
    .search-box { width: min(420px, 60vw); }
    .group-fields { grid-template-columns: 1fr 1fr; margin-left: 0; }
    .membership { padding-left: 0; }
    .orphan-row { grid-template-columns: 1fr 1fr; }
  }

  @media (max-width: 560px) {
    .header-tools { align-items: stretch; flex-direction: column; }
    .search-box { width: 100%; }
    .count { align-self: flex-start; }
    .group-header { grid-template-columns: 34px minmax(0, 1fr); }
    .group-header button { grid-column: 2; justify-self: start; }
    .group-fields { grid-template-columns: 1fr; }
    .membership li, .file-row, .orphan-row { align-items: flex-start; flex-direction: column; }
    .bind-select, .bind-select select { width: 100%; }
  }
</style>
