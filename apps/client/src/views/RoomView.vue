<!-- 房间等待界面：固定六个游戏席位、权威准备门槛、房主规则与本局词库管理。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BookOpenCheck,
  Check,
  Crown,
  LogOut,
  Play,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-vue-next'
import { useGameStore } from '@/stores/game'
import type { RoomSettings } from '@draw-guess/shared'

const store = useGameStore()
const showVocabulary = ref(false)
const showSettings = ref(false)
const showInvite = ref(false)
const showLeaveConfirm = ref(false)
const search = ref('')
const selectedIds = ref<string[]>([])
const settingsDraft = ref<RoomSettings>()

const slots = computed(() =>
  Array.from(
    { length: store.room?.settings.maxPlayers ?? 6 },
    (_, index) => store.room?.members[index],
  ),
)
const allReady = computed(() =>
  Boolean(
    store.room &&
    store.room.members.length >= 2 &&
    store.room.members.every((member) => member.ready && member.connection === 'online'),
  ),
)
const availablePlayers = computed(() =>
  store.presence.players.filter(
    (player) => player.id !== store.playerId && player.status === 'idle',
  ),
)
const filteredWords = computed(() => {
  const keyword = search.value.normalize('NFKC').trim().toLocaleLowerCase()
  return (
    store.vocabulary?.items.filter((item) =>
      item.text.normalize('NFKC').toLocaleLowerCase().includes(keyword),
    ) ?? []
  )
})
const selectedSet = computed(() => new Set(selectedIds.value))

async function openVocabulary(): Promise<void> {
  await store.loadVocabulary()
  selectedIds.value = [...(store.vocabulary?.selectedIds ?? [])]
  showVocabulary.value = true
}
function setSelection(ids: string[], selected: boolean): void {
  const next = new Set(selectedIds.value)
  for (const id of ids) {
    if (selected) next.add(id)
    else next.delete(id)
  }
  selectedIds.value = [...next]
}
async function saveVocabulary(): Promise<void> {
  await store.saveVocabulary(selectedIds.value)
  showVocabulary.value = false
}
function openSettings(): void {
  if (!store.room) return
  settingsDraft.value = { ...store.room.settings }
  showSettings.value = true
}
async function saveSettings(): Promise<void> {
  if (!settingsDraft.value) return
  await store.updateRoomSettings(settingsDraft.value)
  showSettings.value = false
}
</script>

