<!--
  接龙共用玩家 chip（S73）：头像 + 昵称 + **按条件显示**的右下角画笔角标。
  对局期的「上一家」与复盘期的「画家 / 猜词者」共用同一实现，保证顶栏视觉语言统一。

  角标语义：只表达「此人在这一段里是**动手画**的那个人」——他画了你正在看的画就有角标，
  他只留给你一句词 / 一个答案就没有角标（S74）。角标底座与经典玩家面板同款（player-badge.ts），
  不另造样式；chip 自身只服务于顶栏（深蓝底），故用半透明白底衬出层次。
-->
<script setup lang="ts">
import { Brush } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { RelayPlayerRef } from '@draw-guess/shared'
import AvatarImage from '@/components/common/AvatarImage.vue'
import { PLAYER_BADGE_CLASS } from '@/components/game/player-badge.ts'

const props = withDefaults(
  defineProps<{
    /** 玩家极小资料（id / 昵称 / 头像编号），来自接龙快照。 */
    player: RelayPlayerRef
    /** 是否挂画笔角标：本段里此人是作画者。 */
    brushBadge?: boolean
  }>(),
  { brushBadge: false },
)
</script>

<template>
  <div
    class="flex min-w-0 shrink-0 items-center gap-[0.45em] rounded-[0.65em] bg-white/10 px-[0.6em] py-[0.5cqh]"
  >
    <!-- 头像容器：角标相对它定位，保证角标始终贴在头像右下角 -->
    <span class="relative shrink-0">
      <AvatarImage
        class="h-[4.6cqh] w-[4.6cqh]"
        :avatar-id="props.player.avatarId"
        :label="strings.a11y.common.playerAvatarAria(props.player.nickname)"
      />
      <span v-if="props.brushBadge" :class="PLAYER_BADGE_CLASS" aria-hidden="true">
        <Brush class="h-[62%] w-[62%]" />
      </span>
    </span>
    <b class="max-w-[6.5em] truncate text-fs-12 text-white">{{ props.player.nickname }}</b>
  </div>
</template>
