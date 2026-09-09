<!--
  左侧玩家得分条（从 GameView.vue 拆出的子组件）：
  只有展示职责，列出全部成员、得分与画家/猜中标记；不发起任何请求。
  成员较多时列表内部滚动，避免行被容器裁剪而“看不到部分玩家”。
  游戏内不展示房主标志（房主皇冠仅在房间等待界面的席位中显示）。
-->
<script setup lang="ts">
import { Brush, Eye } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import AvatarImage from '@/components/common/AvatarImage.vue'
import { roleTextFor } from '@/utils/role-text'

const store = useGameStore()
</script>

<template>
  <!-- 左侧玩家得分条：列出全部成员、得分与画家/猜中标记；超出可视高度时内部滚动 -->
  <aside
    v-if="store.room"
    class="flex min-w-0 flex-col gap-[0.8cqh] overflow-y-auto overscroll-contain border-r-[0.2cqh] border-line bg-paper px-[0.8cqw] py-[1.7cqh] scrollbar-gutter-stable compact-tight"
    :aria-label="strings.game.scoreStripAria"
  >
    <article
      v-for="member in store.room.members"
      :key="member.id"
      class="grid min-h-[8.5cqh] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.55em] border-l-[0.35cqh] border-line px-[0.5em] py-[0.55cqh]"
      :class="[
        member.guessed ? 'bg-green/10' : 'bg-white',
        member.connection !== 'online' && 'border-dashed bg-line/40',
      ]"
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
          class="absolute right-[-0.3cqh] bottom-[-0.2cqh] h-[2.4cqh] w-[2.4cqh] p-[0.35cqh] text-white bg-blue rounded-full"
        /><Eye
          v-else-if="member.guessed"
          class="absolute right-[-0.3cqh] bottom-[-0.2cqh] h-[2.4cqh] w-[2.4cqh] p-[0.35cqh] text-white bg-blue rounded-full"
        />
      </div>
      <div class="min-w-0 flex flex-col">
        <b class="overflow-hidden text-ellipsis whitespace-nowrap text-fs-12 text-navy">{{
          member.nickname
        }}</b>
        <span class="text-blue text-fs-12 font-bold">{{
          strings.common.scoreUnit(member.score)
        }}</span>
        <span
          class="text-fs-10 font-bold"
          :class="[
            member.isDrawer
              ? 'bg-[linear-gradient(90deg,var(--seat-color),var(--color-navy),var(--seat-color))] bg-size-[200%_100%] bg-clip-text text-transparent animate-[drawer-role-flow_1.4s_linear_infinite]'
              : member.guessed
                ? 'text-warning-fg'
                : 'text-muted',
          ]"
          >{{ roleTextFor(member) }}</span
        >
      </div>
      <!-- 行尾标记：自己的「我」标记（游戏内不展示房主皇冠） -->
      <span
        v-if="member.id === store.playerId"
        class="grid h-[2.6cqh] w-[2.6cqh] shrink-0 place-items-center rounded-full bg-blue text-fs-10 font-bold text-white"
        >{{ strings.room.meTag }}</span
      >
    </article>
  </aside>
</template>
