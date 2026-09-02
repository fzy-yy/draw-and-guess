<!--
  应用根舞台：所有页面、弹层、连接反馈都约束在中央 16:9 容器内，舞台外不承载功能内容。
  页面切换规则：
  - 在房间且非等待阶段 → 对局视图（GameView）
  - 在房间且等待阶段 → 房间等待视图（RoomView）
  - 未在房间：设置页 / 大厅 / 资料确认页 按 store.page 依次判断
-->
<script setup lang="ts">
// 图标库：系统/操作提示/邀请横幅使用的图标
import { Gamepad2, LoaderCircle, RotateCw, WifiOff } from 'lucide-vue-next'
import { Toaster } from 'vue-sonner'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { useAudioFeedback } from '@/composables/useAudioFeedback'
import AvatarImage from '@/components/AvatarImage.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import AppButton from '@/components/AppButton.vue'
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
</script>

<template>
  <!-- 视口外壳：把舞台整体居中在屏幕中央 -->
  <div class="grid h-full w-full place-items-center overflow-hidden bg-navy">
    <!-- 游戏舞台：16:9 容器，全部游戏内容都在此内部 -->
    <section
      class="game-stage relative aspect-[16/9] h-[min(99vh,calc(99vw*9/16))] w-[min(99vw,calc(99vh*16/9))] overflow-hidden rounded-[clamp(6px,1cqh,14px)] border-[max(1px,0.28cqh)] border-navy bg-paper shadow-[0_1.2cqh_5cqh_#0009]"
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

      <!-- 操作通知 Toast 堆栈：由 vue-sonner 的 <Toaster /> 承载渲染与堆栈动画，
           通知内容通过 store.notify 触发（见 stores/game.ts 的 vue-sonner 转译）。
           自定义容器单位定位，保证与旧版 Toast 一样落在舞台内右上角。 -->
      <Toaster
        :position="'top-right'"
        :toast-options="{
          style: {
            fontSize: '0.75em',
            fontWeight: 800,
            background: '#f8fafc',
            color: '#172033',
            borderLeft: '0.45cqh solid #facc15',
            borderRadius: '0.7em',
            boxShadow: '0 0.6cqh 2cqh #0f172a44',
          },
        }"
      />

      <!-- 房间邀请横幅：不在房间时收到邀请才会显示，可接受或拒绝 -->
      <Transition name="banner">
        <div
          v-if="store.invites.length && !store.room"
          class="absolute bottom-[3cqh] left-1/2 z-[50] grid min-h-[10cqh] w-[66cqw] grid-cols-[auto_1fr_auto_auto] items-center gap-[1em] border-[0.3cqh] border-blue border-l-[1cqh] bg-white px-[1em] py-[1cqh] shadow-[0_1cqh_3cqh_#0f172a55] -translate-x-1/2"
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
          <AppButton variant="secondary" @click="store.respondInvite(store.invites[0]!.id, false)">
            {{ strings.common.decline }}
          </AppButton>
          <AppButton @click="store.respondInvite(store.invites[0]!.id, true)">
            <Gamepad2 />{{ strings.common.accept }}
          </AppButton>
        </div>
      </Transition>

      <!-- 竖屏警告：手机竖屏时全屏提示旋转设备（见 index.css） -->
      <div class="portrait-warning">
        <RotateCw />
        <h2>{{ strings.app.portraitTitle }}</h2>
        <p>{{ strings.app.portraitHint }}</p>
      </div>
    </section>
  </div>
</template>
