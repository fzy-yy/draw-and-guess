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
import {
  CUSTOM_WORD_MAX_LENGTH,
  type GameView,
  type RelayFinalRankingEntry,
} from '@draw-guess/shared'
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
/**
 * 遮罩的数据源：经典对局视图、接龙视图，或**开局倒计时**——
 * 接龙房在 `starting` 期还没有接龙视图（服务端接龙阶段白名单，S22），若仍以「存在视图」为门禁，
 * 这 3 秒会一片空白（开局遮罩、阶段播报都不渲染），因此这里按阶段一并认下。
 */
const hasOverlaySource = computed(() =>
  Boolean(props.game || store.room?.relay || store.room?.phase === 'starting'),
)
/** 计算终局荣誉称号列表映射（按成员 ID 索引） */
const playerAccolades = computed(() => {
  return deriveAccolades(props.game, store.room?.members ?? [])
})
/**
 * 房间是否接龙模式：终局结算的行内第二行与称号展示据此分流（S33 / S77）。
 * 接龙房没有经典 `game`，排名与统计只在 `relay.finalRanking` 里下发。
 */
const isRelay = computed(() => store.room?.gameMode === 'relay')
/** 接龙终局榜（仅 `game_result` 下发）：只有名次、分数与接龙口径统计（S33）。 */
const relayFinalRanking = computed<RelayFinalRankingEntry[]>(
  () => store.room?.relay?.finalRanking ?? [],
)

/** 终局结算的一行：两种模式同形，版式复用经典结算（`OverlayCard wide`），只有第二行口径不同。 */
interface ResultRow {
  id: string
  nickname: string
  avatarId: string
  rank: number
  score: number
  /** 行内第二行：经典＝猜中次数 / 平均秒数；接龙＝参与链数与累计赞同票（S77）。 */
  statText: string
}

/**
 * 结算行数据：经典取父组件下发的冻结榜单，接龙取接龙视图的 `finalRanking`——
 * 两者都是服务端冻结的公开结算项，只有统计口径不同（接龙猜词不判对错，S33 / S77）。
 */
