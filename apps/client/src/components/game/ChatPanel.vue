<!--
  右侧聊天区（从 GameView.vue 拆出的子组件）：
  消息列表 + 快捷互动工具 + 猜词输入。猜词输入、消息滚动跟随与自动聚焦逻辑全部收敛到内部；
  是否可猜词由父组件经 canGuess 传入，提交猜词/预设短语直接调用 store。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { Frown, HelpCircle, Lightbulb, Send, SmilePlus, ThumbsUp } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { ChatMessage, RoomMember } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import ActionPopover from '@/components/ActionPopover.vue'
import RoundIconButton from '@/components/common/RoundIconButton.vue'

// canGuess 由父组件（useGameHud）计算，这里只用于输入框权限与提交保护。
const props = defineProps<{
  canGuess: boolean
}>()

const store = useGameStore()

// 猜词输入本地状态（输入框内容随 submit 清空）。
const guess = ref('')
// 消息列表 DOM 引用与「是否跟随最新消息」标记：上滚时暂停跟随，底部时恢复。
const messageList = ref<HTMLElement>()
const shouldFollowMessages = ref(true)
// 消息数据直接读取房间快照中的聊天记录，无需独立 ticker。
const messages = computed(() => store.room?.game?.messages ?? [])
// 快捷短语继续使用服务端白名单；图标仅是客户端表现，不参与协议或裁决。
const quickPhraseIcons: Component[] = [ThumbsUp, Lightbulb, HelpCircle, Frown]
const quickPhraseActions = computed(() =>
  store.config.presets.safeChat.map((text, index) => ({
    text,
    icon: quickPhraseIcons[index] ?? SmilePlus,
  })),
)
// 画家、猜词者和已猜中者在作画阶段都能使用受控互动；观战者始终只读。
const canSendPreset = computed(
  () =>
    store.room?.phase === 'drawing' && !store.me?.spectating && store.me?.connection === 'online',
)
const interactionHint = computed(() =>
  props.canGuess
    ? strings.game.guessLabel
    : store.isDrawer
      ? strings.game.drawerChatHint
      : store.me?.spectating
        ? strings.game.spectatorChatHint
        : store.me?.guessed
          ? strings.game.guessedChatHint
          : strings.game.waitingChatHint,
)

function memberForMessage(message: ChatMessage): RoomMember | undefined {
  return message.playerId
    ? store.room?.members.find((member) => member.id === message.playerId)
    : undefined
}

/** 玩家消息气泡沿用固定席位色；文字始终保持黑色粗体以保证可读性。 */
function messageStyle(message: ChatMessage): Record<string, string> | undefined {
  const member = memberForMessage(message)
  if (!member) return undefined
  return {
    borderLeftColor: member.seatColor,
    backgroundColor: `color-mix(in srgb, ${member.seatColor} 16%, white)`,
  }
}

/** 提交猜词：先交由服务端判定，只有成功送达才清空输入框；
 * 超时或业务失败（如重复猜中）时保留草稿，避免玩家已输入的内容被吞。 */
async function sendGuess(): Promise<void> {
  const text = guess.value.trim()
  if (!text || !props.canGuess) return
  const delivered = await store.submitGuess(text)
  if (delivered) guess.value = ''
}

/** 发送服务端白名单内的互动内容，并在送达后收起其悬浮面板。 */
async function sendPresetAndClose(preset: string, close: () => void): Promise<void> {
  await store.sendPreset(preset)
  close()
}

/** 用户接近列表底部时跟随新消息；主动上滚后保留阅读位置。 */
function handleMessageScroll(): void {
  const element = messageList.value
  if (!element) return
  shouldFollowMessages.value = element.scrollHeight - element.scrollTop - element.clientHeight < 32
}

/** 滚动到底部：默认仅在「应跟随」时执行，force 用于强制滚到底。 */
async function scrollMessagesToBottom(force = false): Promise<void> {
  await nextTick()
  const element = messageList.value
  if (element && (force || shouldFollowMessages.value)) element.scrollTop = element.scrollHeight
}

// 新消息到达且处于跟随状态时自动滚到底部。
watch(
  () => messages.value.at(-1)?.id,
  () => void scrollMessagesToBottom(),
  { immediate: true },
)

// D2：按「自动聚焦猜词框」开关在进入可猜词状态时聚焦输入框（替代静态 autofocus）。
const guessInput = ref<HTMLInputElement>()
watch(
  () =>
    store.room?.phase === 'drawing' &&
    !store.isDrawer &&
    !store.me?.guessed &&
    !store.me?.spectating,
  (canGuessNow) => {
    if (canGuessNow && store.settings.autoFocusGuess) void nextTick(() => guessInput.value?.focus())
  },
  { immediate: true },
)
</script>

