<!--
  接龙投票卡（S78 / S82，挂在画布容器内、浮在画布上）：
  `OverlayCard` 卡片 + 圆形 icon 底 + 「这个匹配吗？」+「词 A →(箭头 icon) 词 B」+ 匿名票行 + 赞同 / 不赞同按钮。

  - 两个答案底色**统一浅黄**（`bg-yellow/25`，S82，不再一白一黄），箭头只做方向提示；
  - 匿名票行**不带底色**，只按到达顺序居中排列 ✔（绿）/ ✘（红）图标，不含归属（S42 / S82）；
  - **不显示倒计时文案**：剩余时间只看顶栏（S78）；
  - **ack 成功后才锁定**：点下先防连点，只有服务端 ack 返回成功才本地置灰；
    失败（限频 / 阶段过期 / 断线）回滚为可重试，权威状态始终由快照的 `submitted` 收口
    （与作答浮层同一口径；重复投票服务端也会以 `ALREADY_SUBMITTED` 拒绝，S13 / S14）。

  数据源＝当前链的 `showcase`：词 A（初始词）与词 B（最终答案）在投票期都已揭晓，票行也只在投票期下发。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, Check, HelpCircle, X } from 'lucide-vue-next'
import type { RelayVoteChoice } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import AppButton from '@/components/common/AppButton.vue'
import OverlayCard from '@/components/game/OverlayCard.vue'

const store = useGameStore()

/** 当前链的复盘内容：词 A 与词 B 在投票期都已揭晓。 */
const showcase = computed(() => store.relay?.showcase)
const promptText = computed(() => showcase.value?.prompt.text ?? '')
const answerText = computed(() => showcase.value?.answer.text ?? '')
/** 匿名票行：按到达顺序原样渲染，单元里没有投票者身份（S42）。 */
const votes = computed<RelayVoteChoice[]>(() => showcase.value?.votes ?? [])

/**
 * 已锁定：**只有 ack 成功才本地置灰**（与作答浮层同一口径），失败（限频 / 阶段过期 / 断线）
 * 回滚为可重试——否则一旦请求失败，两个按钮会永久置灰，而权威快照里我仍是「未投票」，
 * 10 秒投票窗内再也无法补救。服务端快照的 `submitted` 仍是权威（断线重连回到投票期也正确置灰）。
 * 本卡只在 `relay_vote` 期挂载，链与链之间会整块卸载重建，故不需要额外的「链切换复位」分支。
 */
const locallyLocked = ref(false)
/** 请求在途：只用于防连点（重复投票服务端也会以 ALREADY_SUBMITTED 拒绝）。 */
const pending = ref(false)
const locked = computed(() => locallyLocked.value || store.relay?.submitted === true)

/** 投票：动作走 façade 的 `relayVote`（目标链由服务端游标决定，客户端指定不了）。 */
async function vote(choice: RelayVoteChoice): Promise<void> {
  if (locked.value || pending.value) return
  pending.value = true
  try {
    const delivered = await store.relayVote(choice)
    if (delivered) locallyLocked.value = true
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <OverlayCard>
    <!-- 圆底 icon：沿用经典圆底，只把图标换成「这是不是同一个东西」的问号（S72 / S78） -->
    <div class="grid place-items-center h-[7.5cqh] w-[7.5cqh] bg-blue rounded-full">
      <HelpCircle class="h-[3.8cqh] w-[3.8cqh] text-white" aria-hidden="true" />
    </div>
    <h2>{{ strings.ui.game.relayVoteTitle }}</h2>

    <!-- 词 A → 词 B：两侧答案底色一致（S82），箭头是纯装饰 -->
    <div class="my-[1cqh] flex items-center justify-center gap-[1cqw]">
      <span
        class="inline-flex items-center justify-center rounded-[0.7em] bg-yellow/25 px-[1.2em] py-[0.5cqh] shadow-xs"
      >
        <b
          class="flex items-center gap-[0.3em] text-fs-24 tracking-[0.16em]"
          :class="promptText === strings.ui.game.relayUnanswered ? 'text-muted' : 'text-navy'"
        >
          <HelpCircle
            v-if="promptText === strings.ui.game.relayUnanswered"
            class="h-[2.8cqh] w-[2.8cqh]"
            aria-hidden="true"
          />
          {{ promptText }}
        </b>
      </span>
      <ArrowRight class="h-[3cqh] w-[3cqh] shrink-0 text-muted" aria-hidden="true" />
      <span
        class="inline-flex items-center justify-center rounded-[0.7em] bg-yellow/25 px-[1.2em] py-[0.5cqh] shadow-xs"
      >
        <b
          class="flex items-center gap-[0.3em] text-fs-24 tracking-[0.16em]"
          :class="answerText === strings.ui.game.relayUnanswered ? 'text-muted' : 'text-navy'"
        >
          <HelpCircle
            v-if="answerText === strings.ui.game.relayUnanswered"
            class="h-[2.8cqh] w-[2.8cqh]"
            aria-hidden="true"
          />
          {{ answerText }}
        </b>
      </span>
    </div>

    <!-- 匿名票行：到达顺序 + 无底色 + 无归属（S42 / S82）；倒计时文案不在这里（S78） -->
    <div
      class="flex min-h-[4cqh] w-full items-center justify-center gap-[0.5em] px-[0.8em] py-[0.5cqh]"
      role="list"
      :aria-label="strings.a11y.game.relayVoteRowAria"
    >
      <span
        v-for="(choice, index) in votes"
        :key="index"
        role="listitem"
        class="grid h-[2.6cqh] w-[2.6cqh] place-items-center"
      >
        <Check
          v-if="choice === 'agree'"
          class="h-[2.4cqh] w-[2.4cqh] text-success-fg"
          aria-hidden="true"
        />
        <X v-else class="h-[2.4cqh] w-[2.4cqh] text-red" aria-hidden="true" />
        <!-- 票图标对读屏不可读，改用一个短的隐藏文本表达这一票的内容 -->
        <span class="sr-only">{{
          choice === 'agree' ? strings.ui.game.relayVoteAgree : strings.ui.game.relayVoteDisagree
        }}</span>
      </span>
    </div>

    <div class="mt-[1.5cqh] flex justify-center gap-[0.8em]">
      <AppButton variant="primary" :disabled="locked || pending" @click="vote('agree')">
        <Check />{{ strings.ui.game.relayVoteAgree }}
      </AppButton>
      <AppButton variant="danger" :disabled="locked || pending" @click="vote('disagree')">
        <X />{{ strings.ui.game.relayVoteDisagree }}
      </AppButton>
    </div>
  </OverlayCard>
</template>
