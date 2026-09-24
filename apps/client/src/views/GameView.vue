<!--
  对局统一骨架：画家与猜词者共享 HUD、画布和玩家区，仅按服务端角色快照切换权限。
  本文件已把顶栏、得分条、聊天区、工具栏与阶段遮罩拆为 components/game/ 下的子组件，
  这里仅保留画布区、弹窗编排与浏览器级状态（全屏/弹窗开关/颜色线宽工具）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFullscreen } from '@vueuse/core'
import { Brush, LogOut, Trash2, X } from 'lucide-vue-next'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import {
  EVENTS,
  type ClientResponse,
  type FillCommand,
  type Stroke,
  type StrokeAck,
} from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import { AppButton, ConfirmDialog } from '@/components/common'
import {
  ChatPanel,
  DrawingToolbar,
  GameCanvas,
  GameHud,
  PhaseOverlay,
  ScoreStrip,
} from '@/components/game'
import { defineLazyComponent } from '@/utils/lazy-component'
import { useGameHud } from '@/composables/useGameHud'
import { useShortcuts } from '@/composables/useShortcuts'
import { fireGuessCorrectConfetti } from '@/utils/confetti'
import type { RequestResult } from '@/stores/request'

// 对局内设置页复用同一个懒加载定义（低频模块，不进首屏包）
const SettingsView = defineLazyComponent(() => import('@/views/SettingsView.vue'))

const store = useGameStore()

// 当自己猜中时触发全屏礼花庆祝特效。
// 守卫同时放行 drawing 与 round_result：最后一名猜词者猜中时，服务端在**同一份快照**里
// 已把阶段切到回合结算，若只认 drawing 会漏掉「最后一人猜中」这一最该庆祝的时刻（缺陷回归守卫）。
watch(
  () => store.me?.guessed,
  (guessed, prev) => {
    const phase = store.room?.phase
    if (guessed && !prev && (phase === 'drawing' || phase === 'round_result')) {
      if (store.settings.animationsEnabled) {
        // 礼花模块按需下载，失败静默降级（见 utils/confetti.ts）
        void fireGuessCorrectConfetti()
      }
    }
  },
)
// ---- 对局 HUD（计时/进度/权限/排行等，含 ticker 生命周期，见 composables/useGameHud.ts）----
// 整局只在此处调用一次 useGameHud，把派生值（剩余秒数/进度/画家/排位）作为 props 下发给
// GameHud/PhaseOverlay 等子组件，避免各组件各自开启 ticker 造成重复刷新。
const { game, secondsLeft, progress, drawer, rankings, phaseLabel, canGuess } = useGameHud(store)
// ---- 画板快捷键与工具切换（含 keydown 监听生命周期，见 composables/useShortcuts.ts）----
const { tool } = useShortcuts(store)

// ---- 对局本地 UI 状态 ----
const color = ref<string>(APP_CONFIG.drawing.defaultColor) // 当前画笔/填充颜色
const width = ref<number>(APP_CONFIG.drawing.width.default) // 当前线宽
const showClearConfirm = ref(false) // 清空确认弹窗
const showEndConfirm = ref(false) // 提前结束确认弹窗
const showLeaveGameConfirm = ref(false) // 设置页退出对局确认弹窗
const showGameSettings = ref(false) // 对局内设置弹窗

// 全屏以根游戏舞台为目标，确保 Toast、弹窗和竖屏提示仍包含在全屏上下文中。
// 目标元素用 computed 从 DOM 实时取 .game-stage（它位于 App.vue 根舞台，非本组件根元素），
// useFullscreen 支持传入元素/ref/computed，其内部管理请求/退出全屏与 isFullscreen 同步，
// 并在组件卸载时清理事件监听，替代手写 querySelector + fullscreenchange。
const fullscreenTarget = computed<HTMLElement | null>(() =>
  document.querySelector<HTMLElement>('.game-stage'),
)
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(fullscreenTarget)

/** 填充 ack 携带服务端画布修订，供画布判断本地是否已追平后解除填充锁。 */
type FillAck = ClientResponse<typeof EVENTS.drawFillCommit>

function submitStroke(stroke: Stroke, callback: (result: RequestResult<StrokeAck>) => void): void {
  void store.sendStroke(stroke).then(callback)
}

/** 乐观批次失败或填充重放不可用时统一请求权威画布；Room Store 内部负责并发合并与冷却。 */
function recoverAuthoritativeDrawing(): void {
  void store.requestFullSnapshot('drawing_rollback')
}
/** 填充点击由服务端校验并广播，所有客户端按相同历史重放封闭区域。 */
function submitFill(
  command: FillCommand,
  callback: (result: RequestResult<FillAck>) => void,
): void {
  void store.sendFill(command).then(callback)
}

async function clearDrawing(): Promise<void> {
  await store.drawAction(EVENTS.drawClear)
  showClearConfirm.value = false
}

/** 先收起确认框再提交，避免进入最终结算后弹窗仍遮住页面。 */
async function endGameEarly(): Promise<void> {
  showEndConfirm.value = false
  await store.endEarly()
}

/** 设置页中确认退出本局；请求失败时保留设置页并由统一 Toast 提示。 */
async function leaveGame(): Promise<void> {
  showLeaveGameConfirm.value = false
  await store.leaveGame()
}

/** 切换到全屏失败时给出统一提示（useFullscreen 内部已处理浏览器兼容，这里只兜底失败反馈）。 */
function handleFullscreenToggle(): void {
  void toggleFullscreen().catch(() => {
    store.notify(strings.game.fullscreenFailed, 'warning')
  })
}
</script>

