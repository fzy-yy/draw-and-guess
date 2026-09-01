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
  <main
    v-if="store.room && game"
    class="grid h-full grid-cols-[17%_minmax(0,61%)_22%] grid-rows-[11%_minmax(0,76%)_13%] bg-[#cbd5e1]"
  >
    <!-- 顶栏 HUD：回合数、当前画家、答案、计时器、网络状态与暂停按钮 -->
    <header
      class="col-span-full grid grid-cols-[auto_minmax(0,1fr)_minmax(12cqw,2fr)_auto_auto_auto] items-center gap-[1.3em] border-b-[0.45cqh] border-yellow bg-navy px-[1.2cqw] text-white"
    >
      <!-- 回合指示：当前回合/总回合 -->
      <div class="flex flex-col text-[#93c5fd] text-[0.65em]">
        <span>{{ strings.game.roundLabel }}</span
        ><b class="text-white text-[2em]"
          >{{ game.currentRound }}
          <small class="text-[0.55em] text-[#bfdbfe]">/ {{ game.totalRounds }}</small></b
        >
      </div>
      <!-- 当前画家指示：头像 + 昵称 -->
      <div class="flex items-center gap-[0.55em] min-w-0">
        <AvatarImage
          class="h-[5.2cqh] w-[5.2cqh]"
          :avatar-id="drawer?.avatarId"
          :label="strings.game.drawerAvatarAria"
        />
        ><span class="min-w-0 flex flex-col text-[#93c5fd] text-[0.62em]"
          >{{ strings.game.drawerLabel
          }}<b class="overflow-hidden text-ellipsis whitespace-nowrap text-white text-[1.5em]">{{
            drawer?.nickname || strings.game.drawerPending
          }}</b></span
        >
      </div>
      <!-- 答案展示：画家看自己的题目，猜词者看遮罩 -->
      <div class="justify-self-center min-w-[16cqw] flex flex-col items-center">
        <span class="text-[#93c5fd] text-[0.6em]">{{
          store.isDrawer && game.answer ? strings.game.yourWord : strings.game.guessPrompt
        }}</span
        ><b class="min-h-[3.8cqh] flex items-center text-yellow text-[1.45em] tracking-[0.16em]">{{
          store.isDrawer && game.answer ? game.answer : game.answerMask || strings.game.awaitingWord
        }}</b>
      </div>
      <!-- 计时器：剩余秒数 + 进度条；最后 10 秒进入紧急样式 -->
      <div
        class="relative flex h-[6.5cqh] min-w-[7cqw] items-center justify-center gap-[0.3em] overflow-hidden rounded-[0.65em] bg-white/10"
        :class="{ '!bg-[#7f1d1d]': secondsLeft <= 10 && secondsLeft > 0 }"
      >
        <Clock3 /><b class="text-[1.65em]">{{ secondsLeft }}</b
        ><span class="text-[0.6em] text-[#bfdbfe]">{{ strings.game.secondsSuffix }}</span
        ><i
          class="absolute bottom-0 left-0 h-[0.45cqh] w-full bg-green [transform-origin:left]"
          :class="{ '!bg-yellow': secondsLeft <= 10 && secondsLeft > 0 }"
          :style="{ transform: `scaleX(${progress})` }"
        ></i>
      </div>
      <!-- 网络状态：连接标签 + 延迟 -->
      <div class="flex items-center gap-[0.45em] text-[#bfdbfe] text-[0.7em]">
        <Wifi /><span class="flex flex-col"
          >{{ store.connectionLabel }}<small>{{ store.latency || '—' }} ms</small></span
        >
      </div>
      <!-- 右上角操作组：暂停/继续、设置、进入或退出全屏。 -->
      <div class="flex items-center gap-[0.45em]">
        <button
          v-if="store.room.phase !== 'paused'"
          class="grid h-[4.4cqh] w-[4.4cqh] place-items-center rounded-[0.6em] bg-white/10 text-white"
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
          class="grid h-[4.4cqh] w-[4.4cqh] place-items-center rounded-[0.6em] bg-white/10 text-white"
          type="button"
          :aria-label="strings.game.resumeAria"
          @click="store.resume"
        >
          <CirclePlay />
        </button>
        <button
          class="grid h-[4.4cqh] w-[4.4cqh] place-items-center rounded-[0.6em] bg-white/10 text-white"
          type="button"
          :aria-label="strings.game.settingsAria"
          @click="showGameSettings = true"
        >
          <Settings />
        </button>
        <button
          class="grid h-[4.4cqh] w-[4.4cqh] place-items-center rounded-[0.6em] bg-white/10 text-white"
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
    <aside
      class="flex min-w-0 flex-col gap-[0.8cqh] border-r-[0.2cqh] border-slate-400 bg-slate-100 px-[0.8cqw] py-[1.7cqh]"
      :aria-label="strings.game.scoreStripAria"
    >
      <article
        v-for="member in store.room.members"
        :key="member.id"
        class="grid min-h-[8.5cqh] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.55em] border-l-[0.35cqh] border-slate-400 bg-white px-[0.5em] py-[0.55cqh]"
        :class="{
          '!border-l-orange !bg-[#fff7ed]': member.isDrawer,
          '!border-l-green !bg-[#f0fdf4]': member.guessed,
          'opacity-55 border-dashed': member.connection === 'reconnecting',
        }"
      >
        <div class="relative">
          <AvatarImage
            class="h-[5.8cqh] w-[5.8cqh]"
            :avatar-id="member.avatarId"
            :label="strings.common.playerAvatarAria(member.nickname)"
          />
          ><Brush
            v-if="member.isDrawer"
            class="absolute -right-[0.3cqh] -bottom-[0.2cqh] h-[2.4cqh] w-[2.4cqh] p-[0.35cqh] text-white bg-blue rounded-full"
          /><Eye
            v-else-if="member.guessed"
            class="absolute -right-[0.3cqh] -bottom-[0.2cqh] h-[2.4cqh] w-[2.4cqh] p-[0.35cqh] text-white bg-blue rounded-full"
          />
        </div>
        <div class="min-w-0 flex flex-col">
          <b class="overflow-hidden text-ellipsis whitespace-nowrap text-[0.75em]">{{
            member.nickname
          }}</b
          ><span class="text-blue text-[0.7em] font-black">{{
            strings.common.scoreUnit(member.score)
          }}</span>
        </div>
        <Crown
          v-if="member.isHost"
          class="text-[#a16207]"
          :aria-label="strings.game.hostMarkAria"
        />
      </article>
    </aside>

    <!-- 中央画布区：实时画板 + 非作画阶段的状态提示遮罩 -->
    <section
      class="relative min-w-0 min-h-0 m-[1.5cqh_1cqw] overflow-hidden border-[0.3cqh] border-slate-600 bg-white shadow-[0.5cqh_0.5cqh_0_#94a3b8]"
    >
      <GameCanvas
        :strokes="game.strokes"
        :undone-stroke-ids="game.undoneStrokeIds"
        :last-sequence="game.lastSequence"
        :can-draw="store.isDrawer && store.room.phase === 'drawing'"
        :tool="tool"
        :color="color"
        :width="width"
        :revision="store.drawRevision"
        @stroke="submitStroke"
        @fill="submitFill"
        @width-change="width = $event"
      />
      <!-- 画布状态遮罩：选词/结算/暂停等非作画阶段覆盖在画布上 -->
      <div
        v-if="store.room.phase !== 'drawing'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-[0.6cqh] bg-[#f8fafce8] text-slate-600 pointer-events-none"
      >
        <Brush class="h-[7cqh] w-[7cqh] text-blue" /><b class="text-[1.35em]">{{ phaseLabel }}</b
        ><span
          v-if="store.room.phase === 'choosing_word' && !store.isDrawer"
          class="text-[0.75em]"
          >{{ strings.game.choosingHint }}</span
        >
      </div>
    </section>

    <!-- 右侧聊天区：消息列表 + 猜词输入 / 安全预设短语 -->
    <aside
      class="flex min-w-0 flex-col border-l-[0.2cqh] border-slate-400 bg-paper px-[0.9cqw] py-[1.5cqh]"
    >
      <header class="flex items-center justify-between border-b-[0.18cqh] border-line pb-[1cqh]">
        <div>
          <span class="text-blue text-[0.56em] tracking-[0.15em]">{{
            strings.game.liveChatLabel
          }}</span>
          <h2 class="text-[1.05em]">{{ strings.game.chatTitle }}</h2>
        </div>
        <!-- 当前角色标签：观战中 / 已猜中 / 作画中 / 猜词中 -->
        <span
          class="bg-sky px-[0.6em] py-[0.35cqh] text-[#1e3a8a] rounded-[99em] text-[0.62em] font-extrabold"
          >{{
            store.me?.spectating
              ? strings.status.roleSpectating
              : store.me?.guessed
                ? strings.status.roleGuessed
                : store.isDrawer
                  ? strings.status.roleDrawing
                  : strings.status.roleGuessing
          }}</span
        >
      </header>
      <!-- 消息列表：猜词、系统、猜中、预设等类型分别高亮 -->
      <div
        ref="messageList"
        class="flex min-h-0 flex-1 flex-col gap-[0.6cqh] overflow-y-auto overflow-x-hidden py-[1cqh] pl-0 pr-[0.35em] [overscroll-behavior:contain] [scrollbar-gutter:stable]"
        aria-live="polite"
        @scroll="handleMessageScroll"
      >
        <div
          v-for="message in game.messages"
          :key="message.id"
          :class="[
            'flex flex-wrap gap-[0.35em] border-l-[0.3cqh] border-slate-400 bg-white px-[0.65em] py-[0.6cqh] text-[0.72em] leading-[1.35] text-slate-700 first:mt-auto transition-[transform,box-shadow,border-color,background-color,color,opacity] duration-[160ms]',
            message.type === 'correct' &&
              '!text-[#14532d] !bg-green-100 !border-l-green font-extrabold',
            message.type === 'system' && '!text-[#1e3a8a] !bg-sky !border-l-blue',
            message.type === 'preset' && '!text-[#7c2d12] !bg-[#ffedd5] !border-l-orange',
          ]"
        >
          <!-- 玩家消息显示发送者昵称 -->
          <b v-if="message.playerId">{{
            store.room.members.find((member) => member.id === message.playerId)?.nickname
          }}</b>
          <span>{{ message.text }}</span>
        </div>
        <div
          v-if="!game.messages.length"
          class="m-auto flex flex-col items-center text-slate-400 text-[0.7em]"
        >
          <Send class="h-[4cqh] w-[4cqh]" /><span>{{ strings.game.noMessages }}</span>
        </div>
      </div>
      <!-- 猜词输入表单：仅可猜词的玩家显示 -->
      <form
        v-if="canGuess"
        class="border-t-[0.18cqh] border-line pt-[0.8cqh]"
        @submit.prevent="sendGuess"
      >
        <label for="guess-input" class="text-muted text-[0.65em]">{{
          strings.game.guessLabel
        }}</label>
        <div class="flex mt-[0.45cqh]">
          <input
            id="guess-input"
            ref="guessInput"
            v-model="guess"
            maxlength="60"
            autocomplete="off"
            class="w-full min-w-0 h-[5.2cqh] rounded-l-[0.65em] border-[0.2cqh] border-r-0 border-blue px-[0.8em] outline-0"
            :placeholder="strings.game.guessPlaceholder"
          /><button
            type="submit"
            class="grid h-[5cqh] w-[5cqh] place-items-center rounded-r-[0.65em] bg-blue text-white"
            :disabled="!guess.trim()"
            :aria-label="strings.game.sendGuessAria"
          >
            <Send />
          </button>
        </div>
      </form>
      <!-- 安全短语区：画家 / 已猜中者 / 观战者不能发送文字 -->
      <div v-else class="border-t-[0.18cqh] border-line pt-[0.8cqh]">
        <p class="text-muted text-[0.62em] leading-[1.3]">
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
        <div class="mt-[0.5cqh] grid grid-cols-2 gap-[0.4cqh_0.4em]">
          <button
            v-for="preset in store.config.presets.safeChat"
            :key="preset"
            type="button"
            class="bg-[#ffedd5] px-[0.3em] py-[0.45cqh] text-[#7c2d12] rounded-[0.45em] text-[0.58em]"
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
      class="col-span-full grid grid-cols-[1.35fr_1fr_0.8fr_auto] items-center gap-[1.2em] border-t-[0.25cqh] border-slate-600 bg-paper px-[1.4cqw]"
      :class="{ 'text-slate-400': !store.isDrawer || store.room.phase !== 'drawing' }"
    >
      <!-- 工具组：画笔 / 橡皮擦 / 填充，可自定义快捷键 -->
      <div class="flex items-center gap-[0.45em]">
        <span class="mr-[0.3em] text-muted text-[0.62em] font-extrabold">{{
          strings.game.toolGroup
        }}</span>
        <button
          type="button"
          class="flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] bg-slate-200 px-[0.7em] text-[0.72em] text-slate-700 font-extrabold"
          :class="{ '!text-white !bg-blue': tool === 'pen' }"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.penAria(store.settings.penShortcut)"
          @click="tool = 'pen'"
        >
          <Brush />{{ strings.game.penTool
          }}<kbd
            v-if="store.settings.showShortcuts"
            class="bg-white px-[0.35em] py-[0.1em] min-w-[1.6em] rounded-[0.35em] border-[0.12em] text-navy text-[0.82em] uppercase [font-family:ui-monospace,SFMono-Regular,Consolas,monospace]"
            >{{ store.settings.penShortcut }}</kbd
          >
        </button>
        <button
          type="button"
          class="flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] bg-slate-200 px-[0.7em] text-[0.72em] text-slate-700 font-extrabold"
          :class="{ '!text-white !bg-blue': tool === 'eraser' }"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.eraserAria(store.settings.eraserShortcut)"
          @click="tool = 'eraser'"
        >
          <Eraser />{{ strings.game.eraserTool
          }}<kbd
            v-if="store.settings.showShortcuts"
            class="bg-white px-[0.35em] py-[0.1em] min-w-[1.6em] rounded-[0.35em] border-[0.12em] text-navy text-[0.82em] uppercase [font-family:ui-monospace,SFMono-Regular,Consolas,monospace]"
            >{{ store.settings.eraserShortcut }}</kbd
          >
        </button>
        <button
          type="button"
          class="flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] bg-slate-200 px-[0.7em] text-[0.72em] text-slate-700 font-extrabold"
          :class="{ '!text-white !bg-blue': tool === 'fill' }"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.fillAria(store.settings.fillShortcut)"
          @click="tool = 'fill'"
        >
          <PaintBucket />{{ strings.game.fillTool
          }}<kbd
            v-if="store.settings.showShortcuts"
            class="bg-white px-[0.35em] py-[0.1em] min-w-[1.6em] rounded-[0.35em] border-[0.12em] text-navy text-[0.82em] uppercase [font-family:ui-monospace,SFMono-Regular,Consolas,monospace]"
            >{{ store.settings.fillShortcut }}</kbd
          >
        </button>
      </div>
      <!-- 颜色组：预设色块 + 任意颜色选择器 -->
      <div class="flex items-center justify-center gap-[0.45em]">
        <span class="mr-[0.3em] text-muted text-[0.62em] font-extrabold">{{
          strings.game.colorGroup
        }}</span>
        <button
          v-for="paint in store.config.drawing.colors"
          :key="paint"
          type="button"
          class="h-[3.5cqh] w-[3.5cqh] rounded-full border-[0.2cqh] border-slate-400 bg-[var(--paint)]"
          :class="{
            'shadow-[0_0_0_0.3cqh_#facc15,0_0_0_0.5cqh_#172554]': color.toUpperCase() === paint,
          }"
          :style="{ '--paint': paint }"
          :aria-label="strings.game.presetColorAria(paint)"
          :disabled="!store.isDrawer"
          @click="color = paint"
        ></button>
        <label
          class="relative h-[3.8cqh] w-[3.8cqh] overflow-hidden rounded-full border-[0.2cqh] border-slate-400"
          :title="strings.game.customColorTitle"
        >
          <input
            v-model="color"
            type="color"
            class="absolute -inset-[1cqh] h-[6cqh] w-[6cqh] border-0 p-0"
            :disabled="!store.isDrawer"
            :aria-label="strings.game.customColorAria"
          />
        </label>
      </div>
      <!-- 线宽滑块：画笔与橡皮擦共用；填充工具下禁用 -->
      <label class="flex items-center gap-[0.45em]">
        <span class="mr-[0.3em] text-muted text-[0.62em] font-extrabold">{{
          strings.game.widthLabel(width)
        }}</span>
        <input
          v-model.number="width"
          type="range"
          class="w-[10cqw] accent-blue"
          :min="store.config.drawing.width.min"
          :max="store.config.drawing.width.max"
          :step="store.config.drawing.width.step"
          :disabled="!store.isDrawer || tool === 'fill'"
          :aria-label="strings.game.widthAria"
        />
        <i
          class="block max-h-[2.5cqh] max-w-[2.5cqh] rounded-full bg-ink"
          :style="{ width: `${Math.min(width, 20)}px`, height: `${Math.min(width, 20)}px` }"
        ></i>
      </label>
      <!-- 历史操作组：撤销 / 重做 / 清空 -->
      <div class="flex items-center gap-[0.45em]">
        <button
          type="button"
          class="flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] bg-slate-200 px-[0.7em] text-[0.72em] text-slate-700 font-extrabold"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.undoAria"
          @click="store.drawAction(EVENTS.drawUndo)"
        >
          <RotateCcw /> {{ strings.game.undo }}</button
        ><button
          type="button"
          class="flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] bg-slate-200 px-[0.7em] text-[0.72em] text-slate-700 font-extrabold"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.redoAria"
          @click="store.drawAction(EVENTS.drawRedo)"
        >
          <RotateCw /> {{ strings.game.redo }}</button
        ><button
          type="button"
          class="flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] bg-slate-200 px-[0.7em] text-[0.72em] text-slate-700 font-extrabold"
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
    <div
      v-if="store.room.phase === 'starting'"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh] text-white"
    >
      <span>{{ strings.game.countdownTitle }}</span
      ><b
        class="grid place-items-center h-[20cqh] w-[20cqh] my-[2cqh] bg-yellow text-navy rounded-full text-[6em]"
        >{{ secondsLeft }}</b
      >
      <p>{{ strings.game.countdownHint }}</p>
    </div>
    <!-- 阶段遮罩：画家选词（只有画家可见候选词按钮） -->
    <div
      v-if="store.room.phase === 'choosing_word' && store.isDrawer"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[50cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      >
        <Brush class="h-[8cqh] w-[8cqh] bg-blue p-[1.4cqh] text-white rounded-full" />
        <p>{{ strings.game.yourTurn }}</p>
        <h2>{{ strings.game.chooseWordTitle }}</h2>
        <div class="flex gap-[1em] my-[2cqh]">
          <button
            v-for="option in game.wordOptions"
            :key="option.id"
            type="button"
            class="min-h-[7cqh] min-w-[12cqw] rounded-[0.7em] bg-yellow border-b-[0.6cqh] border-[#ca8a04] text-navy px-[1em] text-[1.25em] font-[1000]"
            @click="store.chooseWord(option.id)"
          >
            {{ option.text }}
          </button>
        </div>
        <span>{{ strings.game.autoChoose(secondsLeft) }}</span>
      </section>
    </div>
    <!-- 阶段遮罩：游戏暂停（房主可继续或提前结束） -->
    <div
      v-if="store.room.phase === 'paused'"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[50cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      >
        <CirclePause class="h-[8cqh] w-[8cqh] bg-blue p-[1.4cqh] text-white rounded-full" />
        <p>{{ strings.game.pausedTitle }}</p>
        <h2>{{ strings.game.pausedSubtitle }}</h2>
        <span>{{ strings.game.pausedHint }}</span>
        <div v-if="store.isHost" class="flex gap-[0.8em] mt-[1.5cqh]">
          <button
            class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
            type="button"
            @click="store.resume"
          >
            <CirclePlay />{{ strings.game.resumeGame }}</button
          ><button
            class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-red"
            type="button"
            @click="showEndConfirm = true"
          >
            {{ strings.game.endEarly }}
          </button>
        </div>
      </section>
    </div>
    <!-- 阶段遮罩：回合结算（答案、得分明细） -->
    <div
      v-if="store.room.phase === 'round_result' && game.roundResult"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[50cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      >
        <p>{{ strings.game.roundAnswerLabel }}</p>
        <h2>{{ game.roundResult.answer }}</h2>
        <div class="my-[1.5cqh] flex w-full flex-col gap-[0.6cqh]">
          <article
            v-for="detail in game.roundResult.details"
            :key="detail.playerId"
            class="grid grid-cols-[1.5fr_repeat(4,1fr)] items-center bg-slate-200 px-[0.8em] py-[0.8cqh] text-left text-[0.72em]"
          >
            <b>{{ store.room.members.find((member) => member.id === detail.playerId)?.nickname }}</b
            ><span>{{ strings.game.scoreBase(detail.base) }}</span
            ><span>{{ strings.game.scoreSpeed(detail.speed) }}</span
            ><span>{{ strings.game.scoreOrder(detail.order) }}</span
            ><strong class="text-blue text-[1.2em]">{{
              strings.game.scoreTotal(detail.total)
            }}</strong>
          </article>
          <p v-if="!game.roundResult.details.length">{{ strings.game.noGuesses }}</p>
        </div>
        <span>{{ strings.game.drawerScoreLine(game.roundResult.drawerScore, secondsLeft) }}</span>
      </section>
    </div>
    <!-- 阶段遮罩：最终结算（排行榜、统计） -->
    <div
      v-if="store.room.phase === 'game_result'"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[55cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] pt-[2.5cqh] pb-[4cqh] text-center"
      >
        <Trophy class="h-[8cqh] w-[8cqh] bg-yellow p-[1.4cqh] text-[#854d0e] rounded-full" />
        <p>{{ strings.game.gameResultLabel }}</p>
        <h2>{{ strings.game.finalRanking }}</h2>
        <div class="my-[1cqh] flex w-full flex-col gap-[0.6cqh]">
          <article
            v-for="member in rankings"
            :key="member.id"
            class="grid grid-cols-[3em_auto_1fr_auto] items-center gap-[0.8em] bg-slate-200 px-[1em] py-[0.6cqh] text-left"
            :class="{ '!text-[#713f12] !bg-amber-100': member.rank === 1 }"
          >
            <b>#{{ member.rank }}</b
            ><AvatarImage
              class="h-[4.5cqh] w-[4.5cqh]"
              :avatar-id="member.avatarId"
              :label="strings.common.playerAvatarAria(member.nickname)"
            />
            ><span class="flex flex-col font-extrabold"
              >{{ member.nickname
              }}<small class="text-muted text-[0.62em] font-semibold">{{
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
        <div class="flex gap-[0.8em] mt-[1.5cqh]">
          <button
            v-if="store.isHost"
            class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
            type="button"
            @click="store.returnWaiting"
          >
            {{ strings.game.backToRoom }}</button
          ><button
            class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
            type="button"
            @click="store.leaveRoom"
          >
            {{ strings.game.leaveRoom }}
          </button>
        </div>
      </section>
    </div>

    <!-- 确认弹窗：清空画板 -->
    <Transition name="modal">
      <div
        v-if="showClearConfirm"
        class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
      >
        <section
          class="game-dialog flex max-h-[86cqh] w-[40cqw] flex-col items-center gap-[1.4cqh] overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper pt-[3cqh] text-center text-ink shadow-[0_1.4cqh_4cqh_#0007]"
        >
          <Trash2 class="h-[7cqh] w-[7cqh] p-[1.4cqh] rounded-full bg-red-100 text-[#991b1b]" />
          <h2>{{ strings.game.clearCanvasTitle }}</h2>
          <p class="max-w-[30em] text-muted leading-[1.6]">{{ strings.game.clearCanvasBody }}</p>
          <footer
            class="mt-[1cqh] flex min-h-[8cqh] w-full items-center justify-end gap-[0.8em] bg-slate-200 px-[1.7em] py-[1cqh]"
          >
            <button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
              type="button"
              @click="showClearConfirm = false"
            >
              {{ strings.common.cancel }}</button
            ><button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-red"
              type="button"
              @click="clearDrawing"
            >
              {{ strings.game.confirmClear }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
    <!-- 确认弹窗：提前结束本局 -->
    <Transition name="modal">
      <div
        v-if="showEndConfirm"
        class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
      >
        <section
          class="game-dialog flex max-h-[86cqh] w-[40cqw] flex-col items-center gap-[1.4cqh] overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper pt-[3cqh] text-center text-ink shadow-[0_1.4cqh_4cqh_#0007]"
        >
          <X class="h-[7cqh] w-[7cqh] p-[1.4cqh] rounded-full bg-red-100 text-[#991b1b]" />
          <h2>{{ strings.game.endGameTitle }}</h2>
          <p class="max-w-[30em] text-muted leading-[1.6]">{{ strings.game.endGameBody }}</p>
          <footer
            class="mt-[1cqh] flex min-h-[8cqh] w-full items-center justify-end gap-[0.8em] bg-slate-200 px-[1.7em] py-[1cqh]"
          >
            <button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
              type="button"
              @click="showEndConfirm = false"
            >
              {{ strings.common.cancel }}</button
            ><button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-red"
              type="button"
              @click="store.endEarly"
            >
              {{ strings.game.confirmEnd }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </main>
</template>
