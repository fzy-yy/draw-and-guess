<!--
  各阶段全屏遮罩（从 GameView.vue 拆出的子组件）：
  覆盖开局倒计时 / 画家选词 / 暂停 / 回合结算 / 最终结算。
  该组件读 store 的公开状态；HUD 派生值（剩余秒数/对局数据/排行）由父组件经 props 传入；
  需要交由父组件裁决或弹窗的动作一律用事件抛出
  （choose-word / resume / open-end-confirm / return-waiting / leave-room）。
  注：外层的 display:contents 只是为了让多个定位遮罩不参与父级 grid 布局，同时保留 TS 窄化。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Brush, CirclePause, CirclePlay, PenLine, RefreshCw, Trophy } from 'lucide-vue-next'
import { CUSTOM_WORD_MAX_LENGTH, type GameView } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { phaseTextFor } from '@/utils/phase-text'
import { deriveAccolades } from '@/utils/accolades'
import type { RankedMember } from '@/composables/useGameHud'
import AppButton from '@/components/common/AppButton.vue'
import AvatarImage from '@/components/common/AvatarImage.vue'
import CustomWordDialog from '@/components/game/CustomWordDialog.vue'
import OverlayCard from '@/components/game/OverlayCard.vue'

// 阶段遮罩需要的 HUD 派生值（剩余秒数、对局数据、最终排行）由父组件 GameView
// 统一计算后经 props 下发，整局只保留一个 ticker（不再此处单独起定时器）。
const props = withDefaults(
  defineProps<{
    /** 当前阶段剩余秒数（开局倒计时/自动选词提示用）。 */
    secondsLeft: number
    /** 对局视图（候选词/回合结算/答案等）。 */
    game: GameView | undefined
    /** 最终结算的排名列表（带同名次位次）。 */
    rankings: RankedMember[]
    /** 是否正在执行 3 秒作画重播 */
    isReplaying?: boolean
  }>(),
  { isReplaying: false },
)
const emit = defineEmits<{
  'choose-word': [wordId: string]
  'reroll-words': []
  resume: []
  'open-end-confirm': []
  'return-waiting': []
  'leave-room': []
}>()

const store = useGameStore()
/** 计算终局荣誉称号列表映射（按成员 ID 索引） */
const playerAccolades = computed(() => {
  return deriveAccolades(props.game, store.room?.members ?? [])
})
const phaseAnnouncement = computed(() => phaseTextFor(store.room?.phase))

/** 当前回合画家成员 */
const drawerMember = computed(() => {
  const drawerId = props.game?.drawerId
  return drawerId ? store.room?.members.find((member) => member.id === drawerId) : undefined
})

/** 回合结算弹窗显隐控制：新回合或新阶段时默认展示；玩家点击“进入下一轮”后本地隐藏以便查看画作 */
const showRoundResultModal = ref(true)
watch(
  () => [store.room?.phase, props.game?.roundId],
  () => {
    showRoundResultModal.value = true
  },
)
function chooseWord(wordId: string): void {
  playInteractionSound('select')
  emit('choose-word', wordId)
}

/** 自定义题目弹窗：仅开关开启时渲染入口；提交失败时保持打开，让画家改词重试。 */
const customWordOpen = ref(false)
const customWordSubmitting = ref(false)
const allowCustomWord = computed(() => store.room?.settings.allowCustomWord === true)

async function submitCustomWord(text: string): Promise<void> {
  customWordSubmitting.value = true
  try {
    const ok = await store.chooseCustomWord(text)
    if (ok) customWordOpen.value = false
  } finally {
    customWordSubmitting.value = false
  }
}
</script>

