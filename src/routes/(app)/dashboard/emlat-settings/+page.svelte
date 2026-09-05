<script lang="ts">
  import type { PageProps } from './$types'
  import { fade } from 'svelte/transition'
  import getEnv from '$lib/utils/env'
  import { addNotification } from '$lib/stores/notifications'
  import { l } from '$lib/stores/language'
  import LoadingSplash from '../../../../components/layouts/LoadingSplash.svelte'
  import { IUserStatus } from '$lib/utils/db'
  import UserManagement from '../../../../components/contents/UserManagement.svelte'
  import EditEMLAdminToolModal from '../../../../components/modals/EditEMLAdminToolModal.svelte'
  import { waitForServerRestart } from '$lib/utils/utils'
  import { callAction } from '$lib/utils/call'
  import Markdown from '../../../../components/layouts/Markdown.svelte'
  import UninstallModal from '../../../../components/modals/UninstallModal.svelte'

  let { data = $bindable() }: PageProps = $props()

  const env = getEnv()

  let showLoader = $state(false)
  let showEditAdminToolModal = $state(false)
  let showUninstallModal = $state(false)

  let selectedUserId = $state(data.users[0].id)
  let updateMessage: string = $state('')

  function editAdminToolModal() {
    showEditAdminToolModal = true
  }

  async function reset() {
    if (!confirm($l.dashboard.emlatSettings.dangerZone.resetEMLATWarning)) return
    if (!confirm($l.dashboard.emlatSettings.dangerZone.areYouSure)) return

    updateMessage = 'Resetting...'
    showLoader = true

    try {
      await callAction({ url: '/dashboard/emlat-settings', action: 'resetEMLAT', formData: new FormData() }, $l)
      await waitForServerRestart(10)
    } catch (err) {
      console.error('Failed to reset:', err)
      addNotification('ERROR', $l.notifications.EMLAT_RESET_FAILED)
      showLoader = false
      document.body.style.overflow = 'auto'
      return
    }
  }
</script>

<svelte:head>
  <title>{$l.dashboard.emlatSettings.title} • {env.name} AdminTool</title>
</svelte:head>

