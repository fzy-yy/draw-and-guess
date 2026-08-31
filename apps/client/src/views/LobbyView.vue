<!-- 在线大厅：服务器实时推送全部公开房间与可发现玩家，房间通过内部 ID 一键加入。 -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ChevronRight, CirclePlus, Gamepad2, Search, Settings, Users, Wifi } from 'lucide-vue-next'
import { useGameStore } from '@/stores/game'
import type { RoomSettings } from '@draw-guess/shared'

const store = useGameStore()
const showCreate = ref(false) // 创建房间弹窗开关
const playerFilter = ref('') // 在线玩家昵称筛选关键词
const createForm = reactive({ name: store.config.room.defaultName }) // 创建表单：房间名
// 创建房间的默认规则快照（可编辑，提交时整体传给服务端）
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

// 在线玩家筛选列表：排除自己，按昵称子串过滤
const filteredPlayers = computed(() =>
  store.presence.players.filter(
    (player) => player.id !== store.playerId && player.nickname.includes(playerFilter.value.trim()),
  ),
)
// 玩家状态中文文案
const statusText = {
  idle: '空闲',
  in_room: '房间中',
  playing: '游戏中',
  reconnecting: '离线宽限',
} as const

/** 创建请求不包含密码、公开开关或玩家房间码；所有房间固定公开。 */
async function createRoom(): Promise<void> {
  await store.createRoom({ name: createForm.name, settings: { ...roomSettings } })
  showCreate.value = false
}
</script>