<template>
  <!-- display:contents —— 让遮罩不占 grid 格子，同时用 v-if 保证 store.room 与 game 已就绪 -->
  <div v-if="store.room && game" class="contents">
    <span class="sr-only" aria-live="polite" aria-atomic="true">{{ phaseAnnouncement }}</span>
    <!-- 阶段遮罩：开局倒计时，仅居中展示黄色圆形大数字 -->
    <div
      v-if="store.room.phase === 'starting'"
      class="absolute inset-0 z-30 grid place-items-center bg-navy/80 px-[5cqw] py-[4cqh] text-white"
    >
      <b
        class="grid place-items-center h-[20cqh] w-[20cqh] bg-yellow text-navy rounded-full text-fs-96"
        >{{ secondsLeft }}</b
      >
    </div>
    <!-- 阶段遮罩：画家选词（只有画家可见候选词按钮与换一组操作） -->
    <OverlayCard v-else-if="store.room.phase === 'choosing_word' && store.isDrawer">
      <!-- 居中圆形底座包裹 Brush，等比居中无裁切 -->
      <div class="grid place-items-center h-[7.5cqh] w-[7.5cqh] bg-blue rounded-full">
        <Brush class="h-[3.8cqh] w-[3.8cqh] text-white" />
      </div>
      <p>{{ strings.ui.game.yourTurn }}</p>
      <div class="relative flex w-full items-center justify-center min-h-[4.5cqh]">
        <h2>{{ strings.ui.game.chooseWordTitle }}</h2>
        <!-- 右侧动作组：换一组与自定义并排（关闭对应规则时整颗按钮不渲染） -->
        <div class="absolute right-[1em] flex items-center gap-[0.6em]">
          <AppButton
            v-if="store.room.settings.allowWordReroll"
            variant="secondary"
            class="min-h-[4cqh] px-[0.9em] text-fs-14"
            :disabled="!game.canReroll"
            :title="game.canReroll ? strings.a11y.game.rerollWords : strings.a11y.game.rerollUsed"
            @click="emit('reroll-words')"
          >
            <RefreshCw class="h-[2cqh] w-[2cqh]" />
            {{ strings.ui.game.rerollWords }}
          </AppButton>
          <AppButton
            v-if="allowCustomWord"
            variant="secondary"
            class="min-h-[4cqh] px-[0.9em] text-fs-14"
            :title="strings.a11y.game.customWordHint(CUSTOM_WORD_MAX_LENGTH)"
            @click="customWordOpen = true"
          >
            <PenLine class="h-[2cqh] w-[2cqh]" />
            {{ strings.ui.game.customWord }}
          </AppButton>
        </div>
      </div>
      <div class="flex gap-[1em] my-[2cqh]">
        <button
          v-for="option in game.wordOptions ?? []"
          :key="option.id"
          type="button"
          class="flex min-h-[7cqh] min-w-[12cqw] flex-col items-center justify-center gap-[0.3cqh] rounded-[0.7em] bg-yellow text-navy px-[1em] text-fs-20 font-bold cursor-pointer transition-transform active:scale-95"
          @click="chooseWord(option.id)"
        >
          <span class="leading-[1.2]">{{ option.text }}</span>
        </button>
      </div>
      <!-- 选词阶段关闭限时时没有倒计时：提示「不限时」而不是「N 秒后自动选择」 -->
      <span>{{
        store.room.settings.allowChooseTimeLimit
          ? strings.ui.game.autoChoose(secondsLeft)
          : strings.ui.game.chooseNoLimitHint
      }}</span>
      <CustomWordDialog
        v-model:open="customWordOpen"
        :submitting="customWordSubmitting"
        @confirm="submitCustomWord"
      />
    </OverlayCard>
    <!-- 阶段遮罩：游戏暂停（房主可继续或提前结束） -->
    <OverlayCard v-else-if="store.room.phase === 'paused'">
      <div class="grid place-items-center h-[7.5cqh] w-[7.5cqh] bg-blue rounded-full">
        <CirclePause class="h-[3.8cqh] w-[3.8cqh] text-white" />
      </div>
      <p>{{ strings.ui.game.pausedTitle }}</p>
      <h2>{{ strings.ui.game.pausedSubtitle }}</h2>
      <span>{{ strings.ui.game.pausedHint }}</span>
      <div v-if="store.isHost" class="flex gap-[0.8em] mt-[1.5cqh]">
        <AppButton variant="primary" @click="emit('resume')">
          <CirclePlay />{{ strings.ui.game.resumeGame }}</AppButton
        ><AppButton variant="danger" :audio-feedback="null" @click="emit('open-end-confirm')">
          {{ strings.ui.game.endEarly }}
        </AppButton>
      </div>
    </OverlayCard>
    <!-- 阶段遮罩：回合结算（答案、得分明细） -->
    <!-- 阶段遮罩：回合结算（答案、得分明细）——重播期间隐藏，重播结束后或未开启重播时展示；玩家点击关闭后本地隐藏，便于欣赏画作 -->
    <OverlayCard
      v-else-if="
        store.room.phase === 'round_result' &&
        game.roundResult &&
        !props.isReplaying &&
        showRoundResultModal
      "
    >
      <p class="text-muted text-fs-12 font-bold">{{ strings.ui.game.roundAnswerLabel }}</p>
      <div
        class="mt-[0.5cqh] inline-flex items-center justify-center rounded-[0.7em] bg-yellow px-[1.4em] py-[0.5cqh] shadow-xs"
      >
        <h2 class="text-navy text-fs-24 font-bold tracking-[0.16em]">
          {{ game.roundResult.answer }}
        </h2>
      </div>
      <div class="my-[1.5cqh] flex w-full flex-col gap-[0.6cqh]">
        <!-- 画家本回合得分条状项目（置于第一行） -->
        <article
          v-if="drawerMember"
          class="grid grid-cols-[1.5fr_1fr_auto] items-center gap-[0.5em] bg-line px-[0.8em] py-[0.8cqh] text-left text-fs-12"
        >
          <span class="flex items-center gap-[0.3em] font-bold truncate">
            <Brush class="h-[1.8cqh] w-[1.8cqh] text-blue shrink-0" />
            <span class="truncate">{{ strings.ui.game.drawerNameTag(drawerMember.nickname) }}</span>
          </span>
          <span>{{ strings.ui.game.drawerScoreLabel }}</span>
          <strong class="text-blue text-fs-18">
            {{ strings.ui.game.scoreTotal(game.roundResult.drawerScore) }}
          </strong>
        </article>

        <!-- 猜词玩家明细列表 -->
        <article
          v-for="detail in game.roundResult.details"
          :key="detail.playerId"
          class="grid grid-cols-[1.5fr_1fr_auto] items-center gap-[0.5em] bg-line px-[0.8em] py-[0.8cqh] text-left text-fs-12"
        >
          <b class="truncate">{{
            store.room.members.find((member) => member.id === detail.playerId)?.nickname
          }}</b>
          <span>{{ strings.ui.game.scoreOrderLabel(detail.order) }}</span>
          <strong class="text-blue text-fs-18">
            {{ strings.ui.game.scoreTotal(detail.total) }}
          </strong>
        </article>
        <p
          v-if="!game.roundResult.details.length"
          class="text-muted text-fs-12 text-center py-[0.5cqh]"
        >
          {{ strings.ui.game.noGuesses }}
        </p>
      </div>

      <!-- 居中按钮：进入下一轮( 5 )，点击关闭弹窗以便查看画作 -->
      <div class="flex justify-center mt-[0.5cqh]">
        <AppButton variant="primary" class="min-w-[12em]" @click="showRoundResultModal = false">
          {{
            strings.ui.game.enterNextRound(
              Math.min(store.config.game.roundResultSeconds, secondsLeft),
            )
          }}
        </AppButton>
      </div>
    </OverlayCard>
    <!-- 阶段遮罩：最终结算（排行榜、统计） -->
    <OverlayCard v-else-if="store.room.phase === 'game_result'" wide>
      <!-- 奖杯图标：深色图形配淡黄圆形衬底（黄底黄字会让图标消失），复用 HostCrownBadge 的衬底思路 -->
      <span
        class="grid h-[8cqh] w-[8cqh] place-items-center rounded-full bg-yellow/25"
        aria-hidden="true"
      >
        <Trophy class="h-[55%] w-[55%] fill-warning-fg text-warning-fg" />
      </span>
      <p>{{ strings.ui.game.gameResultLabel }}</p>
      <h2>{{ strings.ui.game.finalRanking }}</h2>
      <div class="my-[1cqh] flex w-full flex-col gap-[0.6cqh]">
        <article
          v-for="member in rankings"
          :key="member.id"
          class="grid grid-cols-[3em_auto_1fr_auto] items-center gap-[0.8em] px-[1em] py-[0.6cqh] text-left"
          :class="member.rank === 1 ? 'text-navy bg-yellow/20' : 'bg-line text-navy'"
        >
          <b>{{ strings.ui.game.rankPrefix(member.rank) }}</b
          ><AvatarImage
            class="h-[4.5cqh] w-[4.5cqh]"
            :avatar-id="member.avatarId"
            :label="strings.a11y.common.playerAvatarAria(member.nickname)"
          />
          <span class="flex flex-col font-bold">
            <span class="flex items-center gap-[0.4em] flex-wrap">
              <span>{{ member.nickname }}</span>
              <!-- 荣誉称号胶囊徽章列表 -->
              <!-- 荣誉称号胶囊徽章列表（无边框纯色浅底设计） -->
              <span
                v-for="accolade in playerAccolades[member.id] ?? []"
                :key="accolade.key"
                class="inline-flex items-center gap-[0.2em] rounded-full px-[0.55em] py-[0.1cqh] text-fs-10 font-bold select-none"
                :class="accolade.colorClass"
                :title="accolade.description"
                :aria-label="strings.a11y.game.accoladeBadgeAria(member.nickname, accolade.title)"
              >
                <component
                  :is="accolade.icon"
                  class="h-[1.4cqh] w-[1.4cqh] shrink-0"
                  aria-hidden="true"
                />
                <span>{{ accolade.title }}</span>
              </span>
            </span>
            <small class="text-muted text-fs-10 font-bold">{{
              strings.ui.game.playerStats(
                member.stats.correctCount,
                member.stats.correctCount
                  ? Math.round(member.stats.totalGuessMs / member.stats.correctCount / 1000)
                  : 0,
                member.stats.drawingCorrectCount,
              )
            }}</small>
          </span>
          <strong>{{ strings.ui.common.scoreUnit(member.score) }}</strong>
        </article>
      </div>
      <div class="flex gap-[0.8em] mt-[1.5cqh]">
        <!-- 普通成员只登记个人再来一局意愿；房主请求在服务端最短展示期结束后全局生效。 -->
        <AppButton
          variant="primary"
          :disabled="store.me?.rematchReady"
          @click="emit('return-waiting')"
        >
          {{
            store.me?.rematchReady
              ? store.isHost
                ? strings.ui.game.hostReturnQueuedWithSeconds(secondsLeft)
                : strings.ui.game.rematchReadyWithSeconds(secondsLeft)
              : store.isHost
                ? strings.ui.game.hostReturnWaitingWithSeconds(secondsLeft)
                : strings.ui.game.rematchWithSeconds(secondsLeft)
          }}</AppButton
        ><AppButton variant="secondary" :audio-feedback="null" @click="emit('leave-room')">
          {{ strings.ui.game.leaveRoom }}
        </AppButton>
      </div>
    </OverlayCard>
  </div>
</template>
