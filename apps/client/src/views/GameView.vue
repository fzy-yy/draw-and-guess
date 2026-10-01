<!--
  对局统一骨架（浮层布局）：画家与猜词者共享顶栏、铺满画布与浮层面板，仅按服务端角色快照切换权限。
  结构为「固定顶栏 + 铺满画布（黑色描边 / 圆角 / 极微边距）+ 可拖动浮层面板 + 底部横向工具条」，
  取代旧的 3×3 网格；画布、浮层与工具条的定位/交互分别拆入 components/game/ 下的子组件。
  本文件只保留画布装配、弹窗编排与浏览器级状态（全屏/弹窗开关/颜色线宽工具）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFullscreen } from '@vueuse/core'
import { Brush, LogOut, Trash2, X } from 'lucide-vue-next'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, type FillCommand, type Stroke, type StrokeAck } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import { AppButton, ConfirmDialog } from '@/components/common'
import {
  CanvasToolbar,
  ChatPanel,
  FloatingPanel,
  GameCanvas,
  GameHud,
  PhaseOverlay,
  PlayerPanel,
  type PanelPosition,
} from '@/components/game'
import { useGameHud } from '@/composables/useGameHud'
import { useShortcuts } from '@/composables/useShortcuts'
import { useGuessConfetti } from '@/composables/useGuessConfetti'
// 填充 ack 类型与提交锁语义归 useFillSession 单点定义（GameCanvas 同源导入）。
import type { FillAck } from '@/composables/useFillSession'
import type { RequestResult } from '@/stores/request'
// 对局内设置页复用同一个静态导入的视图组件（首开白闪取舍见 docs/adr/0014-settings-view-static-import.md）
import SettingsView from '@/views/SettingsView.vue'

const store = useGameStore()

// 自己猜中时触发全屏礼花（含「最后一人猜中」时阶段已切到 round_result 的情况，
// 触发条件与防误触发取舍见 composables/useGuessConfetti.ts 与 docs/adr/0031-*）。
useGuessConfetti(store)
// ---- 对局 HUD（计时/进度/权限/排行等，含 ticker 生命周期，见 composables/useGameHud.ts）----
// 整局只在此处调用一次 useGameHud，把派生值（剩余秒数/进度/排位）作为 props 下发给
// GameHud/PhaseOverlay 等子组件，避免各组件各自开启 ticker 造成重复刷新。
const { game, secondsLeft, progress, rankings, phaseLabel, canGuess } = useGameHud(store)
// ---- 画板快捷键与工具切换（含 keydown 监听生命周期，见 composables/useShortcuts.ts）----
const { tool } = useShortcuts(store)

// ---- 对局本地 UI 状态 ----
const color = ref<string>(APP_CONFIG.drawing.defaultColor) // 当前画笔/填充颜色
const width = ref<number>(APP_CONFIG.drawing.width.default) // 当前线宽
const showClearConfirm = ref(false) // 清空确认弹窗
const showEndConfirm = ref(false) // 提前结束确认弹窗
const showLeaveGameConfirm = ref(false) // 设置页退出对局确认弹窗
const showGameSettings = ref(false) // 对局内设置弹窗

// ---- 浮层面板与工具条的本地状态（仅本机 UI，刷新即重置；位置为相对画布容器的百分比）----
const playersOpen = ref(true)
const chatOpen = ref(true)
const toolsOpen = ref(true)
// 玩家贴左缘、聊天贴右缘（24cqw 宽 ⇒ 左边界默认在 76%）；高度由 h-full 撑满画布。
const playersPosition = ref<PanelPosition>({ x: 0, y: 0 })
const chatPosition = ref<PanelPosition>({ x: 76, y: 0 })

/** 仅画家在作画阶段可绘制：驱动画布与底部工具条的启用，非画家/非该阶段整组置灰。 */
const canDraw = computed(() => store.isDrawer && store.room?.phase === 'drawing')
/** 底部工具条可见性：仅画家且顶栏「工具」开关为开。 */
const showToolbar = computed(() => store.isDrawer && toolsOpen.value)

