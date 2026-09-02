<!--
  左侧玩家得分条（从 GameView.vue 拆出的子组件）：
  只有展示职责，列出全部成员、得分与画家/猜中标记；不发起任何请求。
-->
<script setup lang="ts">
import { Brush, Eye, Crown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import AvatarImage from '@/components/AvatarImage.vue'

const store = useGameStore()

/** 当前成员在局内的角色文案（与聊天区角色标签一致）。 */
function roleText(member: RoomMember): string {
  if (member.leftGame) return strings.status.roleLeftGame
  if (member.isDrawer) return strings.status.roleDrawing
  if (member.guessed) return strings.status.roleGuessed
  if (member.spectating) return strings.status.roleSpectating
  return strings.status.roleGuessing
}
</script>

<template>
  <!-- 左侧玩家得分条：列出全部成员、得分与画家/猜中标记 -->
  <aside
    v-if="store.room"
    class="flex min-w-0 flex-col gap-[0.8cqh] border-r-[0.2cqh] border-line bg-line px-[0.8cqw] py-[1.7cqh]"
    :aria-label="strings.game.scoreStripAria"
  >
    <article
      v-for="member in store.room.members"
      :key="member.id"
      class="grid min-h-[8.5cqh] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.55em] border-l-[0.35cqh] border-line bg-white px-[0.5em] py-[0.55cqh]"
      :class="{
        '!bg-green/10': member.guessed,
        'opacity-55 border-dashed': member.connection !== 'online',
      }"
      :style="{
        '--seat-color': member.seatColor,
        borderLeftColor: member.seatColor,
        backgroundColor: member.isDrawer
          ? `color-mix(in srgb, ${member.seatColor} 12%, white)`
          : undefined,
      }"
    >
      <div class="relative">
        <AvatarImage
          class="h-[5.8cqh] w-[5.8cqh]"
          :avatar-id="member.avatarId"
          :label="strings.common.playerAvatarAria(member.nickname)"
        />
        <Brush
          v-if="member.isDrawer"
          class="absolute -right-[0.3cqh] -bottom-[0.2cqh] h-[2.4cqh] w-[2.4cqh] p-[0.35cqh] text-white bg-blue rounded-full"
        /><Eye
          v-else-if="member.guessed"
          class="absolute -right-[0.3cqh] -bottom-[0.2cqh] h-[2.4cqh] w-[2.4cqh] p-[0.35cqh] text-white bg-blue rounded-full"
        />
      </div>
      <div class="min-w-0 flex flex-col">
        <b class="overflow-hidden text-ellipsis whitespace-nowrap text-[0.75em] text-navy">{{
          member.nickname
        }}</b
        ><span class="text-blue text-[0.7em] font-black">{{
          strings.common.scoreUnit(member.score)
        }}</span
        ><span
          class="text-muted text-[0.58em] font-extrabold"
          :class="
            member.isDrawer
              ? 'bg-[linear-gradient(90deg,var(--seat-color),#172033,var(--seat-color))] bg-[length:200%_100%] bg-clip-text text-transparent animate-[drawer-role-flow_1.4s_linear_infinite]'
              : ''
          "
          >{{ roleText(member) }}</span
        >
      </div>
      <Crown v-if="member.isHost" class="text-yellow" :aria-label="strings.game.hostMarkAria" />
      <span
        v-else-if="member.id === store.playerId"
        class="grid h-[2.6cqh] w-[2.6cqh] place-items-center rounded-full bg-blue text-[0.58em] font-black text-white"
        >{{ strings.room.meTag }}</span
      >
    </article>
  </aside>
</template>