<template>
  <!-- 右侧聊天区：消息列表 + 猜词输入 / 安全预设短语 -->
  <aside
    v-if="store.room"
    class="flex min-w-0 flex-col border-l-[0.2cqh] border-line bg-paper px-[0.9cqw] py-[1.5cqh]"
  >
    <header class="flex items-center justify-between border-b-[0.18cqh] border-line pb-[1cqh]">
      <div>
        <span class="text-blue text-[0.56em] tracking-[0.15em]">{{
          strings.game.liveChatLabel
        }}</span>
        <h2 class="text-[1.05em]">{{ strings.game.chatTitle }}</h2>
      </div>
      <!-- 当前角色标签：观战中 / 已猜中 / 作画中 / 猜词中 -->
      <span
        class="bg-sky px-[0.6em] py-[0.35cqh] text-blue rounded-[99em] text-[0.62em] font-extrabold"
        >{{
          store.me?.spectating
            ? strings.status.roleSpectating
            : store.me?.guessed
              ? strings.status.roleGuessed
              : store.isDrawer
                ? strings.status.roleDrawing
                : strings.status.roleGuessing
        }}</span
      >
    </header>
    <!-- 消息列表：猜词、系统、猜中、预设等类型分别高亮 -->
    <div
      ref="messageList"
      class="flex min-h-0 flex-1 flex-col gap-[0.6cqh] overflow-y-auto overflow-x-hidden py-[1cqh] pl-0 pr-[0.35em] [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      aria-live="polite"
      @scroll="handleMessageScroll"
    >
      <div
        v-for="message in messages"
        :key="message.id"
        :class="[
          'flex flex-wrap gap-[0.35em] border-l-[0.3cqh] border-line bg-white px-[0.65em] py-[0.6cqh] text-[0.72em] leading-[1.35] text-navy first:mt-auto ui-feedback',
          message.playerId && '!text-navy font-extrabold',
          message.type === 'system' && '!text-blue !bg-sky !border-l-blue',
        ]"
        :style="messageStyle(message)"
      >
        <!-- 玩家消息显示发送者昵称 -->
        <b v-if="message.playerId">{{ memberForMessage(message)?.nickname }}</b>
        <span>{{ message.text }}</span>
      </div>
      <div
        v-if="!messages.length"
        class="m-auto flex flex-col items-center text-muted text-[0.7em]"
      >
        <Send class="h-[4cqh] w-[4cqh]" /><span>{{ strings.game.noMessages }}</span>
      </div>
    </div>
    <!-- 所有角色共享同一操作布局：上排快捷互动，下排输入；无猜词权限时仅禁用输入。 -->
    <div class="border-t-[0.18cqh] border-line pt-[0.8cqh]">
      <p class="text-muted min-h-[1.3em] text-[0.6em] leading-[1.3]">
        {{ interactionHint }}
      </p>
      <div
        class="mt-[0.55cqh] flex items-center gap-[0.45em]"
        role="group"
        :aria-label="strings.game.chatActionsAria"
      >
        <ActionPopover
          :trigger-label="strings.game.reactionPickerAria"
          :panel-aria-label="strings.game.reactionPanelAria"
          :disabled="!canSendPreset"
        >
          <template #trigger><SmilePlus class="h-[2.4cqh] w-[2.4cqh]" /></template>
          <template #default="{ close }">
            <div class="grid grid-cols-3 gap-[0.45em]">
              <button
                v-for="reaction in store.config.presets.chatReactions"
                :key="reaction"
                type="button"
                class="grid h-[4.2cqh] w-[4.2cqh] place-items-center rounded-full bg-line text-[1.05em] hover:bg-sky"
                :aria-label="strings.game.sendReactionAria(reaction)"
                @click="sendPresetAndClose(reaction, close)"
              >
                {{ reaction }}
              </button>
            </div>
          </template>
        </ActionPopover>
        <RoundIconButton
          v-for="action in quickPhraseActions"
          :key="action.text"
          :disabled="!canSendPreset"
          :label="strings.game.sendQuickPhraseAria(action.text)"
          :title="action.text"
          @click="store.sendPreset(action.text)"
        >
          <component :is="action.icon" class="h-[2.35cqh] w-[2.35cqh]" />
        </RoundIconButton>
      </div>
      <form class="mt-[0.65cqh] flex gap-[0.5em]" @submit.prevent="sendGuess">
        <label for="guess-input" class="sr-only">{{ strings.game.guessLabel }}</label>
        <input
          id="guess-input"
          ref="guessInput"
          v-model="guess"
          :maxlength="store.config.player.chatMaxLength"
          autocomplete="off"
          class="h-[5.2cqh] min-w-0 flex-1 rounded-[0.65em] border-[0.2cqh] border-blue bg-white px-[0.8em] outline-0 disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-muted"
          :disabled="!canGuess"
          :placeholder="strings.game.guessPlaceholder"
        />
        <button
          type="submit"
          class="grid h-[5.2cqh] w-[5.2cqh] shrink-0 place-items-center rounded-[0.65em] bg-blue text-white disabled:cursor-not-allowed disabled:bg-line"
          :disabled="!canGuess || !guess.trim()"
          :aria-label="strings.game.sendGuessAria"
        >
          <Send class="h-[2.5cqh] w-[2.5cqh]" />
        </button>
      </form>
    </div>
  </aside>
</template>
