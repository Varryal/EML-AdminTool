<script lang="ts">
  import type { File as File_, OptionalModMetadata } from '$lib/utils/types'
  import type { Profile } from '@prisma/client'
  import ModalTemplate from './__ModalTemplate.svelte'
  import { enhance } from '$app/forms'
  import type { SubmitFunction } from '@sveltejs/kit'
  import { addNotification } from '$lib/stores/notifications'
  import { l } from '$lib/stores/language'

  interface Props { show: boolean; selectedProfile: Profile; files: File_[] }
  let { show = $bindable(), selectedProfile, files }: Props = $props()
  let mods = $state(files.filter((file) => file.type === 'MOD'))
  let searchQuery = $state('')
  let metadata = $state<Record<string, OptionalModMetadata>>(
    Object.fromEntries(mods.map((file) => [`${file.path}${file.name}`, {
      optional: file.optional ?? false,
      optionalId: file.optionalId ?? file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      title: file.title ?? file.name,
      description: file.description ?? '',
      enabledByDefault: file.enabledByDefault ?? false
    }]))
  )

  const enabledCount = $derived(Object.values(metadata).filter((value) => value.optional).length)
  const filteredMods = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return mods

    return mods.filter((file) => {
      const value = metadata[`${file.path}${file.name}`]
      return [file.name, file.path, value?.title, value?.optionalId, value?.description]
        .some((candidate) => candidate?.toLowerCase().includes(query))
    })
  })

  const submit: SubmitFunction = ({ formData }) => {
    formData.set('profile-id', selectedProfile.id)
    formData.set('metadata', JSON.stringify(Object.fromEntries(Object.entries(metadata).filter(([, value]) => value.optional))))

    return async ({ result, update }) => {
      if (result.type === 'failure') {
        addNotification('ERROR', $l.notifications.INTERNAL_SERVER_ERROR)
      }

      await update({ reset: false, invalidateAll: result.type === 'success' })

      if (result.type === 'success') show = false
    }
  }
</script>

