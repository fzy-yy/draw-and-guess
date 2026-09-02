<!-- 在线大厅：只展示公开房间；私密房间通过服务端生成的短码加入。 -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ChevronRight,
  CirclePlus,
  Gamepad2,
  KeyRound,
  Search,
  Settings,
  Users,
  Wifi,
} from 'lucide-vue-next'
import { clsx } from 'clsx'
import { strings } from '@draw-guess/strings'
import type { RoomSettings, RoomVisibility } from '@draw-guess/shared'
import AppButton from '@/components/AppButton.vue'
import AvatarImage from '@/components/AvatarImage.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
const showCreate = ref(false)
const showJoinPrivate = ref(false)
const playerFilter = ref('')
const privateCode = ref('')
const createForm = reactive<{ name: string; visibility: RoomVisibility }>({
  name: store.config.room.defaultName,
  visibility: 'public',
})
const roomSettings = reactive<RoomSettings>({
  maxPlayers: store.config.player.defaultMaxPlayers,
  roundsPerPlayer: store.config.game.roundsPerPlayer.default,
  drawSeconds: store.config.game.drawSeconds.default,
  chooseSeconds: store.config.game.chooseSeconds.default,
  optionCount: store.config.game.optionCount.default,
  showWordLength: store.config.game.showWordLength,
  progressiveHints: store.config.game.progressiveHints,
  structuredHintsEnabled: store.config.game.structuredHintsEnabled,
  hintStartRatio: store.config.game.hintStartRatio,
  hintIntervalRatio: store.config.game.hintIntervalRatio,
  guessBaseScore: store.config.game.score.guessBase,
  scoreMode: store.config.game.scoreMode,
  closeGuessEnabled: store.config.game.closeGuessEnabled,
  allowPlayerInvite: store.config.room.allowPlayerInvite,
  allowPause: store.config.room.allowPause,
  joinPolicy: store.config.room.joinPolicy,
})

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
const privateCodeValid = computed(
  () => privateCode.value.replace(/[\s-]/gu, '').length === store.config.room.privateCodeLength,
)

/** 创建请求显式携带可见性；私密房间码只能由服务端生成。 */
async function createRoom(): Promise<void> {
  await store.createRoom({
    name: createForm.name,
    visibility: createForm.visibility,
    settings: { ...roomSettings },
  })
  showCreate.value = false
}

/** 输入短码加入私密房；失败时保留弹窗和输入，方便玩家核对后重试。 */
async function joinPrivateRoom(): Promise<void> {
  if (!privateCodeValid.value) return
  await store.joinPrivateRoom(privateCode.value)
  privateCode.value = ''
  showJoinPrivate.value = false
}
</script>

