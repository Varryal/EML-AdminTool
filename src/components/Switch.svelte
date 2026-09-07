<script lang="ts">
  import { switchValueForKey } from '$lib/utils/optional-mods-ui'

  interface Props {
    checked?: boolean
    disabled?: boolean
    label: string
    describedBy?: string
    onchange?: (checked: boolean) => void
  }

  let { checked = false, disabled = false, label, describedBy, onchange }: Props = $props()

  function toggle(): void {
    if (disabled) return
    onchange?.(!checked)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (disabled) return
    const next = switchValueForKey(checked, event.key)
    if (next === undefined) return
    event.preventDefault()
    onchange?.(next)
  }
</script>

<button
  class="switch"
  class:checked
  class:disabled
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  aria-describedby={describedBy}
  {disabled}
  onclick={toggle}
  onkeydown={handleKeydown}
>
  <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
</button>

<style lang="scss">
  .switch {
    display: inline-flex;
    width: 42px;
    height: 24px;
    flex: 0 0 42px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
    transition: outline-color 0.18s ease;

    &:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--primary-color) 35%, transparent);
      outline-offset: 3px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
  }

  .switch-track {
    display: flex;
    width: 36px;
    height: 20px;
    align-items: center;
    padding: 2px;
    border-radius: 999px;
    background: var(--border-color, #b8bec7);
    transition: background-color 0.18s ease;
  }

  .switch-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
    transform: translateX(0);
    transition: transform 0.18s ease;
  }

  .switch.checked .switch-track {
    background: var(--primary-color);
  }

  .switch.checked .switch-thumb {
    transform: translateX(16px);
  }

  @media (prefers-reduced-motion: reduce) {
    .switch,
    .switch-track,
    .switch-thumb {
      transition: none;
    }
  }
</style>
