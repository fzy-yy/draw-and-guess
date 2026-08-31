<!-- 对局统一骨架：画家与猜词者共享 HUD、画布和玩家区，仅按服务端角色快照切换权限。 -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Brush,
  CirclePause,
  CirclePlay,
  Clock3,
  Crown,
  Eraser,
  Eye,
  Maximize,
  Minimize,
  PaintBucket,
  RotateCcw,
  RotateCw,
  Send,
  Settings,
  Trash2,
  Trophy,
  Wifi,
  X,
} from 'lucide-vue-next'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, type FillCommand, type Stroke } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import AvatarImage from '@/components/AvatarImage.vue'
import GameCanvas from '@/components/GameCanvas.vue'
import GameSettingsDialog from '@/components/GameSettingsDialog.vue'
import { useGameHud } from '@/composables/useGameHud'
import { useShortcuts } from '@/composables/useShortcuts'

const store = useGameStore()
// ---- 对局 HUD（计时/进度/权限/排行等，含 ticker 生命周期，见 composables/useGameHud.ts）----
const { game, secondsLeft, progress, canGuess, phaseLabel, drawer, rankings } = useGameHud(store)
// ---- 画板快捷键与工具切换（含 keydown 监听生命周期，见 composables/useShortcuts.ts）----
const { tool } = useShortcuts(store)

// ---- 对局本地 UI 状态 ----
const guess = ref('') // 猜词输入框内容
const color = ref<string>(APP_CONFIG.drawing.defaultColor) // 当前画笔/填充颜色
const width = ref<number>(APP_CONFIG.drawing.width.default) // 当前线宽
const showClearConfirm = ref(false) // 清空确认弹窗
const showEndConfirm = ref(false) // 提前结束确认弹窗
const showGameSettings = ref(false) // 对局内设置弹窗
const isFullscreen = ref(Boolean(document.fullscreenElement))
const messageList = ref<HTMLElement>()
const shouldFollowMessages = ref(true)

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

async function clearDrawing(): Promise<void> {
  await store.drawAction(EVENTS.drawClear)
  showClearConfirm.value = false
}

/** 全屏目标为根游戏舞台，确保 Toast、弹窗和竖屏提示仍包含在全屏上下文中。 */
async function toggleFullscreen(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('.game-stage')
  if (!stage) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await stage.requestFullscreen()
  } catch {
    store.notify(strings.game.fullscreenFailed, 'warning')
  }
}

