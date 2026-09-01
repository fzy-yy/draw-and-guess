<!--
  各阶段全屏遮罩（从 GameView.vue 拆出的子组件）：
  覆盖开局倒计时 / 画家选词 / 暂停 / 回合结算 / 最终结算。
  该组件读 store 的公开状态；HUD 派生值（剩余秒数/对局数据/排行）由父组件经 props 传入；
  需要交由父组件裁决或弹窗的动作一律用事件抛出
  （choose-word / resume / open-end-confirm / return-waiting / leave-room）。
  注：外层的 display:contents 只是为了让多个定位遮罩不参与父级 grid 布局，同时保留 TS 窄化。
-->
<script setup lang="ts">
import { Brush, CirclePause, CirclePlay, Trophy } from 'lucide-vue-next'
import type { GameView } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import type { RankedMember } from '@/composables/useGameHud'
import AppButton from '@/components/AppButton.vue'
import AvatarImage from '@/components/AvatarImage.vue'

// 阶段遮罩需要的 HUD 派生值（剩余秒数、对局数据、最终排行）由父组件 GameView
// 统一计算后经 props 下发，整局只保留一个 ticker（不再此处单独起定时器）。
defineProps<{
  /** 当前阶段剩余秒数（开局倒计时/自动选词提示用）。 */
  secondsLeft: number
  /** 对局视图（候选词/回合结算/答案等）。 */
  game: GameView | undefined
  /** 最终结算的排名列表（带同名次位次）。 */
  rankings: RankedMember[]
}>()
const emit = defineEmits<{
  'choose-word': [wordId: string]
  resume: []
  'open-end-confirm': []
  'return-waiting': []
  'leave-room': []
}>()

const store = useGameStore()
</script>

