<script lang="ts">
  export interface GroupPickerOption {
    id: string
    title: string
    fileCount: string
  }

  interface Props {
    groups: GroupPickerOption[]
    currentGroupId?: string
    fileLabel: string
    groupPickerLabel: string
    searchLabel: string
    searchPlaceholder: string
    chooseExisting: string
    createNew: string
    noGroupMatches: string
    cancelLabel: string
    onselect?: (id: string) => void
    oncreate?: () => void
    oncancel?: () => void
  }

  let {
    groups,
    currentGroupId = '',
    fileLabel,
    groupPickerLabel,
    searchLabel,
    searchPlaceholder,
    chooseExisting,
    createNew,
    noGroupMatches,
    cancelLabel,
    onselect,
    oncreate,
    oncancel
  }: Props = $props()

  let searchQuery = $state('')
  const query = $derived(searchQuery.trim().toLowerCase())
  const filteredGroups = $derived(
    groups.filter((group) => !query || `${group.title} ${group.id}`.toLowerCase().includes(query))
  )

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      oncancel?.()
    }
  }

  function handleFocusout(event: FocusEvent): void {
    const current = event.currentTarget as HTMLElement
    const next = event.relatedTarget as Node | null
    if (next && current.contains(next)) return
    oncancel?.()
  }
</script>

<div class="group-picker" role="dialog" aria-modal="false" tabindex="-1" aria-label={`${groupPickerLabel}: ${fileLabel}`} onkeydown={handleKeydown} onfocusout={handleFocusout}>
  <div class="picker-heading">
    <strong>{groupPickerLabel}</strong>
    <span title={fileLabel}>{fileLabel}</span>
  </div>
  <label class="picker-search">
    <span class="sr-only">{searchLabel}</span>
    <input type="search" aria-label={searchLabel} placeholder={searchPlaceholder} bind:value={searchQuery} />
  </label>
  <div class="picker-options" role="list">
    {#if filteredGroups.length > 0}
      <p class="picker-section-label">{chooseExisting}</p>
      {#each filteredGroups as group (group.id)}
        <button type="button" class:active={group.id === currentGroupId} class="picker-option" onclick={() => onselect?.(group.id)}>
          <span class="option-copy"><strong>{group.title}</strong><small>{group.id} · {group.fileCount}</small></span>
          {#if group.id === currentGroupId}<i class="fa-solid fa-check" aria-hidden="true"></i>{/if}
        </button>
      {/each}
    {:else}
      <p class="picker-empty">{noGroupMatches}</p>
    {/if}
  </div>
  <div class="picker-actions">
    <button type="button" class="create-option" onclick={() => oncreate?.()}>{createNew}</button>
    <button type="button" class="link-button" onclick={() => oncancel?.()}>{cancelLabel}</button>
  </div>
</div>

<style lang="scss">
  .group-picker {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--primary-color);
    border-radius: 8px;
    background: var(--background-color, #fff);
    box-shadow: 0 5px 18px rgb(0 0 0 / 12%);

    &:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--primary-color) 30%, transparent);
      outline-offset: 2px;
    }
  }

  .picker-heading {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .picker-heading span,
  .option-copy small {
    overflow: hidden;
    color: var(--text-secondary-color, #6b7280);
    font-size: .78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-search input {
    width: 100%;
    box-sizing: border-box;
    margin: 0;
  }

  .picker-options {
    display: grid;
    max-height: 190px;
    gap: 4px;
    overflow-y: auto;
  }

  .picker-section-label {
    margin: 2px 0;
    color: var(--text-secondary-color, #6b7280);
    font-size: .75rem;
    font-weight: 700;
  }

  .picker-option {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: 8px;
    border: 1px solid transparent;
    background: transparent;
    text-align: left;

    &:hover,
    &:focus-visible,
    &.active {
      border-color: var(--primary-color);
      background: color-mix(in srgb, var(--primary-color) 8%, transparent);
    }
  }

  .option-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .picker-empty {
    margin: 4px 0;
    color: var(--text-secondary-color, #6b7280);
  }

  .picker-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .create-option,
  .link-button {
    margin: 0;
    padding: 6px 8px;
    border: 0;
    background: transparent;
    color: var(--primary-color);
    cursor: pointer;
    font-size: .82rem;
  }

  .create-option {
    font-weight: 700;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
