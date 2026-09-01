<!--
  应用根舞台：所有页面、弹层、连接反馈都约束在中央 16:9 容器内，舞台外不承载功能内容。
  页面切换规则：
  - 在房间且非等待阶段 → 对局视图（GameView）
  - 在房间且等待阶段 → 房间等待视图（RoomView）
  - 未在房间：设置页 / 大厅 / 资料确认页 按 store.page 依次判断
-->
<script setup lang="ts">
// 图标库：系统/操作提示/邀请横幅使用的图标
import { AlertCircle, CheckCircle2, Gamepad2, RotateCw, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { useAudioFeedback } from '@/composables/useAudioFeedback'
import AvatarImage from '@/components/AvatarImage.vue'
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
  <div class="grid h-full w-full place-items-center overflow-hidden bg-[#111827]">
    <!-- 游戏舞台：16:9 容器，全部游戏内容都在此内部 -->
    <section
      class="relative aspect-[16/9] h-[min(99vh,calc(99vw*9/16))] w-[min(99vw,calc(99vh*16/9))] overflow-hidden rounded-[clamp(6px,1cqh,14px)] border-[max(1px,0.28cqh)] border-slate-700 bg-paper shadow-[0_1.2cqh_5cqh_#0009]"
      :aria-label="strings.app.stageAriaLabel(store.config.app.name)"
    >
      <!-- 四个页面视图按状态互斥渲染：对局 > 房间 > 设置 > 大厅 > 资料 -->
      <GameView v-if="store.room && store.room.phase !== 'waiting'" />
      <RoomView v-else-if="store.room" />
      <SettingsView v-else-if="store.page === 'settings'" />
      <LobbyView v-else-if="store.playerId && store.page === 'lobby'" />
      <ProfileView v-else />

      <!-- 操作通知 Toast 堆栈：右上角，成功/警告/错误三种风格；repeated 为防抖变色标记 -->
      <TransitionGroup
        name="toast"
        tag="div"
        class="absolute right-[1.2cqw] top-[12cqh] z-[70] flex w-[28cqw] flex-col gap-[0.8cqh] pointer-events-none"
        aria-live="polite"
        :aria-label="strings.app.toastStackAria"
      >
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="grid grid-cols-[auto_1fr_auto] items-center gap-[0.7em] border-l-[0.45cqh] px-[0.9em] py-[1.1cqh] text-[0.75em] font-extrabold shadow-[0_0.6cqh_2cqh_#0f172a44] pointer-events-auto"
          :class="[
            toast.type === 'warning'
              ? 'text-[#713f12] bg-[#fef3c7] border-l-[#ca8a04]'
              : toast.type === 'error'
                ? 'text-[#7f1d1d] bg-[#fee2e2] border-l-red'
                : 'text-[#14532d] bg-[#dcfce7] border-l-green',
            {
              repeated:
                'text-[#0c4a6e] bg-[#e0f2fe] border-l-[#0284c7] animate-[toast-pulse_0.5s_ease-in-out_2]',
            },
          ]"
        >
          <!-- 成功用对勾图标，其余用警示图标 -->
          <CheckCircle2 v-if="toast.type === 'success'" />
          <AlertCircle v-else />
          <span>{{ toast.text }}</span>
          <!-- 手动关闭按钮：从 toasts 数组移除该条（store 内做 index 边界保护） -->
          <button
            type="button"
            class="grid place-items-center bg-transparent text-current"
            :aria-label="strings.app.toastDismissAria"
            @click="store.dismissToast(toast.id)"
          >
            <X />
          </button>
        </div>
      </TransitionGroup>

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
          <button
            class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
            type="button"
            @click="store.respondInvite(store.invites[0]!.id, false)"
          >
            {{ strings.common.decline }}
          </button>
          <button
            class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
            type="button"
            @click="store.respondInvite(store.invites[0]!.id, true)"
          >
            <Gamepad2 />{{ strings.common.accept }}
          </button>
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