// 全屏以根游戏舞台为目标，确保 Toast、弹窗和竖屏提示仍包含在全屏上下文中。
// 目标元素用 computed 从 DOM 实时取 .game-stage（它位于 App.vue 根舞台，非本组件根元素），
// useFullscreen 支持传入元素/ref/computed，其内部管理请求/退出全屏与 isFullscreen 同步，
// 并在组件卸载时清理事件监听，替代手写 querySelector + fullscreenchange。
const fullscreenTarget = computed<HTMLElement | null>(() =>
  document.querySelector<HTMLElement>('.game-stage'),
)
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(fullscreenTarget)

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
  <!-- 对局主骨架：仅在房间存在且对局未结束时渲染；画框以外区域统一使用 paper（近白）语义色 -->
  <main v-if="store.room && game" class="relative flex h-full flex-col bg-paper">
    <!-- 固定顶栏：回合 / 面板开关 / 题目 / 倒计时 / 网络 / 暂停·设置·全屏 -->
    <GameHud
      v-model:players-open="playersOpen"
      v-model:chat-open="chatOpen"
      v-model:tools-open="toolsOpen"
      :is-fullscreen="isFullscreen"
      :game="game"
      :seconds-left="secondsLeft"
      :progress="progress"
      :show-tools="store.isDrawer"
      @settings="showGameSettings = true"
      @toggle-fullscreen="handleFullscreenToggle"
    />

    <!-- 画布铺满顶栏以下整块：黑色描边 + 圆角（与浮层一致）+ 极微边距；
         浮层面板与底部工具条都相对此容器定位与夹取 -->
    <div class="min-h-0 flex-1 p-[0.7cqh_0.7cqw]">
      <div
        class="relative h-full overflow-hidden rounded-[0.7em] border-[0.35cqh] border-black bg-white"
      >
        <GameCanvas
          v-model:width="width"
          :round-id="game.roundId"
          :strokes="game.strokes"
          :undone-stroke-ids="game.undoneStrokeIds"
          :last-sequence="game.lastSequence"
          :can-draw="canDraw"
          :tool="tool"
          :color="color"
          :revision="game.drawingRevision"
          @stroke="submitStroke"
          @stroke-failure="recoverAuthoritativeDrawing"
          @fill="submitFill"
          @fill-failure="recoverAuthoritativeDrawing"
        />

        <!-- 画布状态遮罩：选词/结算/暂停等非作画阶段覆盖在画布上（猜词者在画家选词时也能看到状态） -->
        <div
          v-if="store.room.phase !== 'drawing'"
          class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[0.6cqh] bg-paper text-muted"
        >
          <Brush class="h-[7cqh] w-[7cqh] text-blue" /><b class="text-fs-20">{{ phaseLabel }}</b>
          <span v-if="store.room.phase === 'choosing_word' && !store.isDrawer" class="text-fs-12">{{
            strings.game.choosingHint
          }}</span>
        </div>

        <!-- 浮层玩家面板（贴左缘，默认打开，可拖动 / 关闭） -->
        <FloatingPanel
          v-model:open="playersOpen"
          v-model:position="playersPosition"
          :title="strings.game.playersPanelTitle"
          width-class="w-[10cqw]"
          height-class="h-full"
        >
          <PlayerPanel />
        </FloatingPanel>

        <!-- 浮层聊天面板（贴右缘，默认打开，可拖动 / 关闭） -->
        <FloatingPanel
          v-model:open="chatOpen"
          v-model:position="chatPosition"
          :title="strings.game.chatPanelTitle"
          width-class="w-[24cqw]"
          height-class="h-full"
        >
          <ChatPanel :can-guess="canGuess" />
        </FloatingPanel>

        <!-- 底部横向工具条：浮在画布底部居中，仅画家且开关为开时显示 -->
        <CanvasToolbar
          v-model:tool="tool"
          v-model:color="color"
          v-model:width="width"
          :visible="showToolbar"
          :can-draw="canDraw"
          @clear="showClearConfirm = true"
        />
      </div>
    </div>

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
