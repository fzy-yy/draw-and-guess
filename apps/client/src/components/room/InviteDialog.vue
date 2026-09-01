<!--
  邀请在线玩家弹窗（房主或允许邀请的成员）——列出空闲且允许接收邀请的在线玩家，点击即发送邀请。
  原 RoomView.vue 邀请弹窗迁入本组件，基于 BaseDialog 复用外壳；可用玩家列表内部计算。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Send } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import { useGameStore } from '@/stores/game'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()

// 可邀请玩家：当前空闲的在线玩家（排除自己）。
// 「是否允许接收邀请」不在公开资料中下发，由服务端 sendInvite 侧校验并拒绝。
const availablePlayers = computed(() =>
  store.presence.players.filter(
    (player) => player.id !== store.playerId && player.status === 'idle',
  ),
)
</script>

<template>
  <BaseDialog
    :open="props.open"
    width-class="w-[52cqw]"
    labelledby="invite-title"
    :close-aria="strings.room.inviteCloseAria"
    @close="emit('close')"
  >
    <template #header>
      <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
        {{ strings.room.inviteLabel }}
      </p>
      <h2 id="invite-title">{{ strings.room.inviteTitle }}</h2>
    </template>

    <!-- 可邀请玩家按钮列表：点击即发送邀请 -->
    <div class="min-h-[40cqh] py-[2cqh] px-[2em]">
      <div class="flex flex-col gap-[0.7cqh]">
        <button
          v-for="player in availablePlayers"
          :key="player.id"
          type="button"
          class="flex items-center gap-[0.7em] py-[0.65cqh] px-[0.7em] text-left text-ink bg-white border-solid border-[0.16cqh] border-line rounded-[0.6em]"
          @click="store.invite(player.id)"
        >
          <AvatarImage
            class="h-[4.7cqh] w-[4.7cqh]"
            :avatar-id="player.avatarId"
            :label="strings.common.playerAvatarAria(player.nickname)"
          />
          <b class="flex-1">{{ player.nickname }}</b
          ><Send />
        </button>
        <p v-if="!availablePlayers.length">{{ strings.room.inviteEmpty }}</p>
      </div>
    </div>
  </BaseDialog>
</template>
