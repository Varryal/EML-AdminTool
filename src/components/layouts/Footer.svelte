<script lang="ts">
  import type { Env } from '$lib/utils/types'
  import { formatVersionLabel } from '$lib/utils/version'
  import { getContext } from 'svelte'

  const env = getContext<Env>('env')
</script>

<footer>
  <hr />
  <p>
    <span class="version" aria-label={formatVersionLabel(env)}>
      EML AdminTool {env.varryalVersion} ·
      <span class="channel" class:preprod={env.channel === 'preprod'} class:prod={env.channel === 'prod'}>{env.channel.toUpperCase()}</span>
      {#if env.channel === 'preprod'}
        · {env.buildId}
      {/if}
    </span>
    <br />
    <span class="links">
      <a href="https://emlproject.com/discord/other" target="_blank">Discord</a> –
      <a href="https://emlproject.com/docs" target="_blank">Docs</a> –
      <a href="https://github.com/Electron-Minecraft-Launcher/EML-AdminTool" target="_blank">GitHub</a> –
      <a href="https://github.com/Electron-Minecraft-Launcher/EML-AdminTool/issues/new?template=bug.md" target="_blank"><i class="fa-solid fa-bug"></i>&nbsp;Report a bug</a>
    </span>
  </p>
</footer>

<style lang="scss">
  footer {
    width: calc(100% - 200px);
    text-align: center;
    margin-top: 75px;
    padding-bottom: 30px;
    position: absolute;
    bottom: -107px;
    z-index: 0;
  }

  p {
    font-size: 13px;
    line-height: 1.4;
    opacity: 0.8;
  }

  .channel {
    font-weight: 700;
  }

  .channel.preprod {
    color: #e67e22;
  }

  .channel.prod {
    color: #2e9b50;
  }

  hr {
    background-color: #d8d8d8;
    height: 1px;
    border-width: 0px;
    margin-bottom: 30px;
  }

  i.fa-solid.fa-bug {
    font-size: 12px;
  }
</style>
