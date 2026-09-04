<!--
  应用根舞台：所有页面、弹层、连接反馈都约束在中央 16:9 容器内，舞台外不承载功能内容。
  页面切换规则：
  - 在房间且非等待阶段 → 对局视图（GameView）
  - 在房间且等待阶段 → 房间等待视图（RoomView）
  - 未在房间：设置页 / 大厅 / 资料确认页 按 store.page 依次判断
-->
<script setup lang="ts">
// 图标库：系统/操作提示/邀请横幅使用的图标
import { ref, watch } from 'vue'
import { Gamepad2, LoaderCircle, LogOut, RotateCw, WifiOff } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { useAudioFeedback } from '@/composables/useAudioFeedback'
import AvatarImage from '@/components/common/AvatarImage.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import StageBackdrop from '@/components/common/StageBackdrop.vue'
import AppToaster from '@/components/common/AppToaster.vue'
// 五个视图组件：对局、房间等待、设置、大厅、资料确认
import ProfileView from '@/views/ProfileView.vue'
import LobbyView from '@/views/LobbyView.vue'
import RoomView from '@/views/RoomView.vue'
import GameView from '@/views/GameView.vue'
import SettingsView from '@/views/SettingsView.vue'

// 获取全局游戏 store（连接、身份、房间、对局状态）
const store = useGameStore()
// 挂载全局音效反馈（Web Audio 合成提示音，随阶段/事件触发）
useAudioFeedback()

// ---- 邀请横幅「拒绝」倒计时 ----
// 秒数从 config/ui.inviteRejectCountdownSeconds 读取（禁止硬编码）；
// 倒计时结束自动拒绝当前邀请，避免横幅无限期驻留（服务端邀请本身也会过期）。
const rejectCountdown = ref(store.config.ui.inviteRejectCountdownSeconds)
let rejectTimer: number | undefined

/** 清除拒绝倒计时定时器（新邀请到达或横幅消失时调用）。 */
function stopRejectCountdown(): void {
  window.clearInterval(rejectTimer)
  rejectTimer = undefined
}

/**
 * 启动（或重新启动）队首邀请的拒绝倒计时。
 * 从配置秒数重新计时：新邀请到达、以及「进房又退出后横幅重新出现」两种场景
 * （此时队首邀请未变，仅靠 watch id 不会重启定时器，倒计时会冻结在旧值）。
 */
function startRejectCountdown(): void {
  stopRejectCountdown()
  const current = store.invites[0]
  if (!current || store.room) return
  rejectCountdown.value = store.config.ui.inviteRejectCountdownSeconds
  rejectTimer = window.setInterval(() => {
    rejectCountdown.value -= 1
    if (rejectCountdown.value <= 0) {
      stopRejectCountdown()
      // 倒计时归零：自动拒绝队首邀请（服务端会同步清理邀请状态）。
      // 队首可能在计时期间已被应答/失效，先确认仍存在再发送。
      const pending = store.invites[0]
      if (pending) void store.respondInvite(pending.id, false)
    }
  }, 1_000)
}

// 队首邀请变化时重新开始倒计时（含初始化）。
watch(
  () => store.invites[0]?.id,
  () => startRejectCountdown(),
  { immediate: true },
)

// 横幅可见性变化：邀请消失（接受/拒绝/过期）时停表；进房又退房后横幅重新出现时重开倒计时。
watch(
  () => store.invites.length && !store.room,
  (visible) => {
    if (visible) startRejectCountdown()
    else stopRejectCountdown()
  },
)

/** 拒绝队首邀请：先停表再发送拒绝（按钮点击入口；点击时队首必然渲染在场）。 */
function declineCurrentInvite(): void {
  stopRejectCountdown()
  const current = store.invites[0]
  if (current) void store.respondInvite(current.id, false)
}
</script>

