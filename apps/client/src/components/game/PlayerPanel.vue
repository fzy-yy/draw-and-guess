<!--
  对局常驻左栏（16cqw 黄金比例版）：
  只保留头衔信息（头像 / 昵称 / 分数 / 局内角色）与座位色条，
  宽度扩展至 16cqw（净宽 120px 以上），以充足空间展示 8~10 字长昵称；
  结构微调：左侧头像（4.6cqh），右侧两行清晰排布：第一行完整展示昵称，第二行并排展示分数与当前状态角色；
  画家仅通过「作画中」角色文案与画笔角标表达（无背景底色）；
  玩家本人通过卡片背景显示自身座位色浅色底表达（保留本人卡片自我高亮定位）；已猜中通过眼睛角标与文案表达，掉线用虚线边框与半透明底表达。
  宽度与高度由宿主（GameView 左栏 aside）给定：自身流内占位、不浮动、无标题栏、不可关闭。
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Brush, Eye } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { playSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { AvatarImage } from '@/components/common'
import { roleTextFor } from '@/utils/role-text'

const store = useGameStore()

// 头像右下角标（画家 / 已猜中）共用同一底座；提取常量避免长串在模板里逐字重复。
const memberBadgeClass =
  'absolute right-[-0.25cqh] bottom-[-0.15cqh] grid h-[2.1cqh] w-[2.1cqh] place-items-center rounded-full bg-blue text-white shadow-xs'

/**
 * 画家即时飘字动效：
 * 作画阶段其他玩家猜中时，在画家头像/卡片区域浮现金色「+20」动效（持续 1.2 秒），
 * 并伴随清脆的金币/得分音效（playSound('correct')）。
 */
interface ScoreFloat {
  id: number
  text: string
}

const drawerScoreFloats = ref<ScoreFloat[]>([])
let floatSequence = 0

// 监听房间内猜中玩家数量：当作画阶段猜中人数增加时，为当前画家触发 +20 浮动动效与音效
watch(
  () => {
    if (store.room?.phase !== 'drawing') return 0
    return store.room?.members.filter((m) => m.guessed).length ?? 0
  },
  (currentGuessedCount, prevGuessedCount) => {
    // 仅在作画阶段，且从更少的猜中数变为更多猜中数时触发
    if (
      store.room?.phase === 'drawing' &&
      typeof prevGuessedCount === 'number' &&
      currentGuessedCount > prevGuessedCount
    ) {
      // 触发清脆得分音效（复用 correct 音效）
      playSound('correct')

      // 创建一个飘字项
      const floatId = ++floatSequence
      drawerScoreFloats.value.push({ id: floatId, text: '+20' })

      // 1.2 秒后移除该飘字元素，与动画时长完全一致
      setTimeout(() => {
        drawerScoreFloats.value = drawerScoreFloats.value.filter((item) => item.id !== floatId)
      }, 1200)
    }
  },
)
</script>
<template>
  <aside
    v-if="store.room"
    class="flex h-full min-w-0 flex-col gap-[0.5cqh] overflow-y-auto overscroll-contain px-[0.5em] py-[0.7cqh]"
    :aria-label="strings.a11y.game.playersPanelTitle"
  >
    <article
      v-for="member in store.room.members"
      :key="member.id"
      class="grid min-h-[6cqh] min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-[0.45em] border-l-[0.32cqh] px-[0.45em] py-[0.35cqh]"
      :class="[
        member.guessed ? 'bg-green/10' : 'bg-white',
        member.connection !== 'online' && 'border-dashed bg-line/40',
      ]"
      :style="{
        '--seat-color': member.seatColor,
        borderLeftColor: member.seatColor,
        '--me-bg':
          member.id === store.playerId
            ? `color-mix(in srgb, ${member.seatColor} 14%, white)`
            : undefined,
        backgroundColor: member.id === store.playerId ? 'var(--me-bg)' : undefined,
      }"
    >
      <div class="relative">
        <AvatarImage
          class="h-[4.6cqh] w-[4.6cqh]"
          :avatar-id="member.avatarId"
          :label="strings.a11y.common.playerAvatarAria(member.nickname)"
        />
        <span v-if="member.isDrawer || member.guessed" :class="memberBadgeClass" aria-hidden="true">
          <Brush v-if="member.isDrawer" class="h-[62%] w-[62%]" />
          <Eye v-else-if="member.guessed" class="h-[62%] w-[62%]" />
        </span>

        <!-- 当其他玩家猜中时在画家头像处向上飘起金色 +20 浮动动效 -->
        <template v-if="member.isDrawer">
          <span
            v-for="item in drawerScoreFloats"
            :key="item.id"
            class="pointer-events-none absolute -top-[1.2cqh] left-1/2 -translate-x-1/2 font-bold text-yellow select-none text-fs-14 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] animate-[score-float-up_1.2s_ease-out_forwards]"
          >
            {{ item.text }}
          </span>
        </template>
      </div>
      <div class="flex min-w-0 flex-col gap-[0.2cqh] leading-tight">
        <!-- 第一行：完整展示昵称（8~10 字长昵称，不截断或优雅省略保护） -->
        <b class="truncate text-fs-12 text-navy" :title="member.nickname">{{ member.nickname }}</b>
        <!-- 第二行：并排展示分数（如 1280分）与当前状态角色（作画中 / 已猜中 / 猜词中） -->
        <div class="flex min-w-0 items-center justify-between gap-[0.3em]">
          <span class="shrink-0 text-blue text-fs-12 font-bold">{{
            strings.ui.common.scoreUnit(member.score)
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
      </div>
    </article>
  </aside>
</template>
