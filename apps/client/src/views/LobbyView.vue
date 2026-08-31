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
  X,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { RoomSettings, RoomVisibility } from '@draw-guess/shared'
import AvatarImage from '@/components/AvatarImage.vue'
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
  <main class="lobby-layout">
    <header class="lobby-hud">
      <div class="identity-block">
        <AvatarImage :avatar-id="store.profile.avatarId" :label="strings.common.myAvatarAria" />
        <div>
          <strong>{{ store.profile.nickname }}</strong
          ><span><Wifi /> {{ store.connectionLabel }} · {{ store.latency || '—' }} ms</span>
        </div>
      </div>
      <div class="lobby-title">
        <Gamepad2 />
        <div>
          <b>{{ store.config.app.name }}</b
          ><span>{{ strings.lobby.lobbyEnglishTitle }}</span>
        </div>
      </div>
      <nav class="hud-actions" :aria-label="strings.lobby.navAria">
        <button type="button" @click="store.page = 'settings'">
          <Settings /> {{ strings.lobby.settingsEntry }}
        </button>
      </nav>
    </header>

    <section class="room-zone">
      <div class="room-zone-head">
        <div>
          <p class="step-label">{{ strings.lobby.roomsLabel }}</p>
          <h2>{{ strings.lobby.roomsTitle }}</h2>
        </div>
        <span>{{ strings.lobby.roomCount(store.presence.rooms.length) }}</span>
      </div>
      <!-- 原单个大按钮拆成左右两个等宽入口。 -->
      <div class="quick-actions">
        <button class="create-room-button" type="button" @click="showCreate = true">
          <CirclePlus /><span
            ><b>{{ strings.lobby.createRoomTitle }}</b
            ><small>{{ strings.lobby.createRoomHint }}</small></span
          ><ChevronRight />
        </button>
        <button
          class="create-room-button private-entry"
          type="button"
          @click="showJoinPrivate = true"
        >
          <KeyRound /><span
            ><b>{{ strings.lobby.joinPrivateTitle }}</b
            ><small>{{ strings.lobby.joinPrivateHint }}</small></span
          ><ChevronRight />
        </button>
      </div>

      <div class="public-room-list" :aria-label="strings.lobby.roomListAria">
        <article v-for="publicRoom in store.presence.rooms" :key="publicRoom.id" class="room-row">
          <div class="room-emblem"><Gamepad2 /></div>
          <div class="room-main">
            <b>{{ publicRoom.name }}</b
            ><span>{{
              strings.lobby.roomMeta(
                publicRoom.hostName,
                publicRoom.roundsPerPlayer,
                publicRoom.drawSeconds,
              )
            }}</span>
          </div>
          <span class="room-phase">{{
            strings.status[
              publicRoom.phase === 'waiting'
                ? 'roomWaiting'
                : publicRoom.joinPolicy === 'spectate'
                  ? 'roomSpectatable'
                  : 'roomInProgress'
            ]
          }}</span>
          <span class="room-count"
            ><Users /> {{ publicRoom.playerCount }}/{{ publicRoom.maxPlayers }}</span
          >
          <button
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
          </button>
        </article>
        <div v-if="!store.presence.rooms.length" class="empty-stage">
          <Gamepad2 /><b>{{ strings.lobby.emptyRoomsTitle }}</b
          ><span>{{ strings.lobby.emptyRoomsHint }}</span>
        </div>
      </div>
    </section>

    <aside class="online-zone">
      <div class="online-head">
        <div>
          <p class="step-label">{{ strings.lobby.playersLabel }}</p>
          <h2>{{ strings.lobby.playersTitle }}</h2>
        </div>
        <span>{{ store.presence.players.length }}</span>
      </div>
      <label class="search-field"
        ><Search /><input
          v-model="playerFilter"
          :placeholder="strings.lobby.playerFilterPlaceholder"
          :aria-label="strings.lobby.playerFilterAria"
      /></label>
      <div class="player-discovery-list">
        <div v-for="player in filteredPlayers" :key="player.id" class="discovery-player">
          <AvatarImage
            :avatar-id="player.avatarId"
            :label="strings.common.playerAvatarAria(player.nickname)"
          />
          <div>
            <b>{{ player.nickname }}</b
            ><span :class="player.status">{{ statusText[player.status] }}</span>
          </div>
        </div>
        <p v-if="!filteredPlayers.length" class="discovery-note">
          {{ strings.lobby.discoveryEmpty }}
        </p>
      </div>
      <footer class="lan-tip">
        <Wifi /><span
          ><b>{{ strings.lobby.lanTipTitle }}</b
          >{{ strings.lobby.lanTipBody }}</span
        >
      </footer>
    </aside>

    <!-- 创建房间弹窗：公开/私密为互斥单选，游戏规则保持一致。 -->
    <Transition name="modal">
      <div
        v-if="showCreate"
        class="stage-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        @keydown.esc="showCreate = false"
      >
        <section class="game-dialog create-dialog">
          <header>
            <div>
              <p class="step-label">{{ strings.lobby.newRoomLabel }}</p>
              <h2 id="create-title">{{ strings.lobby.createDialogTitle }}</h2>
            </div>
            <button
              type="button"
              :aria-label="strings.lobby.createDialogCloseAria"
              @click="showCreate = false"
            >
              <X />
            </button>
          </header>
          <div class="create-grid">
            <fieldset class="wide-field visibility-options">
              <legend>{{ strings.lobby.visibilityField }}</legend>
              <label>
                <input v-model="createForm.visibility" type="radio" value="public" />
                <span
                  ><b>{{ strings.lobby.visibilityPublic }}</b
                  ><small>{{ strings.lobby.visibilityPublicHint }}</small></span
                >
              </label>
              <label>
                <input v-model="createForm.visibility" type="radio" value="private" />
                <span
                  ><b>{{ strings.lobby.visibilityPrivate }}</b
                  ><small>{{ strings.lobby.visibilityPrivateHint }}</small></span
                >
              </label>
            </fieldset>
            <label
              >{{ strings.lobby.roomNameField
              }}<input
                v-model="createForm.name"
                class="game-input"
                :maxlength="store.config.player.roomNameMaxLength"
            /></label>
            <label
              >{{ strings.lobby.maxPlayersField
              }}<select v-model="roomSettings.maxPlayers">
                <option
                  v-for="count in store.config.player.maxPlayers -
                  store.config.player.minPlayers +
                  1"
                  :key="count"
                  :value="count + store.config.player.minPlayers - 1"
                >
                  {{ strings.common.playersUnit(count + store.config.player.minPlayers - 1) }}
                </option>
              </select></label
            >
            <label
              >{{ strings.common.roundsField
              }}<input
                v-model.number="roomSettings.roundsPerPlayer"
                type="range"
                :min="store.config.game.roundsPerPlayer.min"
                :max="store.config.game.roundsPerPlayer.max"
                :step="store.config.game.roundsPerPlayer.step"
              /><b>{{ strings.common.roundsUnit(roomSettings.roundsPerPlayer) }}</b></label
            >
            <label
              >{{ strings.common.drawTimeField
              }}<input
                v-model.number="roomSettings.drawSeconds"
                type="range"
                :min="store.config.game.drawSeconds.min"
                :max="store.config.game.drawSeconds.max"
                :step="store.config.game.drawSeconds.step"
              /><b>{{ strings.common.secondsUnit(roomSettings.drawSeconds) }}</b></label
            >
            <p class="wide-field room-public-note">
              {{
                createForm.visibility === 'public'
                  ? strings.lobby.publicNote
                  : strings.lobby.privateNote
              }}
            </p>
          </div>
          <footer>
            <button class="secondary-action" type="button" @click="showCreate = false">
              {{ strings.common.cancel }}
            </button>
            <button
              class="primary-action"
              type="button"
              :disabled="!createForm.name.trim()"
              @click="createRoom"
            >
              {{ strings.lobby.createAndEnter }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>

    <!-- 私密房间码加入弹窗。 -->
    <Transition name="modal">
      <div
        v-if="showJoinPrivate"
        class="stage-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-private-title"
        @keydown.esc="showJoinPrivate = false"
      >
        <section class="game-dialog private-join-dialog">
          <header>
            <div>
              <p class="step-label">{{ strings.lobby.privateJoinLabel }}</p>
              <h2 id="join-private-title">{{ strings.lobby.privateJoinTitle }}</h2>
            </div>
            <button
              type="button"
              :aria-label="strings.lobby.privateJoinCloseAria"
              @click="showJoinPrivate = false"
            >
              <X />
            </button>
          </header>
          <div class="private-join-content">
            <KeyRound />
            <p>{{ strings.lobby.privateJoinBody }}</p>
            <input
              v-model="privateCode"
              class="game-input private-code-input"
              :maxlength="store.config.room.privateCodeLength + 2"
              autocomplete="off"
              :placeholder="strings.lobby.privateCodePlaceholder"
              :aria-label="strings.lobby.privateCodeAria"
              @keydown.enter="joinPrivateRoom"
            />
          </div>
          <footer>
            <button class="secondary-action" type="button" @click="showJoinPrivate = false">
              {{ strings.common.cancel }}
            </button>
            <button
              class="primary-action"
              type="button"
              :disabled="!privateCodeValid"
              @click="joinPrivateRoom"
            >
              {{ strings.lobby.joinPrivateConfirm }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </main>
</template>
