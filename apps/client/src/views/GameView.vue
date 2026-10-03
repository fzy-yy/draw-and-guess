<!--
  对局统一骨架（黄金平衡三栏布局版）：
  画家与猜词者共享顶栏、画布与常驻左右两栏，仅按服务端角色快照切换权限。
  精确 100cqw 物理闭环三栏结构：
  外留白 0.2cqw + 左栏 16cqw + 间距 0.8cqw + 中栏 62cqw + 间距 0.8cqw + 右栏 20cqw + 外留白 0.2cqw = 100cqw。
  中间画板居中绝对主角，零遮挡、永不拉伸伸缩，比例约为 4:3 方正舒适；
  彻底废除浮动面板组件（FloatingPanel），右侧聊天栏常驻流内；
  工具条仅画家可见，猜词者隐藏，支持手柄微移避让。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
  GameCanvas,
  GameHud,
  PhaseOverlay,
  PlayerPanel,
  type PanelPosition,
} from '@/components/game'
import { useGameHud } from '@/composables/useGameHud'
import { usePanelShortcuts } from '@/composables/usePanelShortcuts'
import { useShortcuts } from '@/composables/useShortcuts'
import { useGuessConfetti } from '@/composables/useGuessConfetti'
// 填充 ack 类型与提交锁语义归 useFillSession 单点定义（GameCanvas 同源导入）。
import type { FillAck } from '@/composables/useFillSession'
import type { RequestResult } from '@/stores/request'
// 对局内设置页复用同一个静态导入的视图组件（静态导入取舍见 docs/adr/0049-lan-first-drop-size-and-coverage-gates.md）
import SettingsView from '@/views/SettingsView.vue'
import { focusToolbar } from '@/components/game/floating-panel-z'
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

// 底部工具条本地位置（仅画家拖拽微调避让，刷新即重置；位置为相对画布容器的百分比）
const toolbarPosition = ref<PanelPosition | null>(null)
// 画家是否主动展示工具条（支持右键菜单显隐）
const isToolbarVisible = ref(true)

// 换人作画或新回合开始时，重置工具条位置到底部居中默认位置并重置为显示状态；
// 监听源采用具体 getter 数组，避免对整个 game 对象的其它属性变动（如撤销时的 undoneStrokeIds）产生非预期触发
watch(
  [() => game.value?.roundId, () => game.value?.drawerId],
  ([newRound, newDrawer], oldValues) => {
    const oldRound = oldValues?.[0]
    const oldDrawer = oldValues?.[1]
    if (newRound !== oldRound || newDrawer !== oldDrawer) {
      toolbarPosition.value = null
      isToolbarVisible.value = true
    }
  },
)

/** 仅画家在作画阶段可绘制：驱动画布与底部工具条的启用，非画家/非该阶段整组置灰。 */
const canDraw = computed(() => store.isDrawer && store.room?.phase === 'drawing')
/** 底部绘图工具条可见性：仅画家在未主动隐藏时显示，猜词者完全隐藏。 */
const showToolbar = computed(() => store.isDrawer && isToolbarVisible.value)

/** 画布引用与回合结束 3 秒作画重播状态 */
const gameCanvasRef = ref<{ speedrunReplay: (durationMs?: number) => Promise<void> }>()
const isReplayingRound = ref(false)

watch(
  () => store.room?.phase,
  async (newPhase, oldPhase) => {
    // 当从 drawing 进入 round_result 时，若房间开启 allowRoundReplay 且有笔迹，触发 3 秒快速重播
    if (newPhase === 'round_result' && oldPhase === 'drawing') {
      const allowReplay = store.room?.settings.allowRoundReplay ?? true
      const hasStrokes = (game.value?.strokes.length ?? 0) > 0
      if (allowReplay && hasStrokes) {
        isReplayingRound.value = true
        await nextTick()
        try {
          await gameCanvasRef.value?.speedrunReplay()
        } finally {
          isReplayingRound.value = false
        }
        return
      }
    }
    isReplayingRound.value = false
  },
)

// ---- 猜词框快捷键：Enter 键自动聚焦猜词输入框 ----
// 对局内设置弹窗打开时让位，避免与设置页的输入控件冲突。
const chatPanelRef = ref<{ focusInput: () => void }>()
usePanelShortcuts({
  store,
  focusChatInput: () => chatPanelRef.value?.focusInput(),
  enabled: () => !showGameSettings.value,
})

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
    store.notify(strings.ui.game.fullscreenFailed, 'warning')
  })
}
</script>

