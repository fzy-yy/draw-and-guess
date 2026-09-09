<!--
  应用根舞台：所有页面、弹层、连接反馈都约束在中央 16:9 容器内，舞台外不承载功能内容。
  页面切换规则：
  - 在房间且非等待阶段 → 对局视图（GameView）
  - 在房间且等待阶段 → 房间等待视图（RoomView）
  - 未在房间：设置页 / 大厅 / 资料确认页 按 store.page 依次判断
-->
<script setup lang="ts">
// 图标库：系统/操作提示/邀请横幅使用的图标
import { Gamepad2, LoaderCircle, LogOut, Maximize, RotateCw, WifiOff } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { useAudioFeedback } from '@/composables/useAudioFeedback'
import { useAppBootstrap } from '@/composables/useAppBootstrap'
import { useFullscreenPrompt } from '@/composables/useFullscreenPrompt'
import { useInviteQueue } from '@/composables/useInviteQueue'
import { ActionBanner, AppButton, AppToaster, AvatarImage, BaseDialog } from '@/components/common'
import { defineLazyComponent } from '@/utils/lazy-component'
// 四个视图组件：对局、房间等待、大厅、资料确认（进入对局的关键链路，保持静态导入）
import ProfileView from '@/views/ProfileView.vue'
import LobbyView from '@/views/LobbyView.vue'
import RoomView from '@/views/RoomView.vue'
import GameView from '@/views/GameView.vue'

// 设置页属低频模块：懒加载，不进首屏包（加载/失败兜底见 utils/lazy-component.ts）
const SettingsView = defineLazyComponent(() => import('@/views/SettingsView.vue'))

// 获取全局游戏 store（连接、身份、房间、对局状态）
const store = useGameStore()
const bootstrap = useAppBootstrap()
bootstrap.start()
// 挂载全局音效反馈（HTML5 Audio 驱动自定义音效，随阶段/事件触发）
useAudioFeedback()
const inviteQueue = useInviteQueue()
const fullscreenPrompt = useFullscreenPrompt()

function reloadForProtocolUpdate(): void {
  window.location.reload()
}
</script>

<template>
  <!-- 视口外壳：把舞台整体居中在视口中央，背景默认为黑色变量（bg-black / --color-black） -->
  <div class="relative grid h-full w-full place-items-center overflow-hidden bg-black">
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
        :open="store.protocolMismatch"
        :dismissible="false"
        overlay-class="z-[100]"
        width-class="w-[47cqw]"
        section-class="items-center gap-[1em] px-[2.2em] py-[4.5cqh] text-center"
        :aria-label="strings.app.protocolMismatchAria"
      >
        <div
          class="grid h-[10cqh] w-[10cqh] place-items-center rounded-full bg-red/10 text-red"
          aria-hidden="true"
        >
          <RotateCw class="h-[5cqh] w-[5cqh]" />
        </div>
        <h2 class="text-fs-24 font-bold text-navy">{{ strings.app.protocolMismatchTitle }}</h2>
        <p class="max-w-[37cqw] text-fs-14 font-bold leading-relaxed text-muted" role="alert">
          {{ strings.app.protocolMismatchBody }}
        </p>
        <template #footer>
          <AppButton type="button" @click="reloadForProtocolUpdate">
            <RotateCw />{{ strings.app.protocolMismatchAction }}
          </AppButton>
        </template>
      </BaseDialog>

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
        <h2 class="text-fs-24 font-bold text-navy">
          {{
            store.sessionState === 'disconnected'
              ? strings.app.disconnectedTitle
              : strings.app.restoringTitle
          }}
        </h2>
        <p class="max-w-[37cqw] text-fs-14 font-bold leading-relaxed text-muted" role="status">
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
      <ActionBanner
        :open="Boolean(store.invites.length && !store.room)"
        :aria-label="strings.app.inviteDialogAria"
        :heading="strings.app.inviteHeading"
        :message="
          strings.app.inviteReceived(
            store.invites[0]?.from.nickname ?? '',
            store.invites[0]?.roomName ?? '',
          )
        "
      >
        <template #leading>
          <!-- 邀请者内置 SVG 头像 -->
          <AvatarImage
            :avatar-id="store.invites[0]?.from.avatarId"
            :label="strings.app.inviterAvatarAria"
            class="h-[6.5cqh] w-[6.5cqh]"
          />
        </template>
        <template #actions>
          <AppButton
            variant="secondary"
            :aria-label="
              strings.common.declineCountdown(Math.max(0, inviteQueue.rejectCountdown.value))
            "
            @click="inviteQueue.decline"
          >
            <!--
              倒计时数字用固定 2ch 宽度 + tabular-nums 承载：位数变化（10→9）时按钮宽度不变，
              与画板线宽数字的防抖动方案一致（见 DrawingToolbar）。
            -->
            {{ strings.common.decline
            }}<span class="inline-block min-w-[2ch] text-center tabular-nums">{{
              Math.max(0, inviteQueue.rejectCountdown.value)
            }}</span>
          </AppButton>
          <AppButton
            :aria-label="strings.common.accept"
            :disabled="!store.invites[0]"
            @click="inviteQueue.accept"
          >
            <Gamepad2 />{{ strings.common.accept }}
          </AppButton>
        </template>
      </ActionBanner>

      <!-- 大厅首次全屏提示横幅：首次进入大厅且当前未全屏时弹出 -->
      <ActionBanner
        :open="fullscreenPrompt.showFullscreenPrompt.value"
        :aria-label="strings.lobby.fullscreenPromptAria"
        :heading="strings.lobby.fullscreenPromptHeading"
        :message="strings.lobby.fullscreenPromptBody"
      >
        <template #leading>
          <div
            class="grid h-[6.5cqh] w-[6.5cqh] place-items-center rounded-full bg-sky/30 text-blue"
            aria-hidden="true"
          >
            <Maximize class="h-[3.6cqh] w-[3.6cqh]" />
          </div>
        </template>
        <template #actions>
          <AppButton variant="secondary" @click="fullscreenPrompt.dismiss">
            {{ strings.lobby.fullscreenPromptDismiss }}
          </AppButton>
          <AppButton @click="fullscreenPrompt.confirm">
            <Maximize />{{ strings.lobby.fullscreenPromptConfirm }}
          </AppButton>
        </template>
      </ActionBanner>

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
  </div>
</template>