<template>
  <main class="grid h-full grid-cols-[minmax(0,1fr)_28%] grid-rows-[11%_89%] bg-[#eef2ff]">
    <header
      class="col-span-full grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.5cqh] border-yellow bg-navy px-[2cqw] text-white"
    >
      <div class="flex min-w-0 items-center gap-[0.8em]">
        <AvatarImage
          :avatar-id="store.profile.avatarId"
          :label="strings.common.myAvatarAria"
          class="h-[6cqh] w-[6cqh] !border-[#93c5fd]"
        />
        <div class="flex min-w-0 flex-col">
          <strong class="truncate">{{ store.profile.nickname }}</strong
          ><span class="flex items-center gap-[0.35em] text-[#bfdbfe] text-[0.67em]"
            ><Wifi /> {{ store.connectionLabel }} · {{ store.latency || '—' }} ms</span
          >
        </div>
      </div>
      <div class="flex items-center gap-[0.6em]">
        <Gamepad2 class="h-[4.2cqh] w-[4.2cqh] text-yellow" />
        <div class="flex flex-col leading-[1.05]">
          <b class="text-[1.2em]">{{ store.config.app.name }}</b
          ><span class="text-[#93c5fd] text-[0.58em] tracking-[0.18em]">{{
            strings.lobby.lobbyEnglishTitle
          }}</span>
        </div>
      </div>
      <nav class="flex justify-self-end gap-[0.7em]" :aria-label="strings.lobby.navAria">
        <button
          type="button"
          class="flex items-center gap-[0.4em] rounded-[0.55em] bg-[#ffffff0d] px-[0.8em] py-[0.8cqh] text-[#dbeafe]"
          @click="store.page = 'settings'"
        >
          <Settings /> {{ strings.lobby.settingsEntry }}
        </button>
      </nav>
    </header>

    <section class="min-w-0 border-r-[0.2cqh] border-line px-[2cqw] py-[3cqh]">
      <div class="flex items-end justify-between">
        <div>
          <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
            {{ strings.lobby.roomsLabel }}
          </p>
          <h2>{{ strings.lobby.roomsTitle }}</h2>
        </div>
        <span class="text-muted text-[0.78em]">{{
          strings.lobby.roomCount(store.presence.rooms.length)
        }}</span>
      </div>
      <!-- 原单个大按钮拆成左右两个等宽入口。 -->
      <div class="my-[2cqh] grid grid-cols-2 gap-[1.3cqw]">
        <button
          type="button"
          class="flex h-[12cqh] items-center gap-[1em] rounded-[0.9em] bg-blue px-[1.4em] text-left text-white"
          @click="showCreate = true"
        >
          <CirclePlus class="first:h-[4.5cqh] first:w-[4.5cqh] first:text-yellow" /><span
            class="flex flex-col"
            ><b class="text-[1.2em]">{{ strings.lobby.createRoomTitle }}</b
            ><small class="mt-[0.35cqh] text-[#dbeafe]">{{
              strings.lobby.createRoomHint
            }}</small></span
          ><ChevronRight class="last:ml-auto" />
        </button>
        <button
          type="button"
          class="flex h-[12cqh] items-center gap-[1em] rounded-[0.9em] bg-navy px-[1.4em] text-left text-white"
          @click="showJoinPrivate = true"
        >
          <KeyRound class="first:h-[4.5cqh] first:w-[4.5cqh] first:text-yellow" /><span
            class="flex flex-col"
            ><b class="text-[1.2em]">{{ strings.lobby.joinPrivateTitle }}</b
            ><small class="mt-[0.35cqh] text-[#dbeafe]">{{
              strings.lobby.joinPrivateHint
            }}</small></span
          ><ChevronRight class="last:ml-auto" />
        </button>
      </div>

      <div
        class="flex h-[49cqh] flex-col gap-[0.85cqh] overflow-y-auto overscroll-contain"
        :aria-label="strings.lobby.roomListAria"
      >
        <article
          v-for="publicRoom in store.presence.rooms"
          :key="publicRoom.id"
          class="grid min-h-[7.8cqh] grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-[0.9em] border-b-[0.16cqh] border-l-[0.45cqh] border-b-line border-l-blue bg-white px-[0.9em] py-[0.6cqh] transition-[transform,box-shadow,border-color,background-color,color,opacity] duration-[160ms] hover:border-[#93c5fd] hover:shadow-[0_0.6cqh_1.6cqh_#17255418]"
        >
          <div class="grid h-[5cqh] w-[5cqh] place-items-center rounded-[0.6em] bg-sky text-blue">
            <Gamepad2 />
          </div>
          <div class="flex min-w-0 flex-col">
            <b class="truncate">{{ publicRoom.name }}</b
            ><span class="text-muted text-[0.68em]">{{
              strings.lobby.roomMeta(
                publicRoom.hostName,
                publicRoom.roundsPerPlayer,
                publicRoom.drawSeconds,
              )
            }}</span>
          </div>
          <span class="text-muted text-[0.68em]">{{
            strings.status[
              publicRoom.phase === 'waiting'
                ? 'roomWaiting'
                : publicRoom.joinPolicy === 'spectate'
                  ? 'roomSpectatable'
                  : 'roomInProgress'
            ]
          }}</span>
          <span class="flex items-center gap-[0.35em] font-extrabold"
            ><Users /> {{ publicRoom.playerCount }}/{{ publicRoom.maxPlayers }}</span
          >
          <button
            type="button"
            class="rounded-[0.5em] bg-blue px-[1em] py-[0.75cqh] font-extrabold text-white"
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
          </button>
        </article>
        <div
          v-if="!store.presence.rooms.length"
          class="grid h-full place-content-center gap-[0.8cqh] justify-items-center border-[0.2cqh] border-dashed border-slate-400 text-muted"
        >
          <Gamepad2 class="h-[6cqh] w-[6cqh] text-slate-400" /><b>{{
            strings.lobby.emptyRoomsTitle
          }}</b
          ><span>{{ strings.lobby.emptyRoomsHint }}</span>
        </div>
      </div>
    </section>

    <aside class="flex min-w-0 flex-col bg-slate-50 px-[1.6cqw] pb-[2cqh] pt-[3cqh]">
      <div class="flex items-end justify-between">
        <div>
          <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
            {{ strings.lobby.playersLabel }}
          </p>
          <h2 class="mt-[0.3cqh]">{{ strings.lobby.playersTitle }}</h2>
        </div>
        <span
          class="grid h-[3cqh] w-[3cqh] place-items-center rounded-full bg-green text-white text-[0.78em]"
          >{{ store.presence.players.length }}</span
        >
      </div>
      <label
        class="mt-[1.6cqh] mb-[1.2cqh] flex h-[4.8cqh] items-center gap-[0.6em] rounded-[0.65em] border-[0.18cqh] border-line bg-white px-[0.75em]"
        ><Search /><input
          v-model="playerFilter"
          class="w-full min-w-0 border-0 outline-0 bg-transparent"
          :placeholder="strings.lobby.playerFilterPlaceholder"
          :aria-label="strings.lobby.playerFilterAria"
      /></label>
      <div
        class="flex min-h-0 flex-1 flex-col gap-[0.7cqh] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div
          v-for="player in filteredPlayers"
          :key="player.id"
          class="flex items-center gap-[0.7em] border-b-[0.14cqh] border-slate-200 px-[0.5em] py-[0.55cqh] hover:border-[#93c5fd] hover:shadow-[0_0.6cqh_1.6cqh_#17255418]"
        >
          <AvatarImage
            :avatar-id="player.avatarId"
            :label="strings.common.playerAvatarAria(player.nickname)"
            class="h-[4.8cqh] w-[4.8cqh]"
          />
          <div class="flex min-w-0 flex-col">
            <b class="truncate">{{ player.nickname }}</b
            ><span
              class="text-muted text-[0.66em]"
              :class="clsx(player.status === 'idle' && '!text-green')"
              >{{ statusText[player.status] }}</span
            >
          </div>
        </div>
        <p v-if="!filteredPlayers.length" class="text-muted text-[0.72em] leading-[1.6]">
          {{ strings.lobby.discoveryEmpty }}
        </p>
      </div>
      <footer
        class="flex items-start gap-[0.65em] border-l-[0.35cqh] border-l-blue bg-sky px-[0.75em] py-[1.1cqh] text-[0.68em] text-[#1e3a8a]"
      >
        <Wifi /><span class="flex flex-col leading-[1.45]"
          ><b>{{ strings.lobby.lanTipTitle }}</b
          >{{ strings.lobby.lanTipBody }}</span
        >
      </footer>
    </aside>

    <!-- 创建房间弹窗：公开/私密为互斥单选，游戏规则保持一致。 -->
    <BaseDialog
      :open="showCreate"
      width-class="w-[58cqw]"
      labelledby="create-title"
      :close-aria="strings.lobby.createDialogCloseAria"
      @close="showCreate = false"
    >
      <template #header>
        <p class="text-[#93c5fd] font-black tracking-[0.16em] text-[0.72em]">
          {{ strings.lobby.newRoomLabel }}
        </p>
        <h2 id="create-title">{{ strings.lobby.createDialogTitle }}</h2>
      </template>
      <div class="grid grid-cols-2 gap-[1.8cqh_1.4em] px-[2em] py-[2.8cqh]">
        <fieldset class="col-span-full m-0 grid grid-cols-2 gap-[0.8em] border-0 p-0">
          <legend class="mb-[0.7cqh] font-black">{{ strings.lobby.visibilityField }}</legend>
          <label
            class="flex items-center gap-[0.7em] rounded-[0.7em] border-[0.18cqh] border-line bg-white px-[1em] py-[1cqh]"
          >
            <input
              v-model="createForm.visibility"
              type="radio"
              value="public"
              class="h-[2.2cqh] w-[2.2cqh] accent-blue"
            />
            <span class="flex flex-col"
              ><b>{{ strings.lobby.visibilityPublic }}</b
              ><small class="text-muted text-[0.68em]">{{
                strings.lobby.visibilityPublicHint
              }}</small></span
            >
          </label>
          <label
            class="flex items-center gap-[0.7em] rounded-[0.7em] border-[0.18cqh] border-line bg-white px-[1em] py-[1cqh]"
          >
            <input
              v-model="createForm.visibility"
              type="radio"
              value="private"
              class="h-[2.2cqh] w-[2.2cqh] accent-blue"
            />
            <span class="flex flex-col"
              ><b>{{ strings.lobby.visibilityPrivate }}</b
              ><small class="text-muted text-[0.68em]">{{
                strings.lobby.visibilityPrivateHint
              }}</small></span
            >
          </label>
        </fieldset>
        <label class="flex flex-col gap-[0.55cqh] font-extrabold"
          >{{ strings.lobby.roomNameField
          }}<input
            v-model="createForm.name"
            class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
            :maxlength="store.config.player.roomNameMaxLength"
        /></label>
        <label class="flex flex-col gap-[0.55cqh] font-extrabold"
          >{{ strings.lobby.maxPlayersField
          }}<select
            v-model="roomSettings.maxPlayers"
            class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
          >
            <option
              v-for="count in store.config.player.maxPlayers - store.config.player.minPlayers + 1"
              :key="count"
              :value="count + store.config.player.minPlayers - 1"
            >
              {{ strings.common.playersUnit(count + store.config.player.minPlayers - 1) }}
            </option>
          </select></label
        >
        <label class="flex flex-col gap-[0.55cqh] font-extrabold"
          >{{ strings.common.roundsField
          }}<input
            v-model.number="roomSettings.roundsPerPlayer"
            type="range"
            :min="store.config.game.roundsPerPlayer.min"
            :max="store.config.game.roundsPerPlayer.max"
            :step="store.config.game.roundsPerPlayer.step"
          /><b>{{ strings.common.roundsUnit(roomSettings.roundsPerPlayer) }}</b></label
        >
        <label class="flex flex-col gap-[0.55cqh] font-extrabold"
          >{{ strings.common.drawTimeField
          }}<input
            v-model.number="roomSettings.drawSeconds"
            type="range"
            :min="store.config.game.drawSeconds.min"
            :max="store.config.game.drawSeconds.max"
            :step="store.config.game.drawSeconds.step"
          /><b>{{ strings.common.secondsUnit(roomSettings.drawSeconds) }}</b></label
        >
        <p class="col-span-full m-0 text-muted text-[0.72em] leading-[1.6]">
          {{
            createForm.visibility === 'public'
              ? strings.lobby.publicNote
              : strings.lobby.privateNote
          }}
        </p>
      </div>
      <template #footer>
        <AppButton variant="secondary" type="button" @click="showCreate = false">
          {{ strings.common.cancel }}
        </AppButton>
        <AppButton type="button" :disabled="!createForm.name.trim()" @click="createRoom">
          {{ strings.lobby.createAndEnter }}
        </AppButton>
      </template>
    </BaseDialog>

    <!-- 私密房间码加入弹窗。 -->
    <BaseDialog
      :open="showJoinPrivate"
      width-class="w-[42cqw]"
      labelledby="join-private-title"
      :close-aria="strings.lobby.privateJoinCloseAria"
      @close="showJoinPrivate = false"
    >
      <template #header>
        <p class="text-[#93c5fd] font-black tracking-[0.16em] text-[0.72em]">
          {{ strings.lobby.privateJoinLabel }}
        </p>
        <h2 id="join-private-title">{{ strings.lobby.privateJoinTitle }}</h2>
      </template>
      <div class="grid justify-items-center gap-[1.5cqh] px-[4cqw] py-[4cqh] text-center">
        <KeyRound class="h-[7cqh] w-[7cqh] text-blue" />
        <p class="text-muted">{{ strings.lobby.privateJoinBody }}</p>
        <input
          v-model="privateCode"
          class="min-w-0 h-[5.2cqh] w-[22cqw] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] text-center font-black uppercase tracking-[0.3em] leading-none text-ink font-mono text-[1.25em]"
          :maxlength="store.config.room.privateCodeLength + 2"
          autocomplete="off"
          :placeholder="strings.lobby.privateCodePlaceholder"
          :aria-label="strings.lobby.privateCodeAria"
          @keydown.enter="joinPrivateRoom"
        />
      </div>
      <template #footer>
        <AppButton variant="secondary" type="button" @click="showJoinPrivate = false">
          {{ strings.common.cancel }}
        </AppButton>
        <AppButton type="button" :disabled="!privateCodeValid" @click="joinPrivateRoom">
          {{ strings.lobby.joinPrivateConfirm }}
        </AppButton>
      </template>
    </BaseDialog>
  </main>
</template>