<template>
  <!-- 视口外壳（背景独立组件）：把舞台整体居中，后续背景特效统一在 StageBackdrop 内叠加 -->
  <StageBackdrop>
    <!-- 游戏舞台：16:9 容器，全部游戏内容都在此内部（投影用语义令牌 shadow-float） -->
    <section
      class="game-stage relative aspect-video h-[min(99vh,calc(99vw*9/16))] w-[min(99vw,calc(99vh*16/9))] overflow-hidden rounded-[clamp(6px,1cqh,14px)] border-[max(1px,0.28cqh)] border-navy bg-paper shadow-float"
      :aria-label="strings.app.stageAriaLabel(store.config.app.name)"
    >
      <!-- 四个页面视图按状态互斥渲染：对局 > 房间 > 设置 > 大厅 > 资料 -->
      <GameView v-if="store.room && store.room.phase !== 'waiting'" />
      <RoomView v-else-if="store.room" />
      <SettingsView v-else-if="store.page === 'settings'" @back="store.page = 'lobby'" />
      <LobbyView v-else-if="store.playerId && store.page === 'lobby'" />
      <ProfileView v-else />

      <!-- 本人断线/会话恢复阻断框：Socket 重连后仍保持，直到身份与权威 room|null 同步完成。 -->
      <BaseDialog
        :open="store.sessionState === 'disconnected' || store.sessionState === 'restoring'"
        :dismissible="false"
        overlay-class="z-[90]"
        width-class="w-[47cqw]"
        section-class="items-center gap-[1em] px-[2.2em] py-[4.5cqh] text-center"
        :aria-label="strings.app.disconnectDialogAria"
      >
        <div
          class="grid h-[10cqh] w-[10cqh] place-items-center rounded-full bg-red/10 text-red"
          aria-hidden="true"
        >
          <WifiOff v-if="store.sessionState === 'disconnected'" class="h-[5cqh] w-[5cqh]" />
          <LoaderCircle v-else class="h-[5cqh] w-[5cqh] animate-spin" />
        </div>
        <h2 class="text-[1.45em] font-black text-navy">
          {{
            store.sessionState === 'disconnected'
              ? strings.app.disconnectedTitle
              : strings.app.restoringTitle
          }}
        </h2>
        <p class="max-w-[37cqw] text-[0.82em] font-bold leading-relaxed text-muted" role="status">
          {{
            store.sessionState === 'disconnected'
              ? strings.app.disconnectedBody
              : strings.app.restoringBody
          }}
        </p>
      </BaseDialog>

      <!-- 操作通知 Toast 堆栈：自实现了 AppToaster（使用 useToasts 状态层），
           通知内容通过 store.notify 触发（见 stores/game.ts）。它在画框内右上角渲染。 -->
      <AppToaster />

      <!-- 房间邀请横幅：不在房间时收到邀请才会显示，可接受或拒绝 -->
      <Transition name="banner">
        <div
          v-if="store.invites.length && !store.room"
          class="absolute bottom-[3cqh] left-1/2 z-50 grid min-h-[10cqh] w-[66cqw] grid-cols-[auto_1fr_auto_auto] items-center gap-[1em] border-[0.3cqh] border-blue border-l-[1cqh] bg-white px-[1em] py-[1cqh] shadow-float -translate-x-1/2"
          role="dialog"
          :aria-label="strings.app.inviteDialogAria"
        >
          <!-- 邀请者内置 SVG 头像 -->
          <AvatarImage
            :avatar-id="store.invites[0]?.from.avatarId"
            :label="strings.app.inviterAvatarAria"
            class="h-[6.5cqh] w-[6.5cqh]"
          />
          <div class="flex flex-col">
            <span class="text-blue text-[0.65em]">{{ strings.app.inviteHeading }}</span
            ><b>{{
              strings.app.inviteReceived(
                store.invites[0]?.from.nickname ?? '',
                store.invites[0]?.roomName ?? '',
              )
            }}</b>
          </div>
          <AppButton
            variant="secondary"
            :aria-label="strings.common.declineCountdown(Math.max(0, rejectCountdown))"
            @click="declineCurrentInvite"
          >
            <!--
              倒计时数字用固定 2ch 宽度 + tabular-nums 承载：位数变化（10→9）时按钮宽度不变，
              与画板线宽数字的防抖动方案一致（见 DrawingToolbar）。
            -->
            {{ strings.common.decline
            }}<span class="inline-block min-w-[2ch] text-center tabular-nums">{{
              Math.max(0, rejectCountdown)
            }}</span>
          </AppButton>
          <AppButton
            :aria-label="strings.common.accept"
            :disabled="!store.invites[0]"
            @click="store.invites[0] && store.respondInvite(store.invites[0].id, true)"
          >
            <Gamepad2 />{{ strings.common.accept }}
          </AppButton>
        </div>
      </Transition>

      <!-- 被房主移出房间提示框：模态弹窗确保玩家知晓被踢（此前仅一闪而过的 Toast）。
           footer-class 必须占满整行：section 为 items-center 时 footer 会收缩成按钮宽度，
           在白色卡片中央留下一块突兀的灰色方框（曾是用户标注的 bug） -->
      <BaseDialog
        :open="store.kickedNotice"
        width-class="w-[42cqw]"
        section-class="items-center gap-[1.4cqh] pt-[3cqh] text-center"
        footer-class="w-full"
        labelledby="kicked-title"
        @close="store.dismissKickedNotice"
      >
        <div
          class="grid h-[9cqh] w-[9cqh] place-items-center rounded-full bg-red/10 text-red"
          aria-hidden="true"
        >
          <LogOut class="h-[4.5cqh] w-[4.5cqh]" />
        </div>
        <h2 id="kicked-title">{{ strings.app.kickedTitle }}</h2>
        <p class="max-w-[30em] text-muted leading-[1.6]">{{ strings.app.kickedBody }}</p>
        <template #footer>
          <AppButton variant="primary" type="button" @click="store.dismissKickedNotice">
            {{ strings.app.kickedConfirm }}
          </AppButton>
        </template>
      </BaseDialog>

      <!-- 竖屏警告：手机竖屏时全屏提示旋转设备（见 index.css） -->
      <div class="portrait-warning">
        <RotateCw />
        <h2>{{ strings.app.portraitTitle }}</h2>
        <p>{{ strings.app.portraitHint }}</p>
      </div>
    </section>
  </StageBackdrop>
</template>