const resultRows = computed<ResultRow[]>(() => {
  if (isRelay.value)
    return relayFinalRanking.value.map((entry) => ({
      id: entry.id,
      nickname: entry.nickname,
      avatarId: entry.avatarId,
      rank: entry.rank,
      score: entry.score,
      statText: strings.ui.game.relayPlayerStats(entry.chainCount, entry.agreeVotes),
    }))
  return props.rankings.map((member) => ({
    id: member.id,
    nickname: member.nickname,
    avatarId: member.avatarId,
    rank: member.rank,
    score: member.score,
    statText: strings.ui.game.playerStats(
      member.stats.correctCount,
      member.stats.correctCount
        ? Math.round(member.stats.totalGuessMs / member.stats.correctCount / 1000)
        : 0,
      member.stats.drawingCorrectCount,
    ),
  }))
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

// —— 选词卡（经典画家选词 / 接龙第 1 棒全员选词，复用同一张卡的标记与交互，S72 / S84）——
/** 当前是否处于接龙选词阶段。 */
const isRelayChoose = computed(() => store.room?.phase === 'relay_choose')
/** 接龙选词视图：候选词与换批权限都来自它（经典仍走对局视图的字段，互不串源）。 */
const relayChoose = computed(() => (isRelayChoose.value ? store.room?.relay : undefined))
/** 选词卡显隐：经典只有画家看到；接龙人人各选自己那条链的词，全员都看到。 */
const showChooseCard = computed(() =>
  isRelayChoose.value
    ? Boolean(store.room?.relay)
    : store.room?.phase === 'choosing_word' && store.isDrawer,
)
/** 接龙已选完词、等待其他人：本步其余出口（重选 / 换批 / 自定义）在服务端都会被拒，界面据快照锁定。 */
const chooseLocked = computed(() => isRelayChoose.value && relayChoose.value?.submitted === true)
/** 候选词按钮的数据源（经典＝画家候选，接龙＝自己的候选）。 */
const chooseOptions = computed(() =>
  isRelayChoose.value ? (relayChoose.value?.wordOptions ?? []) : (props.game?.wordOptions ?? []),
)
/** 是否还能换一批（两种模式都来自各自视图的 canReroll）。 */
const canReroll = computed(() =>
  isRelayChoose.value ? relayChoose.value?.canReroll === true : props.game?.canReroll === true,
)
/**
 * 选词卡标题：经典＝「轮到你作画了」；接龙＝「接龙 · 第 1 棒」（S83）——
 * 接龙选词卡复用经典同一张卡，只有这一句文案与数据来源不同（S84）。
 */
const chooseTitle = computed(() =>
  isRelayChoose.value ? strings.ui.game.relayChooseTitle : strings.ui.game.yourTurn,
)
/** 卡片底部提示：接龙选词恒有截止时间（无「不限时」档位），经典按规则在限时与不限时之间切换。 */
const chooseHint = computed(() => {
  if (chooseLocked.value) return strings.ui.game.relayWaitingOthers
  if (isRelayChoose.value || store.room?.settings.allowChooseTimeLimit)
    return strings.ui.game.autoChoose(props.secondsLeft)
  return strings.ui.game.chooseNoLimitHint
})
</script>

<template>
  <!-- display:contents —— 让遮罩不占 grid 格子，同时用 v-if 保证 store.room 与数据源已就绪 -->
  <div v-if="store.room && hasOverlaySource" class="contents">
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
    <!-- 阶段遮罩：选词卡（经典＝画家选词；接龙＝第 1 棒全员各选自己那条链的词，复用同一张卡的标记与交互） -->
    <OverlayCard v-else-if="showChooseCard">
      <!-- 居中圆形底座包裹 Brush，等比居中无裁切 -->
      <div class="grid place-items-center h-[7.5cqh] w-[7.5cqh] bg-blue rounded-full">
        <Brush class="h-[3.8cqh] w-[3.8cqh] text-white" />
      </div>
      <p>{{ chooseTitle }}</p>
      <div class="relative flex w-full items-center justify-center min-h-[4.5cqh]">
        <h2>{{ strings.ui.game.chooseWordTitle }}</h2>
        <!-- 右侧动作组：换一组与自定义并排（关闭对应规则时整颗按钮不渲染；已选完词时整组收起） -->
        <div v-if="!chooseLocked" class="absolute right-[1em] flex items-center gap-[0.6em]">
          <AppButton
            v-if="store.room.settings.allowWordReroll"
            variant="secondary"
            class="min-h-[4cqh] px-[0.9em] text-fs-14"
            :disabled="!canReroll"
            :title="canReroll ? strings.a11y.game.rerollWords : strings.a11y.game.rerollUsed"
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
      <div v-if="!chooseLocked" class="flex gap-[1em] my-[2cqh]">
        <button
          v-for="option in chooseOptions"
          :key="option.id"
          type="button"
          class="flex min-h-[7cqh] min-w-[12cqw] flex-col items-center justify-center gap-[0.3cqh] rounded-[0.7em] bg-yellow text-navy px-[1em] text-fs-20 font-bold cursor-pointer transition-transform active:scale-95"
          @click="chooseWord(option.id)"
        >
          <span class="leading-[1.2]">{{ option.text }}</span>
        </button>
      </div>
      <!-- 提示行：经典选词阶段关限时时提示「不限时」；接龙选完词后变成等待他人（S16 全员提交即秒切） -->
      <span>{{ chooseHint }}</span>
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
        game?.roundResult &&
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
    <!-- 阶段遮罩：最终结算（排行榜、统计）——两种模式复用同一版式：
         经典＝称号 + 猜中 / 用时统计；接龙＝无称号 + 接龙口径统计（S33 / S77） -->
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
          v-for="member in resultRows"
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
              <!-- 荣誉称号胶囊徽章列表（无边框纯色浅底设计）——接龙不显示称号：猜词不判对错，经典统计无数据源（S33 / S77） -->
              <template v-if="!isRelay">
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
              </template>
            </span>
            <!-- 行内第二行：经典＝猜中 / 用时统计，接龙＝参与链数与累计赞同票（S77） -->
            <small class="text-muted text-fs-10 font-bold">{{ member.statText }}</small>
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