<template>
  <!-- display:contents —— 让遮罩不占 grid 格子，同时用 v-if 保证 store.room 与 game 已就绪 -->
  <div v-if="store.room && game" class="contents">
    <!-- 阶段遮罩：开局倒计时 -->
    <div
      v-if="store.room.phase === 'starting'"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh] text-white"
    >
      <span>{{ strings.game.countdownTitle }}</span
      ><b
        class="grid place-items-center h-[20cqh] w-[20cqh] my-[2cqh] bg-yellow text-navy rounded-full text-[6em]"
        >{{ secondsLeft }}</b
      >
      <p>{{ strings.game.countdownHint }}</p>
    </div>
    <!-- 阶段遮罩：画家选词（只有画家可见候选词按钮） -->
    <div
      v-else-if="store.room.phase === 'choosing_word' && store.isDrawer"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[50cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      >
        <Brush class="h-[8cqh] w-[8cqh] bg-blue p-[1.4cqh] text-white rounded-full" />
        <p>{{ strings.game.yourTurn }}</p>
        <h2>{{ strings.game.chooseWordTitle }}</h2>
        <div class="flex gap-[1em] my-[2cqh]">
          <button
            v-for="option in game.wordOptions ?? []"
            :key="option.id"
            type="button"
            class="min-h-[7cqh] min-w-[12cqw] rounded-[0.7em] bg-yellow border-b-[0.6cqh] border-[#ca8a04] text-navy px-[1em] text-[1.25em] font-[1000]"
            @click="emit('choose-word', option.id)"
          >
            {{ option.text }}
          </button>
        </div>
        <span>{{ strings.game.autoChoose(secondsLeft) }}</span>
      </section>
    </div>
    <!-- 阶段遮罩：游戏暂停（房主可继续或提前结束） -->
    <div
      v-else-if="store.room.phase === 'paused'"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[50cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      >
        <CirclePause class="h-[8cqh] w-[8cqh] bg-blue p-[1.4cqh] text-white rounded-full" />
        <p>{{ strings.game.pausedTitle }}</p>
        <h2>{{ strings.game.pausedSubtitle }}</h2>
        <span>{{ strings.game.pausedHint }}</span>
        <div v-if="store.isHost" class="flex gap-[0.8em] mt-[1.5cqh]">
          <AppButton variant="primary" @click="emit('resume')">
            <CirclePlay />{{ strings.game.resumeGame }}</AppButton
          ><AppButton variant="danger" @click="emit('open-end-confirm')">
            {{ strings.game.endEarly }}
          </AppButton>
        </div>
      </section>
    </div>
    <!-- 阶段遮罩：回合结算（答案、得分明细） -->
    <div
      v-else-if="store.room.phase === 'round_result' && game.roundResult"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[50cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      >
        <p>{{ strings.game.roundAnswerLabel }}</p>
        <h2>{{ game.roundResult.answer }}</h2>
        <div class="my-[1.5cqh] flex w-full flex-col gap-[0.6cqh]">
          <article
            v-for="detail in game.roundResult.details"
            :key="detail.playerId"
            class="grid grid-cols-[1.5fr_repeat(4,1fr)] items-center bg-slate-200 px-[0.8em] py-[0.8cqh] text-left text-[0.72em]"
          >
            <b>{{ store.room.members.find((member) => member.id === detail.playerId)?.nickname }}</b
            ><span>{{ strings.game.scoreBase(detail.base) }}</span
            ><span>{{ strings.game.scoreSpeed(detail.speed) }}</span
            ><span>{{ strings.game.scoreOrder(detail.order) }}</span
            ><strong class="text-blue text-[1.2em]">{{
              strings.game.scoreTotal(detail.total)
            }}</strong>
          </article>
          <p v-if="!game.roundResult.details.length">{{ strings.game.noGuesses }}</p>
        </div>
        <span>{{ strings.game.drawerScoreLine(game.roundResult.drawerScore, secondsLeft) }}</span>
      </section>
    </div>
    <!-- 阶段遮罩：最终结算（排行榜、统计） -->
    <div
      v-else-if="store.room.phase === 'game_result'"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
    >
      <section
        class="flex min-w-[55cqw] flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] pt-[2.5cqh] pb-[4cqh] text-center"
      >
        <Trophy class="h-[8cqh] w-[8cqh] bg-yellow p-[1.4cqh] text-[#854d0e] rounded-full" />
        <p>{{ strings.game.gameResultLabel }}</p>
        <h2>{{ strings.game.finalRanking }}</h2>
        <div class="my-[1cqh] flex w-full flex-col gap-[0.6cqh]">
          <article
            v-for="member in rankings"
            :key="member.id"
            class="grid grid-cols-[3em_auto_1fr_auto] items-center gap-[0.8em] bg-slate-200 px-[1em] py-[0.6cqh] text-left"
            :class="{ '!text-[#713f12] !bg-amber-100': member.rank === 1 }"
          >
            <b>#{{ member.rank }}</b
            ><AvatarImage
              class="h-[4.5cqh] w-[4.5cqh]"
              :avatar-id="member.avatarId"
              :label="strings.common.playerAvatarAria(member.nickname)"
            />
            <span class="flex flex-col font-extrabold"
              >{{ member.nickname
              }}<small class="text-muted text-[0.62em] font-semibold">{{
                strings.game.playerStats(
                  member.stats.correctCount,
                  member.stats.correctCount
                    ? Math.round(member.stats.totalGuessMs / member.stats.correctCount / 1000)
                    : 0,
                  member.stats.drawingCorrectCount,
                )
              }}</small></span
            ><strong>{{ strings.common.scoreUnit(member.score) }}</strong>
          </article>
        </div>
        <div class="flex gap-[0.8em] mt-[1.5cqh]">
          <AppButton v-if="store.isHost" variant="primary" @click="emit('return-waiting')">
            {{ strings.game.backToRoom }}</AppButton
          ><AppButton variant="secondary" @click="emit('leave-room')">
            {{ strings.game.leaveRoom }}
          </AppButton>
        </div>
      </section>
    </div>
  </div>
</template>