<template>
  <main v-if="store.room" class="waiting-layout">
    <header class="room-hud">
      <div class="room-heading">
        <span>ROOM</span>
        <h1>{{ store.room.name }}</h1>
      </div>
      <div class="room-public-badge"><ShieldCheck /> 固定公开房间 · 大厅一键加入</div>
      <div class="room-hud-actions">
        <span class="connection-chip online"><ShieldCheck /> 权威服务已连接</span>
        <button type="button" @click="showLeaveConfirm = true"><LogOut /> 退出</button>
      </div>
    </header>

    <section class="seat-zone">
      <div class="seat-zone-title">
        <div>
          <p class="step-label">PLAYERS</p>
          <h2>玩家席位</h2>
        </div>
        <span><Users /> {{ store.room.members.length }}/{{ store.room.settings.maxPlayers }}</span>
      </div>
      <div class="seat-grid">
        <article
          v-for="(member, index) in slots"
          :key="member?.id ?? index"
          class="player-seat"
          :class="{ empty: !member, ready: member?.ready, me: member?.id === store.playerId }"
        >
          <template v-if="member">
            <div class="seat-avatar">
              <span
                class="solid-avatar seat-solid-avatar"
                :style="{ backgroundColor: member.avatarColor }"
                :aria-label="`${member.nickname}的纯色头像`"
              ></span
              ><Crown v-if="member.isHost" class="host-crown" aria-label="房主" />
            </div>
            <div class="seat-name">
              <b>{{ member.nickname }}</b
              ><span v-if="member.id === store.playerId">我</span>
            </div>
            <span class="ready-label"
              ><Check v-if="member.ready" />{{
                member.ready ? '已准备' : member.connection === 'reconnecting' ? '重连中' : '未准备'
              }}</span
            >
            <button
              v-if="store.isHost && member.id !== store.playerId"
              class="seat-manage"
              type="button"
              aria-label="移除该玩家"
              @click="store.kick(member.id)"
            >
              <X />
            </button>
          </template>
          <template v-else><UserPlus /><b>等待玩家</b><span>可从在线列表邀请</span></template>
        </article>
      </div>
    </section>

    <aside class="room-control-zone">
      <div class="rule-summary">
        <div class="control-title">
          <p class="step-label">RULES</p>
          <h2>本局规则</h2>
          <button v-if="store.isHost" type="button" @click="openSettings">
            <Settings2 /> 编辑
          </button>
        </div>
        <dl>
          <div>
            <dt>作画次数</dt>
            <dd>每人 {{ store.room.settings.roundsPerPlayer }} 轮</dd>
          </div>
          <div>
            <dt>作画时间</dt>
            <dd>{{ store.room.settings.drawSeconds }} 秒</dd>
          </div>
          <div>
            <dt>候选词</dt>
            <dd>{{ store.room.settings.optionCount }} 选 1</dd>
          </div>
          <div>
            <dt>提示</dt>
            <dd>{{ store.room.settings.progressiveHints ? '逐步提示' : '关闭' }}</dd>
          </div>
        </dl>
      </div>

      <button
        class="vocabulary-entry"
        type="button"
        :disabled="!store.isHost"
        @click="openVocabulary"
      >
        <BookOpenCheck /><span
          ><b>本局词库</b
          ><small
            >{{ store.room.selectedWordCount }} / {{ store.room.totalWordCount }} 个词条</small
          ></span
        ><span>{{ store.isHost ? '管理' : '仅房主可编辑' }}</span>
      </button>

      <div class="invite-block public-only">
        <button
          class="secondary-action"
          type="button"
          :disabled="
            store.room.members.length >= store.room.settings.maxPlayers ||
            (!store.isHost && !store.room.settings.allowPlayerInvite)
          "
          :title="
            store.room.members.length >= store.room.settings.maxPlayers
              ? '房间已满员'
              : !store.isHost && !store.room.settings.allowPlayerInvite
                ? '本房间仅房主可邀请'
                : '邀请当前服务中的空闲玩家'
          "
          @click="showInvite = true"
        >
          <Send /> 邀请在线玩家
        </button>
      </div>

      <div class="ready-controls">
        <p v-if="!allReady">
          {{
            store.room.members.length < 2
              ? '还需要至少 1 名玩家'
              : '等待所有玩家准备（房主也需准备）'
          }}
        </p>
        <p v-else class="ready-success"><Check /> 全员准备就绪</p>
        <button
          class="ready-button"
          :class="{ active: store.me?.ready }"
          type="button"
          @click="store.setReady(!store.me?.ready)"
        >
          {{ store.me?.ready ? '取消准备' : '我准备好了' }}
        </button>
        <button
          v-if="store.isHost"
          class="primary-action start-button"
          type="button"
          :disabled="!allReady"
          @click="store.startGame"
        >
          <Play /> 开始游戏
        </button>
      </div>
    </aside>

    <div
      v-if="showVocabulary && store.vocabulary"
      class="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vocab-title"
    >
      <section class="game-dialog vocabulary-dialog">
        <header>
          <div>
            <p class="step-label">VOCABULARY</p>
            <h2 id="vocab-title">选择本局词库</h2>
          </div>
          <button type="button" aria-label="关闭词库" @click="showVocabulary = false"><X /></button>
        </header>
        <div class="vocab-stats">
          <span
            >全部 <b>{{ store.vocabulary.items.length }}</b></span
          ><span
            >搜索结果 <b>{{ filteredWords.length }}</b></span
          ><span
            >已选 <b>{{ selectedIds.length }}</b></span
          >
        </div>
        <div class="vocab-toolbar">
          <label class="search-field"
            ><Search /><input
              v-model="search"
              placeholder="输入关键词搜索"
              aria-label="搜索词条" /><button
              v-if="search"
              type="button"
              aria-label="清空搜索"
              @click="search = ''"
            >
              <X /></button
          ></label>
          <button
            type="button"
            @click="
              setSelection(
                store.vocabulary!.items.map((item) => item.id),
                true,
              )
            "
          >
            全选全部
          </button>
          <button
            type="button"
            @click="
              setSelection(
                store.vocabulary!.items.map((item) => item.id),
                false,
              )
            "
          >
            取消全选
          </button>
          <button
            type="button"
            @click="
              setSelection(
                filteredWords.map((item) => item.id),
                true,
              )
            "
          >
            全选结果
          </button>
          <button
            type="button"
            @click="
              setSelection(
                filteredWords.map((item) => item.id),
                false,
              )
            "
          >
            取消结果
          </button>
        </div>
        <div class="word-grid">
          <label
            v-for="item in filteredWords"
            :key="item.id"
            :class="{ selected: selectedSet.has(item.id) }"
            ><input
              type="checkbox"
              :checked="selectedSet.has(item.id)"
              @change="setSelection([item.id], !selectedSet.has(item.id))" /><span>{{
              item.text
            }}</span
            ><Check v-if="selectedSet.has(item.id)"
          /></label>
        </div>
        <footer>
          <p :class="{ error: selectedIds.length < store.config.vocabulary.minWords }">
            至少选择 {{ store.config.vocabulary.minWords }} 个词条；搜索不会丢失其他选择。
          </p>
          <button
            class="secondary-action"
            type="button"
            @click="
              setSelection(
                store.vocabulary!.items.map((item) => item.id),
                true,
              )
            "
          >
            恢复默认全选</button
          ><button
            class="primary-action"
            type="button"
            :disabled="selectedIds.length < store.config.vocabulary.minWords"
            @click="saveVocabulary"
          >
            确认选择
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="showSettings && settingsDraft"
      class="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
    >
      <section class="game-dialog rules-dialog">
        <header>
          <div>
            <p class="step-label">ROOM SETTINGS</p>
            <h2 id="rules-title">房间规则</h2>
          </div>
          <button type="button" aria-label="关闭规则" @click="showSettings = false"><X /></button>
        </header>
        <div class="rule-edit-grid">
          <label
            >最大玩家数
            <select v-model="settingsDraft.maxPlayers">
              <option v-for="value in 5" :key="value" :value="value + 1">
                {{ value + 1 }} 人
              </option></select
            ><small>当前成员数以下的值不可保存</small></label
          >
          <label
            >每人作画次数
            <input
              v-model.number="settingsDraft.roundsPerPlayer"
              type="range"
              :min="store.config.game.roundsPerPlayer.min"
              :max="store.config.game.roundsPerPlayer.max"
              :step="store.config.game.roundsPerPlayer.step"
            /><b>{{ settingsDraft.roundsPerPlayer }} 轮</b></label
          >
          <label
            >作画时间
            <input
              v-model.number="settingsDraft.drawSeconds"
              type="range"
              :min="store.config.game.drawSeconds.min"
              :max="store.config.game.drawSeconds.max"
              :step="store.config.game.drawSeconds.step"
            /><b>{{ settingsDraft.drawSeconds }} 秒</b></label
          >
          <label
            >选词时间
            <input
              v-model.number="settingsDraft.chooseSeconds"
              type="range"
              :min="store.config.game.chooseSeconds.min"
              :max="store.config.game.chooseSeconds.max"
              :step="store.config.game.chooseSeconds.step"
            /><b>{{ settingsDraft.chooseSeconds }} 秒</b></label
          >
          <label
            >候选词数量
            <input
              v-model.number="settingsDraft.optionCount"
              type="range"
              :min="store.config.game.optionCount.min"
              :max="store.config.game.optionCount.max"
              :step="store.config.game.optionCount.step"
            /><b>{{ settingsDraft.optionCount }} 个</b></label
          >
          <label class="toggle-line"
            ><input v-model="settingsDraft.showWordLength" type="checkbox" /> 显示答案字数</label
          >
          <label class="toggle-line"
            ><input v-model="settingsDraft.progressiveHints" type="checkbox" /> 逐步提示字符</label
          >
          <label class="toggle-line"
            ><input v-model="settingsDraft.closeGuessEnabled" type="checkbox" /> 近似答案提示</label
          >
          <label class="toggle-line"
            ><input v-model="settingsDraft.allowPlayerInvite" type="checkbox" />
            普通玩家可邀请</label
          >
          <label class="toggle-line"
            ><input v-model="settingsDraft.allowPause" type="checkbox" /> 房主可暂停</label
          >
          <label
            >中途加入
            <select v-model="settingsDraft.joinPolicy">
              <option value="forbid">禁止</option>
              <option value="spectate">仅观战</option>
              <option value="next_game">下一局加入</option>
            </select></label
          >
        </div>
        <footer>
          <p>修改公平性规则会自动取消全员准备。</p>
          <button class="secondary-action" type="button" @click="showSettings = false">取消</button
          ><button class="primary-action" type="button" @click="saveSettings">保存规则</button>
        </footer>
      </section>
    </div>

    <div
      v-if="showInvite"
      class="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
    >
      <section class="game-dialog invite-dialog">
        <header>
          <div>
            <p class="step-label">INVITE</p>
            <h2 id="invite-title">邀请伙伴</h2>
          </div>
          <button type="button" aria-label="关闭邀请" @click="showInvite = false"><X /></button>
        </header>
        <div class="invite-content player-only">
          <div class="invite-player-list">
            <button
              v-for="player in availablePlayers"
              :key="player.id"
              type="button"
              @click="store.invite(player.id)"
            >
              <span
                class="solid-avatar"
                :style="{ backgroundColor: player.avatarColor }"
                :aria-label="`${player.nickname}的纯色头像`"
              ></span
              ><b>{{ player.nickname }}</b
              ><Send />
            </button>
            <p v-if="!availablePlayers.length">暂无空闲且允许接收邀请的在线玩家。</p>
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="showLeaveConfirm"
      class="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-title"
    >
      <section class="game-dialog confirm-dialog">
        <LogOut />
        <h2 id="leave-title">退出当前房间？</h2>
        <p>主动退出后当前座位会立即释放；房主退出时将迁移给最早加入的在线玩家。</p>
        <footer>
          <button class="secondary-action" type="button" @click="showLeaveConfirm = false">
            继续留在房间</button
          ><button class="danger-action" type="button" @click="store.leaveRoom">确认退出</button>
        </footer>
      </section>
    </div>
  </main>
</template>
