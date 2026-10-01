<!--
  对局常驻左栏（收窄版，替代旧的左侧得分条）：
  只保留头衔信息（头像 / 昵称 / 分数 / 局内角色）与座位色条，去掉「我」标记与多余留白，
  以更窄的宽度容纳 6 人；数据仍来自真实 room 快照（store.room.members），字段语义不变。
  画家 / 已猜中通过头像角标表达，掉线用虚线边框与半透明底表达。
  宽度与高度由宿主（对局常驻左栏）给定：自身占位、不浮动、无标题栏、不可关闭。
-->
<script setup lang="ts">
import { Brush, Eye } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { AvatarImage } from '@/components/common'
import { roleTextFor } from '@/utils/role-text'

const store = useGameStore()

// 头像右下角标（画家 / 已猜中）共用同一底座；提取常量避免长串在模板里逐字重复。
const memberBadgeClass =
  'absolute right-[-0.25cqh] bottom-[-0.15cqh] h-[2.1cqh] w-[2.1cqh] rounded-full bg-blue p-[0.3cqh] text-white'
</script>

<template>
  <aside
    v-if="store.room"
    class="flex h-full min-w-0 flex-col gap-[0.5cqh] overflow-y-auto overscroll-contain px-[0.5em] py-[0.7cqh]"
    :aria-label="strings.game.playersPanelTitle"
  >
    <article
      v-for="member in store.room.members"
      :key="member.id"
      class="grid min-h-[6cqh] min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-[0.45em] rounded-[0.35em] border-l-[0.32cqh] px-[0.45em] py-[0.35cqh]"
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
          class="h-[4.6cqh] w-[4.6cqh]"
          :avatar-id="member.avatarId"
          :label="strings.common.playerAvatarAria(member.nickname)"
        />
        <Brush v-if="member.isDrawer" :class="memberBadgeClass" /><Eye
          v-else-if="member.guessed"
          :class="memberBadgeClass"
        />
      </div>
      <div class="flex min-w-0 flex-col leading-tight">
        <b class="truncate text-fs-12 text-navy">{{ member.nickname }}</b>
        <span class="text-blue text-fs-12 font-bold">{{
          strings.common.scoreUnit(member.score)
        }}</span>
        <span
          class="truncate text-fs-10 font-bold"
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
    </article>
  </aside>
</template>
