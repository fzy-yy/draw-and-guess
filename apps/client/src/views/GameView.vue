<!--
  对局统一骨架：画家与猜词者共享 HUD、画布和玩家区，仅按服务端角色快照切换权限。
  本文件已把顶栏、得分条、聊天区、工具栏与阶段遮罩拆为 components/game/ 下的子组件，
  这里仅保留画布区、弹窗编排与浏览器级状态（全屏/弹窗开关/颜色线宽工具）。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Brush, Trash2, X } from 'lucide-vue-next'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, type FillCommand, type Stroke } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import GameCanvas from '@/components/GameCanvas.vue'
import GameSettingsDialog from '@/components/GameSettingsDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GameHud from '@/components/game/GameHud.vue'
import ScoreStrip from '@/components/game/ScoreStrip.vue'
import ChatPanel from '@/components/game/ChatPanel.vue'
import DrawingToolbar from '@/components/game/DrawingToolbar.vue'
import PhaseOverlay from '@/components/game/PhaseOverlay.vue'
import { useGameHud } from '@/composables/useGameHud'
import { useShortcuts } from '@/composables/useShortcuts'

const store = useGameStore()
// ---- 对局 HUD（计时/进度/权限/排行等，含 ticker 生命周期，见 composables/useGameHud.ts）----
// 整局只在此处调用一次 useGameHud，把派生值（剩余秒数/进度/画家/排位）作为 props 下发给
// GameHud/PhaseOverlay 等子组件，避免各组件各自开启 200ms ticker 造成重复刷新。
const { game, secondsLeft, progress, drawer, rankings, phaseLabel, canGuess } = useGameHud(store)
// ---- 画板快捷键与工具切换（含 keydown 监听生命周期，见 composables/useShortcuts.ts）----
const { tool } = useShortcuts(store)

// ---- 对局本地 UI 状态 ----
const color = ref<string>(APP_CONFIG.drawing.defaultColor) // 当前画笔/填充颜色
const width = ref<number>(APP_CONFIG.drawing.width.default) // 当前线宽
const showClearConfirm = ref(false) // 清空确认弹窗
const showEndConfirm = ref(false) // 提前结束确认弹窗
const showGameSettings = ref(false) // 对局内设置弹窗
const isFullscreen = ref(Boolean(document.fullscreenElement))

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

function handleFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}
onMounted(() => document.addEventListener('fullscreenchange', handleFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', handleFullscreenChange))
</script>

<template>
  <!-- 对局主骨架：仅在房间存在且对局未结束时渲染 -->
  <main
    v-if="store.room && game"
    class="grid h-full grid-cols-[17%_minmax(0,61%)_22%] grid-rows-[11%_minmax(0,76%)_13%] bg-[#cbd5e1]"
  >
    <!-- 顶栏 HUD：回合数、当前画家、答案、计时器、网络状态与暂停按钮 -->
    <GameHud
      :is-fullscreen="isFullscreen"
      :game="game"
      :seconds-left="secondsLeft"
      :progress="progress"
      :drawer="drawer"
      @settings="showGameSettings = true"
      @toggle-fullscreen="toggleFullscreen"
    />

    <!-- 左侧玩家得分条：列出全部成员、得分与画家/猜中标记 -->
    <ScoreStrip />

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
    <ChatPanel :can-guess="canGuess" />

    <!-- 底部绘图工具栏：工具 / 颜色 / 线宽 / 历史操作（非画家时整条禁用） -->
    <DrawingToolbar
      v-model:tool="tool"
      v-model:color="color"
      :width="width"
      @width-change="width = $event"
      @clear="showClearConfirm = true"
    />

    <!-- 阶段遮罩：开局倒计时 / 画家选词 / 暂停 / 回合结算 / 最终结算 -->
    <PhaseOverlay
      :seconds-left="secondsLeft"
      :game="game"
      :rankings="rankings"
      @choose-word="store.chooseWord"
      @resume="store.resume"
      @open-end-confirm="showEndConfirm = true"
      @return-waiting="store.returnWaiting"
      @leave-room="store.leaveRoom"
    />

    <!-- 对局内设置使用舞台模态框，不离开当前游戏视图。 -->
    <GameSettingsDialog :open="showGameSettings" @close="showGameSettings = false" />

    <!-- 确认弹窗：清空画板 -->
    <ConfirmDialog
      :open="showClearConfirm"
      :title="strings.game.clearCanvasTitle"
      :body="strings.game.clearCanvasBody"
      :confirm-label="strings.game.confirmClear"
      :cancel-label="strings.common.cancel"
      :icon="Trash2"
      @cancel="showClearConfirm = false"
      @confirm="clearDrawing"
    />
    <!-- 确认弹窗：提前结束本局 -->
    <ConfirmDialog
      :open="showEndConfirm"
      :title="strings.game.endGameTitle"
      :body="strings.game.endGameBody"
      :confirm-label="strings.game.confirmEnd"
      :cancel-label="strings.common.cancel"
      :icon="X"
      @cancel="showEndConfirm = false"
      @confirm="store.endEarly"
    />
  </main>
</template>
