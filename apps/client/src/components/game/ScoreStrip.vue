<!--
  左侧玩家得分条（从 GameView.vue 拆出的子组件）：
  只有展示职责，列出全部成员、得分与画家/猜中标记；不发起任何请求。
-->
<script setup lang="ts">
import { Brush, Eye, Crown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import AvatarImage from '@/components/AvatarImage.vue'

const store = useGameStore()
</script>

<template>
  <!-- 左侧玩家得分条：列出全部成员、得分与画家/猜中标记 -->
  <aside
    v-if="store.room"
    class="flex min-w-0 flex-col gap-[0.8cqh] border-r-[0.2cqh] border-slate-400 bg-slate-100 px-[0.8cqw] py-[1.7cqh]"
    :aria-label="strings.game.scoreStripAria"
  >
    <article
      v-for="member in store.room.members"
      :key="member.id"
      class="grid min-h-[8.5cqh] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.55em] border-l-[0.35cqh] border-slate-400 bg-white px-[0.5em] py-[0.55cqh]"
      :class="{
        '!border-l-orange !bg-[#fff7ed]': member.isDrawer,
        '!border-l-green !bg-[#f0fdf4]': member.guessed,
        'opacity-55 border-dashed': member.connection === 'reconnecting',
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
        <b class="overflow-hidden text-ellipsis whitespace-nowrap text-[0.75em]">{{
          member.nickname
        }}</b
        ><span class="text-blue text-[0.7em] font-black">{{
          strings.common.scoreUnit(member.score)
        }}</span>
      </div>
      <Crown v-if="member.isHost" class="text-[#a16207]" :aria-label="strings.game.hostMarkAria" />
    </article>
  </aside>
</template>
