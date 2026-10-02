<!--
  邀请在线玩家弹窗（房主或允许邀请的成员）——列出空闲的在线玩家，点击发送按钮即邀请。
  原 RoomView.vue 邀请弹窗迁入本组件，基于 BaseDialog 复用外壳；可用玩家列表内部计算。
  发送按钮复用 RoundIconButton 图标按钮组件；点击后进入冷却倒计时
  （秒数来自 @draw-guess/config 的 UI 配置），防止对同一玩家重复邀请；
  发送结果由 store.invite 内统一 Toast 提示「邀请已发出/失败」。
  显隐只由 v-model:open 承担（BaseDialog 关闭时自行写回 false），不再向上抛 close 事件。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Send } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/common/AvatarImage.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import RoundIconButton from '@/components/common/RoundIconButton.vue'
import { useGameStore } from '@/stores/game'

const open = defineModel<boolean>('open', { default: false })
const store = useGameStore()

// 可邀请玩家：当前空闲的在线玩家（排除自己）。
// 「是否允许接收邀请」不在公开资料中下发，由服务端 sendInvite 侧校验并拒绝。
const availablePlayers = computed(() =>
  store.presence.players.filter(
    (player) => player.id !== store.playerId && player.status === 'idle',
  ),
)

// ---- 邀请冷却倒计时（防重复邀请） ----
// 每个目标玩家独立的冷却截止时间戳（ms）；按钮显示剩余秒数并禁用。
const cooldownEndsAt = ref(new Map<string, number>())
const nowTick = ref(Date.now())
let tickTimer: number | undefined

/** 某玩家的剩余冷却秒数（向上取整；无冷却时为 0）。 */
function cooldownSeconds(playerId: string): number {
  const endsAt = cooldownEndsAt.value.get(playerId)
  if (!endsAt) return 0
  return Math.max(0, Math.ceil((endsAt - nowTick.value) / 1_000))
}

/** 邀请按钮的语义文案：冷却期展示「冷却 N 秒」，可邀请时展示「邀请 昵称」（label 与 title 共用）。 */
function inviteButtonLabel(player: { id: string; nickname: string }): string {
  return cooldownSeconds(player.id) > 0
    ? strings.a11y.room.inviteCooldownAria(cooldownSeconds(player.id))
    : strings.ui.room.inviteSendTo(player.nickname)
}

/** 发送邀请：进入冷却并交给 store（失败也会 Toast，冷却照常走完防止连点）。 */
async function sendInvite(playerId: string): Promise<void> {
  if (cooldownSeconds(playerId) > 0) return
  cooldownEndsAt.value.set(playerId, Date.now() + store.config.ui.inviteCooldownSeconds * 1_000)
  nowTick.value = Date.now()
  await store.invite(playerId)
}

// 弹窗打开期间按 UI 配置的 tick 间隔刷新剩余秒数（与 HUD 倒计时口径一致）；关闭时清理定时器并清空冷却状态。
// 本组件随房间常驻挂载、open 只会从 false 变化触发，无需 immediate（RoomView 重进房间时
// showInvite 初值即 false，不存在「挂载时 open 已为 true」的启动路径）。
watch(open, (isOpen) => {
  if (isOpen) {
    cooldownEndsAt.value = new Map()
    window.clearInterval(tickTimer)
    tickTimer = window.setInterval(
      () => (nowTick.value = Date.now()),
      store.config.ui.tickIntervalMs,
    )
  } else {
    window.clearInterval(tickTimer)
    tickTimer = undefined
  }
})
onBeforeUnmount(() => window.clearInterval(tickTimer))
</script>

<template>
  <BaseDialog
    v-model:open="open"
    width-class="w-[52cqw]"
    labelledby="invite-title"
    :close-aria="strings.a11y.room.inviteCloseAria"
  >
    <template #header>
      <SectionHeader
        id="invite-title"
        :eyebrow="strings.ui.room.inviteLabel"
        :title="strings.ui.room.inviteTitle"
      ></SectionHeader>
    </template>

    <!-- 可邀请玩家列表：行内发送按钮为图标按钮，冷却期显示剩余秒数 -->
    <!-- 玩家列表在弹窗内自行滚动：人数多或舞台低时不会溢出弹窗 -->
    <div class="min-h-[40cqh] overflow-y-auto py-[2cqh] px-[2em] overscroll-contain">
      <div class="flex flex-col gap-[0.7cqh]">
        <div
          v-for="player in availablePlayers"
          :key="player.id"
          class="flex items-center gap-[0.7em] py-[0.65cqh] px-[0.7em] text-left text-navy bg-white border-solid border-[0.16cqh] border-control rounded-[0.6em]"
        >
          <AvatarImage
            class="h-[4.7cqh] w-[4.7cqh]"
            :avatar-id="player.avatarId"
            :label="strings.a11y.common.playerAvatarAria(player.nickname)"
          />
          <b class="flex-1">{{ player.nickname }}</b>
          <RoundIconButton
            :disabled="cooldownSeconds(player.id) > 0"
            :label="inviteButtonLabel(player)"
            :title="inviteButtonLabel(player)"
            @click="sendInvite(player.id)"
          >
            <!-- 冷却期展示剩余秒数，冷却结束恢复发送图标 -->
            <b v-if="cooldownSeconds(player.id) > 0" class="text-fs-12 tabular-nums">{{
              cooldownSeconds(player.id)
            }}</b>
            <Send v-else />
          </RoundIconButton>
        </div>
        <p v-if="!availablePlayers.length">{{ strings.ui.room.inviteEmpty }}</p>
      </div>
    </div>
  </BaseDialog>
</template>
