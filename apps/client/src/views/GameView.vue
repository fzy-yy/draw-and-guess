<!-- 对局统一骨架：画家与猜词者共享 HUD、画布和玩家区，仅按服务端角色快照切换权限。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Brush,
  CirclePause,
  CirclePlay,
  Clock3,
  Crown,
  Eraser,
  Eye,
  PaintBucket,
  RotateCcw,
  RotateCw,
  Send,
  Trash2,
  Trophy,
  Wifi,
  X,
} from 'lucide-vue-next'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS, type FillCommand, type Stroke, type ToolKind } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import GameCanvas from '@/components/GameCanvas.vue'

const store = useGameStore()
const now = ref(Date.now())
const guess = ref('')
const tool = ref<ToolKind>('pen')
const color = ref<string>(APP_CONFIG.drawing.defaultColor)
const width = ref<number>(APP_CONFIG.drawing.width.default)
const showClearConfirm = ref(false)
const showEndConfirm = ref(false)
let ticker = 0

const game = computed(() => store.room?.game)
const secondsLeft = computed(() =>
  game.value?.phaseEndsAt
    ? Math.max(0, Math.ceil((game.value.phaseEndsAt - now.value) / 1_000))
    : 0,
)
const progress = computed(() => {
  if (!game.value?.phaseEndsAt || game.value.phaseEndsAt <= game.value.phaseStartedAt) return 0
  return Math.max(
    0,
    Math.min(
      1,
      (game.value.phaseEndsAt - now.value) / (game.value.phaseEndsAt - game.value.phaseStartedAt),
    ),
  )
})
const canGuess = computed(
  () =>
    store.room?.phase === 'drawing' &&
    !store.isDrawer &&
    !store.me?.guessed &&
    store.me?.connection === 'online',
)
const phaseLabel = computed(
  () =>
    ({
      starting: '准备开始',
      choosing_word: '画家选词',
      drawing: '作画与猜词',
      round_result: '回合结算',
      paused: '游戏暂停',
      game_result: '最终结算',
      waiting: '等待',
      closed: '关闭',
    })[store.room?.phase ?? 'waiting'],
)
const drawer = computed(() =>
  store.room?.members.find((member) => member.id === game.value?.drawerId),
)
const rankings = computed(() => {
  const members = [...(store.room?.members ?? [])].sort((a, b) => b.score - a.score)
  let previous = -1
  let rank = 0
  return members.map((member, index) => {
    if (member.score !== previous) rank = index + 1
    previous = member.score
    return { ...member, rank }
  })
})

async function sendGuess(): Promise<void> {
  const text = guess.value.trim()
  if (!text || !canGuess.value) return
  guess.value = ''
  await store.submitGuess(text)
}
function submitStroke(stroke: Stroke): void {
  // 本地 Canvas 已即时显示笔画；网络失败时下一个权威快照会纠正画面。
  void store.sendStroke(stroke)
}
/** 填充点击由服务端校验并广播，所有客户端按相同历史重放封闭区域。 */
function submitFill(command: FillCommand): void {
  void store.sendFill(command)
}

