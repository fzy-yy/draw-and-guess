<!--
  应用根舞台：所有页面、弹层、连接反馈都约束在中央 16:9 容器内，舞台外不承载功能内容。
-->
<script setup lang="ts">
import { AlertCircle, CheckCircle2, Gamepad2, RotateCw, X } from 'lucide-vue-next'
import { useGameStore } from '@/stores/game'
import { useAudioFeedback } from '@/composables/useAudioFeedback'
import ProfileView from '@/views/ProfileView.vue'
import LobbyView from '@/views/LobbyView.vue'
import RoomView from '@/views/RoomView.vue'
import GameView from '@/views/GameView.vue'
import SettingsView from '@/views/SettingsView.vue'

const store = useGameStore()
useAudioFeedback()
</script>

<template>
  <div class="viewport-shell">
    <section class="game-stage" :aria-label="`${store.config.app.name} 游戏舞台`">
      <GameView v-if="store.room && store.room.phase !== 'waiting'" />
      <RoomView v-else-if="store.room" />
      <SettingsView v-else-if="store.page === 'settings'" />
      <LobbyView v-else-if="store.playerId && store.page === 'lobby'" />
      <ProfileView v-else />

      <div class="toast-stack" aria-live="polite" aria-label="操作通知">
        <div v-for="toast in store.toasts" :key="toast.id" class="toast" :class="toast.type">
          <CheckCircle2 v-if="toast.type === 'success'" />
          <AlertCircle v-else />
          <span>{{ toast.text }}</span>
          <button
            type="button"
            aria-label="关闭通知"
            @click="
              store.toasts.splice(
                store.toasts.findIndex((item) => item.id === toast.id),
                1,
              )
            "
          >
            <X />
          </button>
        </div>
      </div>

      <div
        v-if="store.invites.length && !store.room"
        class="invite-banner"
        role="dialog"
        aria-label="房间邀请"
      >
        <span
          class="solid-avatar"
          :style="{ backgroundColor: store.invites[0]?.from.avatarColor }"
          aria-label="邀请者纯色头像"
        ></span>
        <div>
          <span>收到房间邀请</span
          ><b>{{ store.invites[0]?.from.nickname }} 邀请你加入“{{ store.invites[0]?.roomName }}”</b>
        </div>
        <button
          class="secondary-action"
          type="button"
          @click="store.respondInvite(store.invites[0]!.id, false)"
        >
          拒绝
        </button>
        <button
          class="primary-action"
          type="button"
          @click="store.respondInvite(store.invites[0]!.id, true)"
        >
          <Gamepad2 />接受
        </button>
      </div>

      <div class="portrait-warning">
        <RotateCw />
        <h2>请横屏使用</h2>
        <p>旋转设备后即可获得完整的游戏舞台。</p>
      </div>
    </section>
  </div>
</template>