<ModalTemplate size="l" bind:show>
  <form class="mods-form" method="POST" action="?/saveOptionalMods" use:enhance={submit}>
    <header class="modal-header">
      <div class="title-block">
        <h2><i class="fa-solid fa-puzzle-piece"></i>&nbsp; Mods · {selectedProfile.name}</h2>
        <p>Choose which mods are optional for the launcher. Required mods stay enabled for everyone.</p>
      </div>
      <div class="header-tools">
        <label class="search-box">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input
            type="search"
            aria-label="Search mods"
            placeholder="Search mods..."
            bind:value={searchQuery}
            onkeydown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
        </label>
        <span class="count">
          {enabledCount} optional · {filteredMods.length === mods.length ? `${mods.length} total` : `${filteredMods.length}/${mods.length} shown`}
        </span>
      </div>
    </header>

    {#if mods.length === 0}
      <div class="empty"><i class="fa-solid fa-box-open"></i><strong>No mods found</strong><span>Upload MOD files to the <code>mods/</code> directory first.</span></div>
    {:else if filteredMods.length === 0}
      <div class="empty search-empty"><i class="fa-solid fa-magnifying-glass"></i><strong>No matching mods</strong><span>Try another search.</span></div>
    {:else}
      <div class="mod-list" role="list" aria-label="Mods">
        {#each filteredMods as file}
          {@const key = `${file.path}${file.name}`}
          {@const value = metadata[key]}
          <article class:optional={value.optional} class="mod-row" role="listitem">
            <div class="mod-icon"><i class="fa-solid fa-cube"></i></div>
            <div class="mod-main">
              <div class="mod-name" title={`${file.path}${file.name}`}>{value.title || file.name}</div>
              <div class="mod-file">{file.path}{file.name}</div>
            </div>
            <label class="switch optional-switch">
              <input type="checkbox" bind:checked={value.optional} />
              <span class="switch-ui"></span>
              <span>Optional</span>
            </label>
            <label class="switch default-switch" class:disabled={!value.optional}>
              <input type="checkbox" bind:checked={value.enabledByDefault} disabled={!value.optional} />
              <span class="switch-ui"></span>
              <span>Default</span>
            </label>

            {#if value.optional}
              <div class="mod-fields">
                <label>
                  ID
                  <input aria-label={`Mod ID for ${file.name}`} required pattern="[a-z0-9][a-z0-9._-]&#123;0,63&#125;" bind:value={value.optionalId} />
                </label>
                <label>
                  Description
                  <input aria-label={`Description for ${file.name}`} maxlength="500" placeholder="Short description" bind:value={value.description} />
                </label>
                <label>
                  Title
                  <input aria-label={`Title for ${file.name}`} required maxlength="120" bind:value={value.title} />
                </label>
              </div>
            {/if}
          </article>
        {/each}
      </div>
      <p class="hint"><i class="fa-solid fa-circle-info"></i> Optional mods appear in the launcher. “Default” means they are selected on a new profile.</p>
    {/if}

    <div class="actions">
      <button type="button" class="secondary" onclick={() => (show = false)}>{$l.common.cancel}</button>
      <button type="submit" class="primary" disabled={mods.length === 0}><i class="fa-solid fa-check"></i>&nbsp;{$l.common.save}</button>
    </div>
  </form>
</ModalTemplate>

<style lang="scss">
  @use '../../../static/scss/modals.scss';

  .mods-form { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .modal-header { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: start; margin-bottom: 18px; }
  .title-block { min-width: 0; }
  h2 { margin: 0 0 6px; }
  .modal-header p { margin: 0; color: var(--text-secondary-color, #6b7280); }
  .header-tools { display: flex; align-items: center; gap: 10px; }
  .search-box { position: relative; width: min(320px, 27vw); margin: 0; font-weight: 400; }
  .search-box i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); z-index: 1; color: var(--text-secondary-color, #6b7280); pointer-events: none; }
  .search-box input { width: 100%; box-sizing: border-box; margin: 0; padding-left: 34px; }
  .count { flex: none; padding: 7px 10px; border-radius: 999px; background: var(--secondary-color, #f1f3f5); color: var(--text-secondary-color, #6b7280); font-size: .85rem; white-space: nowrap; }
  .mod-list { flex: 1 1 auto; min-height: 0; height: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; overscroll-behavior: contain; overflow-anchor: none; scrollbar-gutter: stable; padding: 2px 4px 2px 2px; }
  .mod-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) 84px 84px; gap: 12px; align-items: center; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--background-color, #fff); transition: border-color .15s, background .15s; }
  .mod-row.optional { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color)); background: color-mix(in srgb, var(--primary-color) 5%, transparent); }
  .mod-icon { grid-column: 1; grid-row: 1; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 7px; color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
  .mod-main { grid-column: 2; grid-row: 1; min-width: 0; }
  .mod-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .mod-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary-color, #6b7280); font-size: .78rem; margin-top: 2px; }
  .mod-fields { grid-column: 2 / -1; grid-row: 2; display: grid; grid-template-columns: minmax(150px, .8fr) minmax(220px, 1.35fr) minmax(180px, 1.15fr); gap: 12px; align-items: end; margin-top: 2px; }
  .mod-row label { margin: 0; font-size: .76rem; font-weight: 600; color: var(--text-secondary-color, #6b7280); }
  .mod-fields input:not([type='checkbox']) { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; min-width: 0; }
  .switch { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; min-height: 42px; cursor: pointer; font-size: .73rem; }
  .optional-switch { grid-column: 3; grid-row: 1; }
  .default-switch { grid-column: 4; grid-row: 1; }
  .switch input { position: absolute; top: 0; left: 50%; width: 34px; height: 20px; margin: 0; transform: translateX(-50%); opacity: 0; cursor: pointer; z-index: 2; }
  .switch input:disabled { cursor: not-allowed; }
  .switch-ui { position: relative; width: 34px; height: 20px; border-radius: 999px; background: var(--border-color); transition: background .15s; }
  .switch-ui::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: white; transition: transform .15s; box-shadow: 0 1px 2px #0003; }
  .switch input:checked + .switch-ui { background: var(--primary-color); }
  .switch input:checked + .switch-ui::after { transform: translateX(14px); }
  .switch input:focus-visible + .switch-ui { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .switch.disabled { opacity: .42; cursor: not-allowed; }
  .actions { flex: none; margin-top: 14px; }
  .hint { margin: 12px 2px 0; color: var(--text-secondary-color, #6b7280); font-size: .82rem; }
  .empty { display: grid; justify-items: center; gap: 8px; padding: 45px 20px; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-secondary-color, #6b7280); }
  .search-empty { flex: 1 1 auto; align-content: center; }
  .empty i { font-size: 2rem; color: var(--primary-color); }
  .empty strong { color: inherit; }
  code { font-size: .9em; }

  @media (max-width: 1000px) {
    .modal-header { grid-template-columns: 1fr; }
    .header-tools { justify-content: space-between; }
    .search-box { width: min(420px, 60vw); }
  }

  @media (max-width: 850px) {
    .mod-row { grid-template-columns: 34px minmax(0, 1fr) 76px 76px; }
    .mod-fields { grid-column: 2 / -1; grid-template-columns: 1fr 1fr; }
    .mod-fields label:last-child { grid-column: 1 / -1; }
  }

  @media (max-width: 560px) {
    .header-tools { align-items: stretch; flex-direction: column; }
    .search-box { width: 100%; }
    .count { align-self: flex-start; }
    .mod-row { grid-template-columns: 34px minmax(0, 1fr) 70px; }
    .optional-switch { grid-column: 3; grid-row: 1; }
    .default-switch { grid-column: 3; grid-row: 2; }
    .mod-fields { grid-column: 2 / 3; grid-row: 2 / span 2; grid-template-columns: 1fr; }
    .mod-fields label:last-child { grid-column: auto; }
  }
</style>