/** 输入框、选择器及可编辑元素拥有键盘优先权，避免工具快捷键打断猜词或设置编辑。 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null
  return (
    element?.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
  )
}

/** 对比快捷键时统一忽略大小写和首尾空白。 */
function normalizedShortcut(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** 画家可用自定义单键切换工具；撤销与重做继续使用通用组合键。 */
function keyHandler(event: KeyboardEvent): void {
  if (!store.isDrawer || store.room?.phase !== 'drawing' || isEditableTarget(event.target)) return
  const key = event.key.toLocaleLowerCase()
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.preventDefault()
    void store.drawAction(event.shiftKey ? EVENTS.drawRedo : EVENTS.drawUndo)
    return
  }
  if ((event.ctrlKey || event.metaKey) && key === 'y') {
    event.preventDefault()
    void store.drawAction(EVENTS.drawRedo)
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return
  const shortcuts: Array<[ToolKind, string]> = [
    ['pen', store.settings.penShortcut],
    ['eraser', store.settings.eraserShortcut],
    ['fill', store.settings.fillShortcut],
  ]
  const matched = shortcuts.find(([, shortcut]) => normalizedShortcut(shortcut) === key)
  if (matched) {
    event.preventDefault()
    tool.value = matched[0]
  }
}
async function clearDrawing(): Promise<void> {
  await store.drawAction(EVENTS.drawClear)
  showClearConfirm.value = false
}

onMounted(() => {
  ticker = window.setInterval(() => (now.value = Date.now()), 200)
  window.addEventListener('keydown', keyHandler)
})
onBeforeUnmount(() => {
  window.clearInterval(ticker)
  window.removeEventListener('keydown', keyHandler)
})
</script>

<template>
  <main v-if="store.room && game" class="game-layout">
    <header class="game-hud">
      <div class="round-indicator">
        <span>ROUND</span
        ><b
          >{{ game.currentRound }} <small>/ {{ game.totalRounds }}</small></b
        >
      </div>
      <div class="drawer-indicator">
        <span
          class="solid-avatar"
          :style="{ backgroundColor: drawer?.avatarColor }"
          aria-label="当前画家纯色头像"
        ></span
        ><span
          >当前画家<b>{{ drawer?.nickname || '即将揭晓' }}</b></span
        >
      </div>
      <div class="answer-hud">
        <span>{{ store.isDrawer && game.answer ? '你的题目' : '猜猜这是什么' }}</span
        ><b>{{ store.isDrawer && game.answer ? game.answer : game.answerMask || '等待选词…' }}</b>
      </div>
      <div class="timer-hud" :class="{ urgent: secondsLeft <= 10 && secondsLeft > 0 }">
        <Clock3 /><b>{{ secondsLeft }}</b
        ><span>秒</span><i :style="{ transform: `scaleX(${progress})` }"></i>
      </div>
      <div class="game-network">
        <Wifi /><span
          >{{ store.connectionLabel }}<small>{{ store.latency || '—' }} ms</small></span
        >
      </div>
      <button
        v-if="store.room.phase !== 'paused'"
        class="hud-square"
        type="button"
        :aria-label="store.isHost ? '暂停游戏' : '请求房主暂停'"
        @click="store.pause(store.isHost ? '房主暂停了游戏' : '希望短暂暂停')"
      >
        <CirclePause />
      </button>
      <button
        v-if="store.isHost && store.room.phase === 'paused'"
        class="hud-square"
        type="button"
        aria-label="继续游戏"
        @click="store.resume"
      >
        <CirclePlay />
      </button>
    </header>

    <aside class="score-strip" aria-label="玩家得分">
      <article
        v-for="member in store.room.members"
        :key="member.id"
        :class="{
          active: member.isDrawer,
          guessed: member.guessed,
          offline: member.connection === 'reconnecting',
        }"
      >
        <div class="score-avatar">
          <span
            class="solid-avatar"
            :style="{ backgroundColor: member.avatarColor }"
            :aria-label="`${member.nickname}的纯色头像`"
          ></span
          ><Brush v-if="member.isDrawer" /><Eye v-else-if="member.guessed" />
        </div>
        <div>
          <b>{{ member.nickname }}</b
          ><span>{{ member.score }} 分</span>
        </div>
        <Crown v-if="member.isHost" aria-label="房主" />
      </article>
    </aside>

    <section class="canvas-zone">
      <GameCanvas
        :strokes="game.strokes"
        :undone-stroke-ids="game.undoneStrokeIds"
        :can-draw="store.isDrawer && store.room.phase === 'drawing'"
        :tool="tool"
        :color="color"
        :width="width"
        @stroke="submitStroke"
        @fill="submitFill"
        @width-change="width = $event"
      />
      <div v-if="store.room.phase !== 'drawing'" class="canvas-status">
        <Brush /><b>{{ phaseLabel }}</b
        ><span v-if="store.room.phase === 'choosing_word' && !store.isDrawer"
          >画家正在选择题目</span
        >
      </div>
    </section>

    <aside class="chat-zone">
      <header>
        <div>
          <span>LIVE CHAT</span>
          <h2>猜词消息</h2>
        </div>
        <span>{{ store.me?.guessed ? '已猜中' : store.isDrawer ? '作画中' : '猜词中' }}</span>
      </header>
      <div class="message-list" aria-live="polite">
        <div v-for="message in game.messages" :key="message.id" :class="`message ${message.type}`">
          <b v-if="message.playerId">{{
            store.room.members.find((member) => member.id === message.playerId)?.nickname
          }}</b>
          <span>{{ message.text }}</span>
        </div>
        <div v-if="!game.messages.length" class="no-messages">
          <Send /><span>回合消息会显示在这里</span>
        </div>
      </div>
      <form v-if="canGuess" class="guess-form" @submit.prevent="sendGuess">
        <label for="guess-input">输入你的答案</label>
        <div>
          <input
            id="guess-input"
            v-model="guess"
            maxlength="60"
            autocomplete="off"
            placeholder="按 Enter 发送猜词"
            autofocus
          /><button type="submit" :disabled="!guess.trim()" aria-label="发送猜词"><Send /></button>
        </div>
      </form>
      <div v-else class="preset-zone">
        <p>
          {{
            store.isDrawer
              ? '画家不能发送文字，可使用安全互动短语'
              : store.me?.guessed
                ? '你已猜中，只能发送安全互动短语'
                : '等待作画阶段开始'
          }}
        </p>
        <div>
          <button
            v-for="preset in store.config.presets.safeChat"
            :key="preset"
            type="button"
            :disabled="store.room.phase !== 'drawing'"
            @click="store.sendPreset(preset)"
          >
            {{ preset }}
          </button>
        </div>
      </div>
    </aside>

    <footer
      class="drawing-toolbar"
      :class="{ disabled: !store.isDrawer || store.room.phase !== 'drawing' }"
    >
      <div class="tool-group">
        <span>工具</span>
        <button
          type="button"
          :class="{ selected: tool === 'pen' }"
          :disabled="!store.isDrawer"
          :aria-label="`画笔，快捷键 ${store.settings.penShortcut}`"
          @click="tool = 'pen'"
        >
          <Brush />画笔<kbd v-if="store.settings.showShortcuts">{{
            store.settings.penShortcut
          }}</kbd>
        </button>
        <button
          type="button"
          :class="{ selected: tool === 'eraser' }"
          :disabled="!store.isDrawer"
          :aria-label="`橡皮擦，快捷键 ${store.settings.eraserShortcut}`"
          @click="tool = 'eraser'"
        >
          <Eraser />橡皮擦<kbd v-if="store.settings.showShortcuts">{{
            store.settings.eraserShortcut
          }}</kbd>
        </button>
        <button
          type="button"
          :class="{ selected: tool === 'fill' }"
          :disabled="!store.isDrawer"
          :aria-label="`区域填充，快捷键 ${store.settings.fillShortcut}`"
          @click="tool = 'fill'"
        >
          <PaintBucket />填充<kbd v-if="store.settings.showShortcuts">{{
            store.settings.fillShortcut
          }}</kbd>
        </button>
      </div>
      <div class="color-group">
        <span>颜色</span>
        <button
          v-for="paint in store.config.drawing.colors"
          :key="paint"
          type="button"
          :class="{ selected: color.toUpperCase() === paint }"
          :style="{ '--paint': paint }"
          :aria-label="`选择预设颜色 ${paint}`"
          :disabled="!store.isDrawer"
          @click="color = paint"
        ></button>
        <label class="custom-paint" title="选择任意画笔或填充颜色">
          <input
            v-model="color"
            type="color"
            :disabled="!store.isDrawer"
            aria-label="选择任意绘图颜色"
          />
        </label>
      </div>
      <label class="width-group">
        <span>线宽 {{ width }}</span>
        <input
          v-model.number="width"
          type="range"
          :min="store.config.drawing.width.min"
          :max="store.config.drawing.width.max"
          :step="store.config.drawing.width.step"
          :disabled="!store.isDrawer || tool === 'fill'"
          aria-label="画笔与橡皮擦共用粗细"
        />
        <i
          class="width-preview"
          :style="{ width: `${Math.min(width, 20)}px`, height: `${Math.min(width, 20)}px` }"
        ></i>
      </label>
      <div class="history-group">
        <button
          type="button"
          :disabled="!store.isDrawer"
          aria-label="撤销 Ctrl+Z"
          @click="store.drawAction(EVENTS.drawUndo)"
        >
          <RotateCcw /> 撤销</button
        ><button
          type="button"
          :disabled="!store.isDrawer"
          aria-label="重做 Ctrl+Shift+Z"
          @click="store.drawAction(EVENTS.drawRedo)"
        >
          <RotateCw /> 重做</button
        ><button
          type="button"
          :disabled="!store.isDrawer"
          aria-label="清空画板"
          @click="showClearConfirm = true"
        >
          <Trash2 /> 清空
        </button>
      </div>
    </footer>

    <div v-if="store.room.phase === 'starting'" class="stage-overlay countdown-overlay">
      <span>游戏即将开始</span><b>{{ secondsLeft }}</b>
      <p>画家顺序和首个回合由服务器统一确定</p>
    </div>
    <div v-if="store.room.phase === 'choosing_word' && store.isDrawer" class="stage-overlay">
      <section class="word-choice">
        <Brush />
        <p>轮到你作画了</p>
        <h2>选择一个词</h2>
        <div>
          <button
            v-for="option in game.wordOptions"
            :key="option.id"
            type="button"
            @click="store.chooseWord(option.id)"
          >
            {{ option.text }}
          </button>
        </div>
        <span>{{ secondsLeft }} 秒后将自动选择</span>
      </section>
    </div>
    <div v-if="store.room.phase === 'paused'" class="stage-overlay">
      <section class="pause-panel">
        <CirclePause />
        <p>游戏已安全暂停</p>
        <h2>所有计时已由服务器冻结</h2>
        <span>等待房主继续；断线玩家可在宽限期内恢复座位。</span>
        <div v-if="store.isHost">
          <button class="primary-action" type="button" @click="store.resume">
            <CirclePlay />继续游戏</button
          ><button class="danger-action" type="button" @click="showEndConfirm = true">
            提前结束
          </button>
        </div>
      </section>
    </div>
    <div v-if="store.room.phase === 'round_result' && game.roundResult" class="stage-overlay">
      <section class="round-result-panel">
        <p>本回合答案</p>
        <h2>{{ game.roundResult.answer }}</h2>
        <div class="score-details">
          <article v-for="detail in game.roundResult.details" :key="detail.playerId">
            <b>{{ store.room.members.find((member) => member.id === detail.playerId)?.nickname }}</b
            ><span>基础 {{ detail.base }}</span
            ><span>速度 +{{ detail.speed }}</span
            ><span>顺序 +{{ detail.order }}</span
            ><strong>+{{ detail.total }}</strong>
          </article>
          <p v-if="!game.roundResult.details.length">本回合无人猜中，再接再厉！</p>
        </div>
        <span
          >画家本回合获得 {{ game.roundResult.drawerScore }} 分 · {{ secondsLeft }} 秒后继续</span
        >
      </section>
    </div>
    <div v-if="store.room.phase === 'game_result'" class="stage-overlay">
      <section class="final-result-panel">
        <Trophy />
        <p>GAME RESULT</p>
        <h2>最终排行</h2>
        <div class="ranking-list">
          <article
            v-for="member in rankings"
            :key="member.id"
            :class="{ winner: member.rank === 1 }"
          >
            <b>#{{ member.rank }}</b
            ><span
              class="solid-avatar"
              :style="{ backgroundColor: member.avatarColor }"
              :aria-label="`${member.nickname}的纯色头像`"
            ></span
            ><span
              >{{ member.nickname
              }}<small
                >猜中 {{ member.stats.correctCount }} 次 · 平均
                {{
                  member.stats.correctCount
                    ? Math.round(member.stats.totalGuessMs / member.stats.correctCount / 1000)
                    : 0
                }}
                秒 · 作画带猜中 {{ member.stats.drawingCorrectCount }} 人次</small
              ></span
            ><strong>{{ member.score }} 分</strong>
          </article>
        </div>
        <div>
          <button
            v-if="store.isHost"
            class="primary-action"
            type="button"
            @click="store.returnWaiting"
          >
            返回房间 · 再来一局</button
          ><button class="secondary-action" type="button" @click="store.leaveRoom">退出房间</button>
        </div>
      </section>
    </div>

    <div v-if="showClearConfirm" class="stage-overlay">
      <section class="game-dialog confirm-dialog">
        <Trash2 />
        <h2>清空整个画板？</h2>
        <p>这会清除本回合全部笔画；操作将由服务端广播给所有玩家。</p>
        <footer>
          <button class="secondary-action" type="button" @click="showClearConfirm = false">
            取消</button
          ><button class="danger-action" type="button" @click="clearDrawing">确认清空</button>
        </footer>
      </section>
    </div>
    <div v-if="showEndConfirm" class="stage-overlay">
      <section class="game-dialog confirm-dialog">
        <X />
        <h2>提前结束本局？</h2>
        <p>所有玩家将立即进入提前结算，当前分数会保留。</p>
        <footer>
          <button class="secondary-action" type="button" @click="showEndConfirm = false">
            取消</button
          ><button class="danger-action" type="button" @click="store.endEarly">确认结束</button>
        </footer>
      </section>
    </div>
  </main>
</template>