<template>
  <!-- 在线大厅骨架：左侧房间区 + 右侧在线玩家区，顶栏含身份与设置入口 -->
  <main class="lobby-layout">
    <!-- 顶栏：我的身份 / 游戏标题 / 设置入口 -->
    <header class="lobby-hud">
      <div class="identity-block">
        <!-- 我的头像与昵称 -->
        <span
          class="solid-avatar"
          :style="{ backgroundColor: store.profile.avatarColor }"
          aria-label="我的纯色头像"
        ></span>
        <div>
          <strong>{{ store.profile.nickname }}</strong
          ><span><Wifi /> {{ store.connectionLabel }} · {{ store.latency || '—' }} ms</span>
        </div>
      </div>
      <div class="lobby-title">
        <Gamepad2 />
        <div>
          <b>{{ store.config.app.name }}</b
          ><span>ONLINE LOBBY</span>
        </div>
      </div>
      <nav class="hud-actions" aria-label="辅助页面">
        <button type="button" @click="store.page = 'settings'"><Settings /> 设置</button>
      </nav>
    </header>

    <!-- 左侧：全部公开房间列表 -->
    <section class="room-zone">
      <div class="room-zone-head">
        <div>
          <p class="step-label">ROOMS</p>
          <h2>全部公开画室</h2>
        </div>
        <span>{{ store.presence.rooms.length }} 个房间</span>
      </div>
      <div class="quick-actions public-only">
        <!-- 创建公开房间大按钮：固定公开模式只有一个入口 -->
        <button class="create-room-button" type="button" @click="showCreate = true">
          <CirclePlus /><span><b>创建公开房间</b><small>创建后立即对所有在线玩家可见</small></span
          ><ChevronRight />
        </button>
      </div>

      <!-- 房间列表：每行展示名称、房主、规则、状态、人数与加入按钮 -->
      <div class="public-room-list" aria-label="全部公开房间列表">
        <article v-for="publicRoom in store.presence.rooms" :key="publicRoom.id" class="room-row">
          <div class="room-emblem"><Gamepad2 /></div>
          <div class="room-main">
            <b>{{ publicRoom.name }}</b
            ><span
              >房主 {{ publicRoom.hostName }} · {{ publicRoom.roundsPerPlayer }} 轮 ·
              {{ publicRoom.drawSeconds }} 秒</span
            >
          </div>
          <span class="room-phase">{{
            publicRoom.phase === 'waiting'
              ? '等待中'
              : publicRoom.joinPolicy === 'spectate'
                ? '可以观战'
                : '进行中'
          }}</span>
          <span class="room-count"
            ><Users /> {{ publicRoom.playerCount }}/{{ publicRoom.maxPlayers }}</span
          >
          <!-- 加入按钮：等待阶段可直接加入；游戏中仅 joinPolicy='spectate' 可观战加入；满员时禁用 -->
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
                ? '观战'
                : '加入'
            }}
          </button>
        </article>
        <!-- 空状态：没有公开房间时的提示 -->
        <div v-if="!store.presence.rooms.length" class="empty-stage">
          <Gamepad2 /><b>还没有公开房间</b
          ><span>成为第一个房主，新房间会实时广播给所有在线玩家。</span>
        </div>
      </div>
    </section>

    <!-- 右侧：在线玩家发现列表，可按昵称筛选 -->
    <aside class="online-zone">
      <div class="online-head">
        <div>
          <p class="step-label">PLAYERS</p>
          <h2>在线玩家</h2>
        </div>
        <span>{{ store.presence.players.length }}</span>
      </div>
      <label class="search-field"
        ><Search /><input v-model="playerFilter" placeholder="按昵称筛选" aria-label="筛选在线玩家"
      /></label>
      <div class="player-discovery-list">
        <!-- 每个可发现玩家：头像 + 昵称 + 状态 -->
        <div v-for="player in filteredPlayers" :key="player.id" class="discovery-player">
          <span
            class="solid-avatar"
            :style="{ backgroundColor: player.avatarColor }"
            :aria-label="`${player.nickname}的纯色头像`"
          ></span>
          <div>
            <b>{{ player.nickname }}</b
            ><span :class="player.status">{{ statusText[player.status] }}</span>
          </div>
        </div>
        <p v-if="!filteredPlayers.length" class="discovery-note">
          其他玩家需先访问本主机地址并确认资料，之后会自动显示在这里。
        </p>
      </div>
      <!-- 局域网发现机制说明 -->
      <footer class="lan-tip">
        <Wifi /><span
          ><b>局域网发现说明</b>这里只展示已经连接到当前主机服务且允许被发现的玩家。</span
        >
      </footer>
    </aside>

    <!-- 创建房间弹窗：房间名与开局规则设置 -->
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
            <p class="step-label">NEW ROOM</p>
            <h2 id="create-title">创建公开画室</h2>
          </div>
          <button type="button" aria-label="关闭创建房间弹窗" @click="showCreate = false">×</button>
        </header>
        <div class="create-grid">
          <label
            >房间名称<input
              v-model="createForm.name"
              class="game-input"
              :maxlength="store.config.player.roomNameMaxLength"
          /></label>
          <label
            >最大人数<select v-model="roomSettings.maxPlayers">
              <option
                v-for="count in store.config.player.maxPlayers - store.config.player.minPlayers + 1"
                :key="count"
                :value="count + store.config.player.minPlayers - 1"
              >
                {{ count + store.config.player.minPlayers - 1 }} 人
              </option>
            </select></label
          >
          <label
            >每人作画次数<input
              v-model.number="roomSettings.roundsPerPlayer"
              type="range"
              :min="store.config.game.roundsPerPlayer.min"
              :max="store.config.game.roundsPerPlayer.max"
              :step="store.config.game.roundsPerPlayer.step"
            /><b>{{ roomSettings.roundsPerPlayer }} 轮</b></label
          >
          <label
            >作画时间<input
              v-model.number="roomSettings.drawSeconds"
              type="range"
              :min="store.config.game.drawSeconds.min"
              :max="store.config.game.drawSeconds.max"
              :step="store.config.game.drawSeconds.step"
            /><b>{{ roomSettings.drawSeconds }} 秒</b></label
          >
          <p class="wide-field room-public-note">
            所有房间固定公开，无密码、房间码或二维码；玩家可直接从大厅列表加入。
          </p>
        </div>
        <footer>
          <button class="secondary-action" type="button" @click="showCreate = false">取消</button
          ><button
            class="primary-action"
            type="button"
            :disabled="!createForm.name.trim()"
            @click="createRoom"
          >
            创建并进入
          </button>
        </footer>
      </section>
    </div>
  </main>
</template>
