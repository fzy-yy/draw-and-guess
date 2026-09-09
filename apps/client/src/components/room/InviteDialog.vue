<!--
  邀请在线玩家弹窗（房主或允许邀请的成员）——列出空闲且允许接收邀请的在线玩家，点击发送按钮即邀请。
  原 RoomView.vue 邀请弹窗迁入本组件，基于 BaseDialog 复用外壳；可用玩家列表内部计算。
  发送按钮复用 RoundIconButton 图标按钮组件；点击后进入冷却倒计时
  （秒数来自 @draw-guess/config 的 UI 配置），防止对同一玩家重复邀请；
  发送结果由 store.invite 内统一 Toast 提示「邀请已发出/失败」。
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
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()

function handleClose(): void {
  open.value = false
  emit('close')
}

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
    ? strings.room.inviteCooldownAria(cooldownSeconds(player.id))
    : strings.room.inviteSendTo(player.nickname)
}

/** 发送邀请：进入冷却并交给 store（失败也会 Toast，冷却照常走完防止连点）。 */
async function sendInvite(playerId: string): Promise<void> {
  if (cooldownSeconds(playerId) > 0) return
  cooldownEndsAt.value.set(playerId, Date.now() + store.config.ui.inviteCooldownSeconds * 1_000)
  nowTick.value = Date.now()
  await store.invite(playerId)
}

// 弹窗打开期间每 250ms 刷新一次剩余秒数；关闭时清理定时器并清空冷却状态。
// immediate：组件在 open=true 时才挂载，必须在初始化时也启动定时器，否则倒计时永远停在初始值。
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      cooldownEndsAt.value = new Map()
      window.clearInterval(tickTimer)
      tickTimer = window.setInterval(() => (nowTick.value = Date.now()), 250)
    } else {
      window.clearInterval(tickTimer)
      tickTimer = undefined
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearInterval(tickTimer))
</script>

<template>
  <BaseDialog
    v-model:open="open"
    width-class="w-[52cqw]"
    labelledby="invite-title"
    :close-aria="strings.room.inviteCloseAria"
    @close="handleClose"
  >
    <template #header>
      <SectionHeader
        id="invite-title"
        :eyebrow="strings.room.inviteLabel"
        :title="strings.room.inviteTitle"
      ></SectionHeader>
    </template>

    <!-- 可邀请玩家列表：行内发送按钮为图标按钮，冷却期显示剩余秒数 -->
    <div class="min-h-[40cqh] py-[2cqh] px-[2em]">
      <div class="flex flex-col gap-[0.7cqh]">
        <div
          v-for="player in availablePlayers"
          :key="player.id"
          class="flex items-center gap-[0.7em] py-[0.65cqh] px-[0.7em] text-left text-navy bg-white border-solid border-[0.16cqh] border-control rounded-[0.6em]"
        >
          <AvatarImage
            class="h-[4.7cqh] w-[4.7cqh]"
            :avatar-id="player.avatarId"
            :label="strings.common.playerAvatarAria(player.nickname)"
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
        <p v-if="!availablePlayers.length">{{ strings.room.inviteEmpty }}</p>
      </div>
    </div>
  </BaseDialog>
</template>