<template>
  <!-- 对局主骨架：仅在房间存在且对局未结束时渲染；
       画框以外区域统一使用 paper（近白）语义色，与画布白底协调 -->
  <main
    v-if="store.room && game"
    class="grid h-full grid-cols-[17%_minmax(0,61%)_22%] grid-rows-[11%_minmax(0,76%)_13%] bg-paper"
  >
    <!-- 顶栏 HUD：回合数、当前画家、答案、计时器、网络状态与暂停按钮 -->
    <GameHud
      :is-fullscreen="isFullscreen"
      :game="game"
      :seconds-left="secondsLeft"
      :progress="progress"
      :drawer="drawer"
      @settings="showGameSettings = true"
      @toggle-fullscreen="handleFullscreenToggle"
    />

    <!-- 左侧玩家得分条：列出全部成员、得分与画家/猜中标记 -->
    <ScoreStrip />

    <!-- 中央画布区：实时画板 + 非作画阶段的状态提示遮罩 -->
    <section
      class="relative min-w-0 min-h-0 m-[1.5cqh_1cqw] overflow-hidden border-[0.3cqh] border-navy bg-white shadow-block"
    >
      <GameCanvas
        v-model:width="width"
        :round-id="game.roundId"
        :strokes="game.strokes"
        :undone-stroke-ids="game.undoneStrokeIds"
        :last-sequence="game.lastSequence"
        :can-draw="store.isDrawer && store.room.phase === 'drawing'"
        :tool="tool"
        :color="color"
        :revision="game.drawingRevision"
        @stroke="submitStroke"
        @stroke-failure="recoverAuthoritativeDrawing"
        @fill="submitFill"
        @fill-failure="recoverAuthoritativeDrawing"
      />
      <!-- 画布状态遮罩：选词/结算/暂停等非作画阶段覆盖在画布上 -->
      <div
        v-if="store.room.phase !== 'drawing'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-[0.6cqh] bg-paper text-muted pointer-events-none"
      >
        <Brush class="h-[7cqh] w-[7cqh] text-blue" /><b class="text-fs-20">{{ phaseLabel }}</b>
        <span v-if="store.room.phase === 'choosing_word' && !store.isDrawer" class="text-fs-12">{{
          strings.game.choosingHint
        }}</span>
      </div>
    </section>

    <!-- 右侧聊天区：消息列表 + 猜词输入 / 安全预设短语 -->
    <ChatPanel :can-guess="canGuess" />

    <!-- 底部绘图工具栏：工具 / 颜色 / 线宽 / 历史操作（非画家时整条禁用） -->
    <DrawingToolbar
      v-model:tool="tool"
      v-model:color="color"
      v-model:width="width"
      @clear="showClearConfirm = true"
    />

    <!-- 阶段遮罩：开局倒计时 / 画家选词 / 暂停 / 回合结算 / 最终结算 -->
    <PhaseOverlay
      :seconds-left="secondsLeft"
      :game="game"
      :rankings="rankings"
      @choose-word="store.chooseWord"
      @reroll-words="store.rerollWords"
      @resume="store.resume"
      @open-end-confirm="showEndConfirm = true"
      @return-waiting="store.returnWaiting"
      @leave-room="store.leaveRoom"
    />

    <!-- 对局内直接复用完整设置页；右上角放「退出游戏」，资料编辑能力按场景禁用。 -->
    <div v-if="showGameSettings" class="absolute inset-0 z-40">
      <SettingsView
        :back-label="strings.settings.backToGame"
        :profile-editing-disabled="true"
        @back="showGameSettings = false"
      >
        <template #header-status>
          <!-- 退出游戏：复用 AppButton danger 变体并压缩为顶栏小尺寸，与全站按钮风格一致 -->
          <AppButton
            variant="danger"
            type="button"
            class="min-h-[4.4cqh] rounded-[0.55em] px-[0.8em] py-[0.8cqh] text-fs-14"
            :audio-feedback="null"
            @click="showLeaveGameConfirm = true"
          >
            <LogOut />{{ strings.game.leaveGame }}
          </AppButton>
        </template>
      </SettingsView>
    </div>

    <!-- 确认弹窗：从对局设置页退出本局，层级高于设置页。 -->
    <ConfirmDialog
      v-model:open="showLeaveGameConfirm"
      :title="strings.game.leaveGameTitle"
      :body="strings.game.leaveGameBody"
      :confirm-label="strings.game.confirmLeaveGame"
      :cancel-label="strings.common.cancel"
      :icon="LogOut"
      overlay-class="z-50"
      @confirm="leaveGame"
    />

    <!-- 确认弹窗：清空画板 -->
    <ConfirmDialog
      v-model:open="showClearConfirm"
      :title="strings.game.clearCanvasTitle"
      :body="strings.game.clearCanvasBody"
      :confirm-label="strings.game.confirmClear"
      :cancel-label="strings.common.cancel"
      :icon="Trash2"
      @confirm="clearDrawing"
    />
    <!-- 确认弹窗：提前结束本局 -->
    <ConfirmDialog
      v-model:open="showEndConfirm"
      :title="strings.game.endGameTitle"
      :body="strings.game.endGameBody"
      :confirm-label="strings.game.confirmEnd"
      :cancel-label="strings.common.cancel"
      :icon="X"
      @confirm="endGameEarly"
    />
  </main>
</template>
