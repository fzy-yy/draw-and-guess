<!-- 在线大厅：只展示公开房间；私密房间通过服务端生成的短码加入。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronRight,
  CirclePlus,
  Gamepad2,
  KeyRound,
  Settings,
  Users,
  Wifi,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import {
  AppButton,
  AvatarImage,
  NetworkStatusButton,
  SearchInput,
  SectionHeader,
  StageHeader,
} from '@/components/common'
import { CreateRoomDialog, JoinPrivateDialog } from '@/components/lobby'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
const showCreate = ref(false)
const showJoinPrivate = ref(false)
const playerFilter = ref('')

const filteredPlayers = computed(() =>
  store.presence.players.filter(
    (player) => player.id !== store.playerId && player.nickname.includes(playerFilter.value.trim()),
  ),
)

const statusText = {
  idle: strings.status.playerIdle,
  in_room: strings.status.playerInRoom,
  playing: strings.status.playerPlaying,
  reconnecting: strings.status.playerReconnecting,
} as const
</script>

<template>
  <main class="grid h-full grid-cols-[minmax(0,1fr)_28%] grid-rows-[11%_89%] bg-sky">
    <StageHeader>
      <template #leading>
        <AvatarImage
          :avatar-id="store.profile.avatarId"
          :label="strings.common.myAvatarAria"
          class="h-[6cqh] w-[6cqh] border-sky"
        />
        <strong class="truncate">{{ store.profile.nickname }}</strong>
      </template>
      <template #center>
        <div class="flex items-center gap-[0.6em]">
          <Gamepad2 class="h-[4.2cqh] w-[4.2cqh] text-yellow" />
          <div class="flex flex-col leading-[1.05]">
            <b class="text-fs-18">{{ store.config.app.name }}</b>
            <span class="text-sky text-fs-10 tracking-[0.18em]">{{
              strings.lobby.lobbyEnglishTitle
            }}</span>
          </div>
        </div>
      </template>
      <template #trailing>
        <nav class="flex items-center gap-[0.7em]" :aria-label="strings.lobby.navAria">
          <NetworkStatusButton />
          <button
            type="button"
            class="flex items-center gap-[0.4em] rounded-[0.55em] bg-white/5 px-[0.8em] py-[0.8cqh] text-sky hover:bg-white/10 transition-colors"
            @click="store.page = 'settings'"
          >
            <Settings /> {{ strings.lobby.settingsEntry }}
          </button>
        </nav>
      </template>
    </StageHeader>

    <section class="min-w-0 border-r-[0.2cqh] border-line px-[2cqw] py-[3cqh]">
      <div class="flex items-end justify-between">
        <SectionHeader :eyebrow="strings.lobby.roomsLabel" :title="strings.lobby.roomsTitle" />
        <span class="text-muted text-fs-14">{{
          strings.lobby.roomCount(store.presence.rooms.length)
        }}</span>
      </div>

      <!-- 入口快捷卡片 -->
      <div class="my-[2cqh] grid grid-cols-2 gap-[1.3cqw]">
        <!--
          入口快捷卡片：蓝/藏青实色底，悬浮只做「同色稍变深」反馈——
          依赖 base.css 的全局按钮 hover brightness(0.95)，不用 hover-tint
          （hover-tint 的 bg-line 会把实色底整体替换成灰色，曾因此被标注为配色错误）。
        -->
        <button
          type="button"
          class="flex h-[12cqh] items-center gap-[1em] rounded-[0.9em] bg-blue px-[1.4em] text-left text-white ui-feedback"
          @click="showCreate = true"
        >
          <CirclePlus class="first:h-[4.5cqh] first:w-[4.5cqh] first:text-yellow" />
          <span class="flex flex-col">
            <b class="text-fs-18">{{ strings.lobby.createRoomTitle }}</b>
            <small class="mt-[0.35cqh] text-sky">{{ strings.lobby.createRoomHint }}</small>
          </span>
          <ChevronRight class="last:ml-auto" />
        </button>

        <button
          type="button"
          class="flex h-[12cqh] items-center gap-[1em] rounded-[0.9em] bg-navy px-[1.4em] text-left text-white ui-feedback"
          @click="showJoinPrivate = true"
        >
          <KeyRound class="first:h-[4.5cqh] first:w-[4.5cqh] first:text-yellow" />
          <span class="flex flex-col">
            <b class="text-fs-18">{{ strings.lobby.joinPrivateTitle }}</b>
            <small class="mt-[0.35cqh] text-sky">{{ strings.lobby.joinPrivateHint }}</small>
          </span>
          <ChevronRight class="last:ml-auto" />
        </button>
      </div>

      <div
        class="flex h-[49cqh] flex-col gap-[0.85cqh] overflow-y-auto overscroll-contain"
        :aria-label="strings.lobby.roomListAria"
      >
        <article
          v-for="publicRoom in store.presence.rooms"
          :key="publicRoom.id"
          class="grid min-h-[7.8cqh] grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-[0.9em] border-[0.16cqh] border-l-[0.45cqh] border-line border-l-blue bg-white px-[0.9em] py-[0.6cqh] ui-feedback hover:border-t-sky hover:border-r-sky hover:border-b-sky hover-tint"
        >
          <div class="grid h-[5cqh] w-[5cqh] place-items-center rounded-[0.6em] bg-sky text-blue">
            <Gamepad2 />
          </div>
          <div class="flex min-w-0 flex-col">
            <b class="truncate">{{ publicRoom.name }}</b>
            <span class="text-muted text-fs-12">{{
              strings.lobby.roomMeta(
                publicRoom.hostName,
                publicRoom.roundsPerPlayer,
                publicRoom.drawSeconds,
              )
            }}</span>
          </div>
          <span class="text-muted text-fs-12">{{
            strings.status[
              publicRoom.phase === 'waiting'
                ? 'roomWaiting'
                : publicRoom.joinPolicy === 'spectate'
                  ? 'roomSpectatable'
                  : 'roomInProgress'
            ]
          }}</span>
          <span class="flex items-center gap-[0.35em] font-bold">
            <Users /> {{ publicRoom.playerCount }}/{{ publicRoom.maxPlayers }}
          </span>
          <AppButton
            type="button"
            :disabled="
              publicRoom.playerCount >= publicRoom.maxPlayers ||
              (publicRoom.phase !== 'waiting' && publicRoom.joinPolicy !== 'spectate')
            "
            @click="store.joinRoom(publicRoom.id)"
          >
            {{
              publicRoom.phase !== 'waiting' && publicRoom.joinPolicy === 'spectate'
                ? strings.lobby.spectateButton
                : strings.lobby.joinButton
            }}
          </AppButton>
        </article>

        <div
          v-if="!store.presence.rooms.length"
          class="grid h-full place-content-center gap-[0.8cqh] justify-items-center border-[0.2cqh] border-dashed border-line text-muted"
        >
          <Gamepad2 class="h-[6cqh] w-[6cqh] text-muted" />
          <b>{{ strings.lobby.emptyRoomsTitle }}</b>
          <span>{{ strings.lobby.emptyRoomsHint }}</span>
        </div>
      </div>
    </section>

    <aside class="flex min-w-0 flex-col bg-paper px-[1.6cqw] pb-[2cqh] pt-[3cqh]">
      <div class="flex items-end justify-between">
        <SectionHeader :eyebrow="strings.lobby.playersLabel" :title="strings.lobby.playersTitle" />
        <span
          class="grid h-[3cqh] w-[3cqh] place-items-center rounded-full bg-green text-white text-fs-12"
        >
          {{ store.presence.players.length }}
        </span>
      </div>

      <div class="mt-[1.6cqh] mb-[1.2cqh]">
        <SearchInput
          v-model="playerFilter"
          :placeholder="strings.lobby.playerFilterPlaceholder"
          :aria-label="strings.lobby.playerFilterAria"
        />
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-[0.7cqh] overflow-y-auto overscroll-contain">
        <div
          v-for="player in filteredPlayers"
          :key="player.id"
          class="flex items-center gap-[0.7em] rounded-[0.7em] border-[0.16cqh] border-line bg-white px-[0.7em] py-[0.7cqh] ui-feedback hover:border-sky hover-tint"
        >
          <AvatarImage
            :avatar-id="player.avatarId"
            :label="strings.common.playerAvatarAria(player.nickname)"
            class="h-[4.8cqh] w-[4.8cqh]"
          />
          <div class="flex min-w-0 flex-col">
            <b class="truncate">{{ player.nickname }}</b>
            <span
              class="text-fs-12"
              :class="player.status === 'idle' ? 'text-green font-bold' : 'text-muted'"
            >
              {{ statusText[player.status] }}
            </span>
          </div>
        </div>

        <p v-if="!filteredPlayers.length" class="text-muted text-fs-12 leading-[1.6]">
          {{ strings.lobby.discoveryEmpty }}
        </p>
      </div>

      <footer
        class="flex items-start gap-[0.65em] border-l-[0.35cqh] border-l-blue bg-sky px-[0.75em] py-[1.1cqh] text-fs-12 text-blue"
      >
        <Wifi />
        <span class="flex flex-col leading-[1.45]">
          <b>{{ strings.lobby.lanTipTitle }}</b>
          {{ strings.lobby.lanTipBody }}
        </span>
      </footer>
    </aside>

    <!-- 弹窗组件调用 -->
    <CreateRoomDialog v-model:open="showCreate" />
    <JoinPrivateDialog v-model:open="showJoinPrivate" />
  </main>
</template>