{#if showLoader}
  <div class="splash" transition:fade>
    <div>
      <LoadingSplash />
    </div>
    {#if updateMessage}
      <p transition:fade>{updateMessage}</p>
    {/if}
  </div>
{/if}

{#if showEditAdminToolModal}
  <EditEMLAdminToolModal bind:show={showEditAdminToolModal} />
{/if}

{#if showUninstallModal}
  <UninstallModal bind:show={showUninstallModal} />
{/if}

<h2>{$l.dashboard.emlatSettings.title}</h2>

<section class="section">
  <button class="secondary right" onclick={editAdminToolModal} aria-label="Edit EML AdminTool"><i class="fa-solid fa-pen"></i></button>
  <h3>{$l.dashboard.emlatSettings.info.title}</h3>

  <div class="container">
    <div>
      <p class="label">{$l.dashboard.emlatSettings.info.atName}</p>
      <p>{data.environment.name}</p>
    </div>

    <div>
      <p class="label">{$l.dashboard.emlatSettings.info.language}</p>
      <p>{$l.language}</p>
    </div>

    <div>
      <p class="label">{$l.dashboard.emlatSettings.info.pin}</p>
      <p><span class="pin">{data.environment.pin}</span></p>
    </div>

    <div>
      <p class="label">{$l.dashboard.emlatSettings.info.nbUsers}</p>
      <p>{data.users.length}</p>
    </div>
  </div>
</section>

<section class="section">
  <h3>{$l.dashboard.emlatSettings.userManagement.title}</h3>

  <div class="list-container">
    <div class="list">
      <p class="label">{$l.dashboard.emlatSettings.userManagement.users}</p>
      {#each data.users as u}
        {#if u.status === IUserStatus.ACTIVE}
          <button class="list" class:active={selectedUserId === u.id} onclick={() => (selectedUserId = u.id)}>
            {u.username}
          </button>
        {/if}
      {/each}

      <p class="label">{$l.dashboard.emlatSettings.userManagement.pendingUsers}</p>
      {#each data.users as u}
        {#if u.status === IUserStatus.PENDING}
          <button class="list" class:active={selectedUserId === u.id} onclick={() => (selectedUserId = u.id)}>
            {u.username}
          </button>
        {/if}
      {/each}

      <p class="label">{$l.dashboard.emlatSettings.userManagement.wrongPinUsers}</p>
      {#each data.users as u}
        {#if u.status === IUserStatus.SPAM}
          <button class="list" class:active={selectedUserId === u.id} onclick={() => (selectedUserId = u.id)}>
            {u.username}
          </button>
        {/if}
      {/each}

      <p class="label">{$l.dashboard.emlatSettings.userManagement.deletedUsers}</p>
      {#each data.users as u}
        {#if u.status === IUserStatus.DELETED}
          <button class="list" class:active={selectedUserId === u.id} onclick={() => (selectedUserId = u.id)}>
            {u.username}
          </button>
        {/if}
      {/each}
    </div>

    <div class="content-list">
      <UserManagement bind:selectedUserId {data} />
    </div>
  </div>
</section>

<section class="section">
  <h3>{$l.dashboard.emlatSettings.update.title}</h3>

  <div class="container">
    <div>
      <p class="label">{$l.dashboard.emlatSettings.update.currentVersion}</p>
      <p>Varryal EML AdminTool {data.update.currentVersion}</p>
    </div>

    <div>
      <p class="label">Upstream base</p>
      <p>EML AdminTool {data.update.upstreamVersion}</p>
    </div>

    <div>
      <p class="label">{$l.dashboard.emlatSettings.update.latestVersion}</p>
      <p>EML AdminTool {data.update.latestVersion}</p>
    </div>
  </div>

  <div class="fork-update-note">
    <p><i class="fa-solid fa-shield-halved"></i></p>
    <p>
      <b>Controlled updates are enabled for the Varryal fork.</b><br />
      Direct upstream self-updates are disabled so Varryal-specific changes cannot be overwritten. Upstream releases are reviewed, merged and tested before deployment.
    </p>
  </div>

  {#if data.update.upstreamUpdateAvailable}
    <div class="updater">
      <div style="line-height: 1;">
        <img src={data.update.logoUrl} alt="Version logo" />
      </div>
      <div>
        <p class="release-name"><b>Upstream EML AdminTool {data.update.latestVersion} is available</b></p>
        <p class="release-date">
          {$l({ date: new Date(data.update.releaseDate).toLocaleDateString() }).dashboard.emlatSettings.update.releasedOn}
          –
          <a href="https://github.com/Electron-Minecraft-Launcher/EML-AdminTool/releases/tag/v{data.update.latestVersion}" target="_blank">
            {$l.dashboard.emlatSettings.update.openGithub}&nbsp;&nbsp;<i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 12px"></i>
          </a>
        </p>
      </div>
    </div>
    <div class="changelogs">
      <div class="changelogs-in">
        <Markdown source={data.update.changelogs} />
      </div>
    </div>
  {/if}
</section>

<section class="section">
  <h3>{$l.dashboard.emlatSettings.vpsAndDockerInfo.title}</h3>

  <div class="container">
    <div>
      <p class="label">{$l.dashboard.emlatSettings.vpsAndDockerInfo.dockerInfo}</p>
      <p>{data.vps.os}</p>
    </div>

    <div>
      <p class="label">{$l.dashboard.emlatSettings.vpsAndDockerInfo.storage}</p>
      <span class="storage">
        <span class="storage-progress" style={'width: ' + (data.vps.storage[0] / data.vps.storage[1]) * 200 + 'px'}></span>
      </span>
      {Math.round((data.vps.storage[0] / data.vps.storage[1]) * 100)}%
    </div>
  </div>
</section>

<section class="section">
  <h3>{$l.dashboard.emlatSettings.dangerZone.title}</h3>

  <div class="container">
    <div>
      <button class="primary danger" onclick={reset}>{$l.dashboard.emlatSettings.dangerZone.reset}</button>
    </div>
    <div>
      <button class="secondary danger" onclick={() => (showUninstallModal = true)}>{$l.dashboard.emlatSettings.dangerZone.uninstall}</button>
    </div>
  </div>
</section>

<style lang="scss">
  @use '../../../../../static/scss/dashboard.scss';
  @use '../../../../../static/scss/list.scss';

  div.splash {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    background-color: white;

    div {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: calc(100% - 100px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      background-color: white;
    }

    p {
      padding-top: 20px;
      z-index: 1100;
    }
  }

  span.pin {
    filter: blur(5px);
    transition: filter 0.3s;

    &:hover {
      filter: blur(0px);
    }
  }

  div.fork-update-note {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    margin-top: 30px;
    padding: 16px 18px;
    border: 1px solid var(--border-color2);
    border-radius: 5px;

    p {
      margin: 0;

      i {
        margin-top: 2px;
        font-size: 20px;
        color: var(--primary-color);
      }
    }
  }

  i.fa-solid.fa-star {
    cursor: help;
    font-size: 10px;
    color: #5f5f5f;
  }

  div.updater {
    width: 100%;
    margin-top: 30px;
    display: flex;
    align-items: center;
    gap: 20px;

    p.release-name {
      font-size: 17px;
      margin-bottom: 3px;
    }

    p.release-date {
      font-size: 14px;
      color: var(--text-dark-color);
    }

    img {
      width: 55px;
      height: 55px;
      border-radius: 50%;
      corner-shape: squircle;

      @supports not (corner-shape: squircle) {
        border-radius: 13px;
      }
    }
  }

  div.changelogs {
    margin-top: 20px;
    padding: 20px;
    border-radius: 5px;
    background: rgb(253, 253, 253);
    border: 1px solid rgb(240, 240, 240);
    height: 400px;
    overflow-y: auto;

    div.changelogs-in {
      max-width: 900px;
      margin: 0 auto;
    }
  }

  span.storage {
    display: inline-block;
    width: 200px;
    height: 1px;
    margin-bottom: 5px;
    background: var(--border-color2);
    position: relative;
    margin-right: 10px;

    span.storage-progress {
      display: block;
      position: relative;
      height: 3px;
      top: -1px;
      background: var(--primary-color);
      border-radius: 3px;
    }
  }
</style>