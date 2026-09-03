<script lang="ts">
  import type { File as File_, OptionalModMetadata } from '$lib/utils/types'
  import type { Profile } from '@prisma/client'
  import ModalTemplate from './__ModalTemplate.svelte'
  import { enhance, applyAction } from '$app/forms'
  import type { SubmitFunction } from '@sveltejs/kit'
  import { addNotification } from '$lib/stores/notifications'
  import { l } from '$lib/stores/language'

  interface Props { show: boolean; selectedProfile: Profile; files: File_[] }
  let { show = $bindable(), selectedProfile, files }: Props = $props()
  let mods = $state(files.filter((file) => file.type === 'MOD'))
  let metadata = $state<Record<string, OptionalModMetadata>>(
    Object.fromEntries(mods.map((file) => [`${file.path}${file.name}`, {
      optional: file.optional ?? false,
      optionalId: file.optionalId ?? file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      title: file.title ?? file.name,
      description: file.description ?? '',
      enabledByDefault: file.enabledByDefault ?? false
    }]))
  )

  const submit: SubmitFunction = ({ formData }) => {
    formData.set('profile-id', selectedProfile.id)
    formData.set('metadata', JSON.stringify(Object.fromEntries(Object.entries(metadata).filter(([, value]) => value.optional))))
    return async ({ result }) => {
      if (result.type === 'success') show = false
      else addNotification('ERROR', $l.notifications.INTERNAL_SERVER_ERROR)
      await applyAction(result)
    }
  }
</script>

<ModalTemplate size="l" bind:show>
  <form method="POST" action="?/saveOptionalMods" use:enhance={submit}>
    <h2>Optional mods · {selectedProfile.name}</h2>
    <p>Mark client mods as optional. They will be shown in the launcher and downloaded only when selected.</p>
    {#if mods.length === 0}<p>No files in a mods directory.</p>{/if}
    {#each mods as file}
      {@const key = `${file.path}${file.name}`}
      {@const value = metadata[key]}
      <fieldset>
        <legend>{file.path}{file.name}</legend>
        <label class="check"><input type="checkbox" bind:checked={value.optional} /> Optional in launcher</label>
        {#if value.optional}
        <label>Mod ID<input required pattern="[a-z0-9][a-z0-9._-]&#123;0,63&#125;" bind:value={value.optionalId} /></label>
        <label>Title<input required maxlength="120" bind:value={value.title} /></label>
        <label>Description<textarea maxlength="500" bind:value={value.description}></textarea></label>
        <label class="check"><input type="checkbox" bind:checked={value.enabledByDefault} /> Enabled by default</label>
        {/if}
      </fieldset>
    {/each}
    <div class="actions"><button type="button" class="secondary" onclick={() => (show = false)}>{$l.common.cancel}</button><button class="primary">{$l.common.save}</button></div>
  </form>
</ModalTemplate>

<style lang="scss">
  @use '../../../static/scss/modals.scss';
  fieldset { border: 1px solid var(--border-color); border-radius: 5px; margin: 15px 0; padding: 12px; }
  legend { font-weight: 600; }
  label { display: block; margin: 8px 0; }
  input:not([type='checkbox']), textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; }
  textarea { min-height: 55px; resize: vertical; }
  .check { display: flex; gap: 8px; align-items: center; }
</style>