<template>
  <!-- 对局主骨架：仅在房间存在且对局未结束时渲染；画框以外区域统一使用 paper（近白）语义色 -->
  <main v-if="store.room && game" class="relative flex h-full flex-col bg-paper">
    <!-- 固定顶栏：回合 / 题目 / 倒计时 / 网络 / 暂停·设置·全屏（高度统一） -->
    <GameHud
      :is-fullscreen="isFullscreen"
      :game="game"
      :seconds-left="secondsLeft"
      :progress="progress"
      :is-replaying="isReplayingRound"
      @settings="showGameSettings = true"
      @toggle-fullscreen="handleFullscreenToggle"
    />

    <!--
      对局主舞台：精确 100cqw 物理闭环三栏结构
      外留白 0.2cqw + 左栏 16cqw + 间距 0.8cqw + 中栏 62cqw + 间距 0.8cqw + 右栏 20cqw + 外留白 0.2cqw = 100cqw
    -->
    <div class="min-h-0 flex-1 px-[0.2cqw] py-[0.7cqh]">
      <div class="flex h-full items-stretch gap-[0.8cqw]">
        <!-- 左栏：16cqw 舒展玩家榜，独立粗黑边框包裹 -->
        <aside
          class="w-[16cqw] shrink-0 overflow-hidden rounded-[0.6em] border-[0.35cqh] border-line bg-paper"
        >
          <PlayerPanel />
        </aside>

        <!-- 中栏：62cqw 黄金画板主角，宽高比约 4:3 方正舒适，全屏零遮挡 -->
        <div
          class="relative w-[62cqw] shrink-0 overflow-hidden rounded-[0.6em] border-[0.35cqh] border-line bg-white"
          @pointerdown="focusToolbar"
        >
          <GameCanvas
            ref="gameCanvasRef"
            v-model:width="width"
            v-model:tool="tool"
            v-model:color="color"
            v-model:show-toolbar="isToolbarVisible"
            :round-id="game.roundId"
            :strokes="game.strokes"
            :undone-stroke-ids="game.undoneStrokeIds"
            :last-sequence="game.lastSequence"
            :can-draw="canDraw"
            :revision="game.drawingRevision"
            @clear="showClearConfirm = true"
            @stroke="submitStroke"
            @stroke-failure="recoverAuthoritativeDrawing"
            @fill="submitFill"
            @fill-failure="recoverAuthoritativeDrawing"
          />

          <!-- 画布状态遮罩：选词/暂停等阶段覆盖在画布上；回合结算（round_result）期间不遮挡，以便玩家欣赏画作与快速重播 -->
          <div
            v-if="store.room.phase !== 'drawing' && store.room.phase !== 'round_result'"
            class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[0.6cqh] bg-paper text-muted"
          >
            <Brush class="h-[7cqh] w-[7cqh] text-blue" /><b class="text-fs-20">{{ phaseLabel }}</b>
            <span
              v-if="store.room.phase === 'choosing_word' && !store.isDrawer"
              class="text-fs-12"
              >{{ strings.ui.game.choosingHint }}</span
            >
          </div>

          <!-- 底部横向工具条：仅画家显示（visible="showToolbar"），猜词者完全隐藏，支持拖动手柄在画布内移动避让 -->
          <CanvasToolbar
            v-model:tool="tool"
            v-model:color="color"
            v-model:width="width"
            v-model:position="toolbarPosition"
            :visible="showToolbar"
            :can-draw="canDraw"
            @clear="showClearConfirm = true"
          />
        </div>

        <!-- 右栏：20cqw 常驻聊天区，独立粗黑边框包裹，单行容纳 15~16 汉字不折行 -->
        <aside
          class="w-[20cqw] shrink-0 overflow-hidden rounded-[0.6em] border-[0.35cqh] border-line bg-paper"
        >
          <ChatPanel ref="chatPanelRef" :can-guess="canGuess" />
        </aside>
      </div>
    </div>
    <!-- 阶段遮罩：开局倒计时 / 画家选词 / 暂停 / 回合结算 / 最终结算 -->
    <PhaseOverlay
      :seconds-left="secondsLeft"
      :game="game"
      :rankings="rankings"
      :is-replaying="isReplayingRound"
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
        :back-label="strings.ui.settings.backToGame"
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
            <LogOut />{{ strings.ui.game.leaveGame }}
          </AppButton>
        </template>
      </SettingsView>
    </div>

    <!-- 确认弹窗：从对局设置页退出本局，层级高于设置页。 -->
    <ConfirmDialog
      v-model:open="showLeaveGameConfirm"
      :title="strings.ui.game.leaveGameTitle"
      :body="strings.ui.game.leaveGameBody"
      :confirm-label="strings.ui.game.confirmLeaveGame"
      :cancel-label="strings.ui.common.cancel"
      :icon="LogOut"
      overlay-class="z-50"
      @confirm="leaveGame"
    />

    <!-- 确认弹窗：清空画板 -->
    <ConfirmDialog
      v-model:open="showClearConfirm"
      :title="strings.ui.game.clearCanvasTitle"
      :body="strings.ui.game.clearCanvasBody"
      :confirm-label="strings.ui.game.confirmClear"
      :cancel-label="strings.ui.common.cancel"
      :icon="Trash2"
      @confirm="clearDrawing"
    />
    <!-- 确认弹窗：提前结束本局 -->
    <ConfirmDialog
      v-model:open="showEndConfirm"
      :title="strings.ui.game.endGameTitle"
      :body="strings.ui.game.endGameBody"
      :confirm-label="strings.ui.game.confirmEnd"
      :cancel-label="strings.ui.common.cancel"
      :icon="X"
      @confirm="endGameEarly"
    />
  </main>
</template>