/** 用户接近列表底部时跟随新消息；主动上滚后保留阅读位置。 */
function handleMessageScroll(): void {
  const element = messageList.value
  if (!element) return
  shouldFollowMessages.value = element.scrollHeight - element.scrollTop - element.clientHeight < 32
}
async function scrollMessagesToBottom(force = false): Promise<void> {
  await nextTick()
  const element = messageList.value
  if (element && (force || shouldFollowMessages.value)) element.scrollTop = element.scrollHeight
}
function handleFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}
onMounted(() => document.addEventListener('fullscreenchange', handleFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', handleFullscreenChange))
watch(
  () => game.value?.messages.at(-1)?.id,
  () => void scrollMessagesToBottom(),
  { immediate: true },
)

// D2：按“自动聚焦猜词框”开关在进入可猜词状态时聚焦输入框（替代静态 autofocus）
const guessInput = ref<HTMLInputElement>()
watch(
  () =>
    store.room?.phase === 'drawing' &&
    !store.isDrawer &&
    !store.me?.guessed &&
    !store.me?.spectating,
  (canGuessNow) => {
    if (canGuessNow && store.settings.autoFocusGuess) void nextTick(() => guessInput.value?.focus())
  },
  { immediate: true },
)
</script>

<template>
  <!-- 对局主骨架：仅在房间存在且对局未结束时渲染 -->
  <main v-if="store.room && game" class="game-layout">
    <!-- 顶栏 HUD：回合数、当前画家、答案、计时器、网络状态与暂停按钮 -->
    <header class="game-hud">
      <!-- 回合指示：当前回合/总回合 -->
      <div class="round-indicator">
        <span>{{ strings.game.roundLabel }}</span
        ><b
          >{{ game.currentRound }} <small>/ {{ game.totalRounds }}</small></b
        >
      </div>
      <!-- 当前画家指示：头像 + 昵称 -->
      <div class="drawer-indicator">
        <AvatarImage :avatar-id="drawer?.avatarId" :label="strings.game.drawerAvatarAria" />
        ><span
          >{{ strings.game.drawerLabel
          }}<b>{{ drawer?.nickname || strings.game.drawerPending }}</b></span
        >
      </div>
      <!-- 答案展示：画家看自己的题目，猜词者看遮罩 -->
      <div class="answer-hud">
        <span>{{
          store.isDrawer && game.answer ? strings.game.yourWord : strings.game.guessPrompt
        }}</span
        ><b>{{
          store.isDrawer && game.answer ? game.answer : game.answerMask || strings.game.awaitingWord
        }}</b>
      </div>
      <!-- 计时器：剩余秒数 + 进度条；最后 10 秒进入紧急样式 -->
      <div class="timer-hud" :class="{ urgent: secondsLeft <= 10 && secondsLeft > 0 }">
        <Clock3 /><b>{{ secondsLeft }}</b
        ><span>{{ strings.game.secondsSuffix }}</span
        ><i :style="{ transform: `scaleX(${progress})` }"></i>
      </div>
      <!-- 网络状态：连接标签 + 延迟 -->
      <div class="game-network">
        <Wifi /><span
          >{{ store.connectionLabel }}<small>{{ store.latency || '—' }} ms</small></span
        >
      </div>
      <!-- 右上角操作组：暂停/继续、设置、进入或退出全屏。 -->
      <div class="hud-actions-group">
        <button
          v-if="store.room.phase !== 'paused'"
          class="hud-square"
          type="button"
          :aria-label="store.isHost ? strings.game.pauseAriaHost : strings.game.pauseAriaGuest"
          @click="
            store.pause(store.isHost ? strings.game.pauseReasonHost : strings.game.pauseReasonGuest)
          "
        >
          <CirclePause />
        </button>
        <button
          v-if="store.isHost && store.room.phase === 'paused'"
          class="hud-square"
          type="button"
          :aria-label="strings.game.resumeAria"
          @click="store.resume"
        >
          <CirclePlay />
        </button>
        <button
          class="hud-square"
          type="button"
          :aria-label="strings.game.settingsAria"
          @click="showGameSettings = true"
        >
          <Settings />
        </button>
        <button
          class="hud-square"
          type="button"
          :aria-label="
            isFullscreen ? strings.game.exitFullscreenAria : strings.game.enterFullscreenAria
          "
          @click="toggleFullscreen"
        >
          <Minimize v-if="isFullscreen" /><Maximize v-else />
        </button>
      </div>
    </header>

    <!-- 左侧玩家得分条：列出全部成员、得分与画家/猜中标记 -->
    <aside class="score-strip" :aria-label="strings.game.scoreStripAria">
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
          <AvatarImage
            :avatar-id="member.avatarId"
            :label="strings.common.playerAvatarAria(member.nickname)"
          />
          ><Brush v-if="member.isDrawer" /><Eye v-else-if="member.guessed" />
        </div>
        <div>
          <b>{{ member.nickname }}</b
          ><span>{{ strings.common.scoreUnit(member.score) }}</span>
        </div>
        <Crown v-if="member.isHost" :aria-label="strings.game.hostMarkAria" />
      </article>
    </aside>

    <!-- 中央画布区：实时画板 + 非作画阶段的状态提示遮罩 -->
    <section class="canvas-zone">
      <GameCanvas
        :strokes="game.strokes"
        :undone-stroke-ids="game.undoneStrokeIds"
        :last-sequence="game.lastSequence"
        :can-draw="store.isDrawer && store.room.phase === 'drawing'"
        :tool="tool"
        :color="color"
        :width="width"
        @stroke="submitStroke"
        @fill="submitFill"
        @width-change="width = $event"
      />
      <!-- 画布状态遮罩：选词/结算/暂停等非作画阶段覆盖在画布上 -->
      <div v-if="store.room.phase !== 'drawing'" class="canvas-status">
        <Brush /><b>{{ phaseLabel }}</b
        ><span v-if="store.room.phase === 'choosing_word' && !store.isDrawer">{{
          strings.game.choosingHint
        }}</span>
      </div>
    </section>

    <!-- 右侧聊天区：消息列表 + 猜词输入 / 安全预设短语 -->
    <aside class="chat-zone">
      <header>
        <div>
          <span>{{ strings.game.liveChatLabel }}</span>
          <h2>{{ strings.game.chatTitle }}</h2>
        </div>
        <!-- 当前角色标签：观战中 / 已猜中 / 作画中 / 猜词中 -->
        <span>{{
          store.me?.spectating
            ? strings.status.roleSpectating
            : store.me?.guessed
              ? strings.status.roleGuessed
              : store.isDrawer
                ? strings.status.roleDrawing
                : strings.status.roleGuessing
        }}</span>
      </header>
      <!-- 消息列表：猜词、系统、猜中、预设等类型分别高亮 -->
      <div ref="messageList" class="message-list" aria-live="polite" @scroll="handleMessageScroll">
        <div v-for="message in game.messages" :key="message.id" :class="`message ${message.type}`">
          <!-- 玩家消息显示发送者昵称 -->
          <b v-if="message.playerId">{{
            store.room.members.find((member) => member.id === message.playerId)?.nickname
          }}</b>
          <span>{{ message.text }}</span>
        </div>
        <div v-if="!game.messages.length" class="no-messages">
          <Send /><span>{{ strings.game.noMessages }}</span>
        </div>
      </div>
      <!-- 猜词输入表单：仅可猜词的玩家显示 -->
      <form v-if="canGuess" class="guess-form" @submit.prevent="sendGuess">
        <label for="guess-input">{{ strings.game.guessLabel }}</label>
        <div>
          <input
            id="guess-input"
            ref="guessInput"
            v-model="guess"
            maxlength="60"
            autocomplete="off"
            :placeholder="strings.game.guessPlaceholder"
          /><button
            type="submit"
            :disabled="!guess.trim()"
            :aria-label="strings.game.sendGuessAria"
          >
            <Send />
          </button>
        </div>
      </form>
      <!-- 安全短语区：画家 / 已猜中者 / 观战者不能发送文字 -->
      <div v-else class="preset-zone">
        <p>
          {{
            store.isDrawer
              ? strings.game.drawerChatHint
              : store.me?.spectating
                ? strings.game.spectatorChatHint
                : store.me?.guessed
                  ? strings.game.guessedChatHint
                  : strings.game.waitingChatHint
          }}
        </p>
        <div>
          <button
            v-for="preset in store.config.presets.safeChat"
            :key="preset"
            type="button"
            :disabled="store.room.phase !== 'drawing' || store.me?.spectating"
            @click="store.sendPreset(preset)"
          >
            {{ preset }}
          </button>
        </div>
      </div>
    </aside>

    <!-- 底部绘图工具栏：工具 / 颜色 / 线宽 / 历史操作（非画家时整条禁用） -->
    <footer
      class="drawing-toolbar"
      :class="{ disabled: !store.isDrawer || store.room.phase !== 'drawing' }"
    >
      <!-- 工具组：画笔 / 橡皮擦 / 填充，可自定义快捷键 -->
      <div class="tool-group">
        <span>{{ strings.game.toolGroup }}</span>
        <button
          type="button"
          :class="{ selected: tool === 'pen' }"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.penAria(store.settings.penShortcut)"
          @click="tool = 'pen'"
        >
          <Brush />{{ strings.game.penTool
          }}<kbd v-if="store.settings.showShortcuts">{{ store.settings.penShortcut }}</kbd>
        </button>
        <button
          type="button"
          :class="{ selected: tool === 'eraser' }"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.eraserAria(store.settings.eraserShortcut)"
          @click="tool = 'eraser'"
        >
          <Eraser />{{ strings.game.eraserTool
          }}<kbd v-if="store.settings.showShortcuts">{{ store.settings.eraserShortcut }}</kbd>
        </button>
        <button
          type="button"
          :class="{ selected: tool === 'fill' }"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.fillAria(store.settings.fillShortcut)"
          @click="tool = 'fill'"
        >
          <PaintBucket />{{ strings.game.fillTool
          }}<kbd v-if="store.settings.showShortcuts">{{ store.settings.fillShortcut }}</kbd>
        </button>
      </div>
      <!-- 颜色组：预设色块 + 任意颜色选择器 -->
      <div class="color-group">
        <span>{{ strings.game.colorGroup }}</span>
        <button
          v-for="paint in store.config.drawing.colors"
          :key="paint"
          type="button"
          :class="{ selected: color.toUpperCase() === paint }"
          :style="{ '--paint': paint }"
          :aria-label="strings.game.presetColorAria(paint)"
          :disabled="!store.isDrawer"
          @click="color = paint"
        ></button>
        <label class="custom-paint" :title="strings.game.customColorTitle">
          <input
            v-model="color"
            type="color"
            :disabled="!store.isDrawer"
            :aria-label="strings.game.customColorAria"
          />
        </label>
      </div>
      <!-- 线宽滑块：画笔与橡皮擦共用；填充工具下禁用 -->
      <label class="width-group">
        <span>{{ strings.game.widthLabel(width) }}</span>
        <input
          v-model.number="width"
          type="range"
          :min="store.config.drawing.width.min"
          :max="store.config.drawing.width.max"
          :step="store.config.drawing.width.step"
          :disabled="!store.isDrawer || tool === 'fill'"
          :aria-label="strings.game.widthAria"
        />
        <i
          class="width-preview"
          :style="{ width: `${Math.min(width, 20)}px`, height: `${Math.min(width, 20)}px` }"
        ></i>
      </label>
      <!-- 历史操作组：撤销 / 重做 / 清空 -->
      <div class="history-group">
        <button
          type="button"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.undoAria"
          @click="store.drawAction(EVENTS.drawUndo)"
        >
          <RotateCcw /> {{ strings.game.undo }}</button
        ><button
          type="button"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.redoAria"
          @click="store.drawAction(EVENTS.drawRedo)"
        >
          <RotateCw /> {{ strings.game.redo }}</button
        ><button
          type="button"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.clearAria"
          @click="showClearConfirm = true"
        >
          <Trash2 /> {{ strings.game.clear }}
        </button>
      </div>
    </footer>

    <!-- 对局内设置使用舞台模态框，不离开当前游戏视图。 -->
    <GameSettingsDialog :open="showGameSettings" @close="showGameSettings = false" />

    <!-- 阶段遮罩：开局倒计时 -->
    <div v-if="store.room.phase === 'starting'" class="stage-overlay countdown-overlay">
      <span>{{ strings.game.countdownTitle }}</span
      ><b>{{ secondsLeft }}</b>
      <p>{{ strings.game.countdownHint }}</p>
    </div>
    <!-- 阶段遮罩：画家选词（只有画家可见候选词按钮） -->
    <div v-if="store.room.phase === 'choosing_word' && store.isDrawer" class="stage-overlay">
      <section class="word-choice">
        <Brush />
        <p>{{ strings.game.yourTurn }}</p>
        <h2>{{ strings.game.chooseWordTitle }}</h2>
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
        <span>{{ strings.game.autoChoose(secondsLeft) }}</span>
      </section>
    </div>
    <!-- 阶段遮罩：游戏暂停（房主可继续或提前结束） -->
    <div v-if="store.room.phase === 'paused'" class="stage-overlay">
      <section class="pause-panel">
        <CirclePause />
        <p>{{ strings.game.pausedTitle }}</p>
        <h2>{{ strings.game.pausedSubtitle }}</h2>
        <span>{{ strings.game.pausedHint }}</span>
        <div v-if="store.isHost">
          <button class="primary-action" type="button" @click="store.resume">
            <CirclePlay />{{ strings.game.resumeGame }}</button
          ><button class="danger-action" type="button" @click="showEndConfirm = true">
            {{ strings.game.endEarly }}
          </button>
        </div>
      </section>
    </div>
    <!-- 阶段遮罩：回合结算（答案、得分明细） -->
    <div v-if="store.room.phase === 'round_result' && game.roundResult" class="stage-overlay">
      <section class="round-result-panel">
        <p>{{ strings.game.roundAnswerLabel }}</p>
        <h2>{{ game.roundResult.answer }}</h2>
        <div class="score-details">
          <article v-for="detail in game.roundResult.details" :key="detail.playerId">
            <b>{{ store.room.members.find((member) => member.id === detail.playerId)?.nickname }}</b
            ><span>{{ strings.game.scoreBase(detail.base) }}</span
            ><span>{{ strings.game.scoreSpeed(detail.speed) }}</span
            ><span>{{ strings.game.scoreOrder(detail.order) }}</span
            ><strong>{{ strings.game.scoreTotal(detail.total) }}</strong>
          </article>
          <p v-if="!game.roundResult.details.length">{{ strings.game.noGuesses }}</p>
        </div>
        <span>{{ strings.game.drawerScoreLine(game.roundResult.drawerScore, secondsLeft) }}</span>
      </section>
    </div>
    <!-- 阶段遮罩：最终结算（排行榜、统计） -->
    <div v-if="store.room.phase === 'game_result'" class="stage-overlay">
      <section class="final-result-panel">
        <Trophy />
        <p>{{ strings.game.gameResultLabel }}</p>
        <h2>{{ strings.game.finalRanking }}</h2>
        <div class="ranking-list">
          <article
            v-for="member in rankings"
            :key="member.id"
            :class="{ winner: member.rank === 1 }"
          >
            <b>#{{ member.rank }}</b
            ><AvatarImage
              :avatar-id="member.avatarId"
              :label="strings.common.playerAvatarAria(member.nickname)"
            />
            ><span
              >{{ member.nickname
              }}<small>{{
                strings.game.playerStats(
                  member.stats.correctCount,
                  member.stats.correctCount
                    ? Math.round(member.stats.totalGuessMs / member.stats.correctCount / 1000)
                    : 0,
                  member.stats.drawingCorrectCount,
                )
              }}</small></span
            ><strong>{{ strings.common.scoreUnit(member.score) }}</strong>
          </article>
        </div>
        <div>
          <button
            v-if="store.isHost"
            class="primary-action"
            type="button"
            @click="store.returnWaiting"
          >
            {{ strings.game.backToRoom }}</button
          ><button class="secondary-action" type="button" @click="store.leaveRoom">
            {{ strings.game.leaveRoom }}
          </button>
        </div>
      </section>
    </div>

    <!-- 确认弹窗：清空画板 -->
    <Transition name="modal">
      <div v-if="showClearConfirm" class="stage-overlay">
        <section class="game-dialog confirm-dialog">
          <Trash2 />
          <h2>{{ strings.game.clearCanvasTitle }}</h2>
          <p>{{ strings.game.clearCanvasBody }}</p>
          <footer>
            <button class="secondary-action" type="button" @click="showClearConfirm = false">
              {{ strings.common.cancel }}</button
            ><button class="danger-action" type="button" @click="clearDrawing">
              {{ strings.game.confirmClear }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
    <!-- 确认弹窗：提前结束本局 -->
    <Transition name="modal">
      <div v-if="showEndConfirm" class="stage-overlay">
        <section class="game-dialog confirm-dialog">
          <X />
          <h2>{{ strings.game.endGameTitle }}</h2>
          <p>{{ strings.game.endGameBody }}</p>
          <footer>
            <button class="secondary-action" type="button" @click="showEndConfirm = false">
              {{ strings.common.cancel }}</button
            ><button class="danger-action" type="button" @click="store.endEarly">
              {{ strings.game.confirmEnd }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </main>
</template>
