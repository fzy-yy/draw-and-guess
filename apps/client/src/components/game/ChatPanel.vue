<!--
  右侧聊天区（从 GameView.vue 拆出的子组件）：
  消息列表 + 快捷互动工具 + 猜词输入。猜词输入、消息滚动跟随与自动聚焦逻辑全部收敛到内部；
  是否可猜词由父组件经 canGuess 传入，提交猜词/预设短语直接调用 store。
  输入框对无权限角色直接禁用（禁用样式已表达状态，不再渲染冗余的文字提示行）。
  快捷互动收敛为两个悬浮面板：表情反应 + 快捷短语（短语列表来自 @draw-guess/config，
  在 config 中可增减），均基于 ActionPopover 复用外壳。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Lightbulb, Send, SmilePlus } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { ChatMessage, RoomMember } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { roleTextFor } from '@/utils/roleText'
import ActionPopover from '@/components/common/ActionPopover.vue'

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
// 画家、猜词者和已猜中者在作画阶段都能使用受控互动；观战者始终只读。
const canSendPreset = computed(
  () =>
    store.room?.phase === 'drawing' && !store.me?.spectating && store.me?.connection === 'online',
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
  if (delivered) {
    playInteractionSound('activate')
    guess.value = ''
  }
}

/** 发送服务端白名单内的互动内容，并在送达后收起其悬浮面板。 */
async function sendPresetAndClose(preset: string, close: () => void): Promise<void> {
  if (await store.sendPreset(preset)) {
    playInteractionSound('activate')
    close()
  }
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

// 按「自动聚焦猜词框」开关在进入可猜词状态时聚焦输入框（替代静态 autofocus）。
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
        <span class="text-blue text-fs-10 tracking-[0.15em]">{{ strings.game.liveChatLabel }}</span>
        <h2 class="text-fs-18">{{ strings.game.chatTitle }}</h2>
      </div>
      <!-- 当前角色标签：观战中 / 已猜中 / 作画中 / 猜词中（与得分条共用同一映射） -->
      <span class="bg-sky px-[0.6em] py-[0.35cqh] text-blue rounded-[99em] text-fs-10 font-bold">{{
        roleTextFor(store.me ?? undefined)
      }}</span>
    </header>
    <!-- 消息列表：猜词、系统、猜中、预设等类型分别高亮 -->
    <div
      ref="messageList"
      class="flex min-h-0 flex-1 flex-col gap-[0.6cqh] overflow-y-auto overflow-x-hidden py-[1cqh] pl-0 pr-[0.35em] overscroll-contain scrollbar-gutter-stable"
      aria-live="polite"
      @scroll="handleMessageScroll"
    >
      <div
        v-for="message in messages"
        :key="message.id"
        :class="[
          'flex flex-wrap gap-[0.35em] border-l-[0.3cqh] px-[0.65em] py-[0.6cqh] text-fs-12 leading-[1.35] first:mt-auto ui-feedback',
          message.type === 'system'
            ? 'text-blue bg-sky border-l-blue'
            : 'border-line bg-white text-navy',
          message.playerId && 'font-bold',
        ]"
        :style="messageStyle(message)"
      >
        <!-- 玩家消息显示发送者昵称，昵称后接冒号分隔内容（分隔符来自 strings） -->
        <b v-if="message.playerId"
          >{{ memberForMessage(message)?.nickname }}{{ strings.game.messageNameSeparator }}</b
        >
        <span>{{ message.text }}</span>
      </div>
      <div v-if="!messages.length" class="m-auto flex flex-col items-center text-muted text-fs-12">
        <Send class="h-[4cqh] w-[4cqh]" /><span>{{ strings.game.noMessages }}</span>
      </div>
    </div>
    <!-- 所有角色共享同一操作布局：上排快捷互动，下排输入；无猜词权限时仅禁用输入。 -->
    <div class="border-t-[0.18cqh] border-line pt-[0.8cqh]">
      <div
        class="mt-[0.55cqh] flex items-center gap-[0.45em]"
        role="group"
        :aria-label="strings.game.chatActionsAria"
      >
        <!-- 表情反应面板：表情列表来自 @draw-guess/config -->
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
                class="grid h-[4.2cqh] w-[4.2cqh] place-items-center rounded-full bg-line text-fs-18 hover:bg-sky"
                :aria-label="strings.game.sendReactionAria(reaction)"
                @click="sendPresetAndClose(reaction, close)"
              >
                {{ reaction }}
              </button>
            </div>
          </template>
        </ActionPopover>
        <!-- 快捷短语面板：原四个独立按钮合并为一个入口，短语列表可在 config 中增减 -->
        <ActionPopover
          :trigger-label="strings.game.quickPhrasePickerAria"
          :panel-aria-label="strings.game.quickPhrasePanelAria"
          :disabled="!canSendPreset"
          panel-class="w-[16cqw]"
        >
          <template #trigger><Lightbulb class="h-[2.4cqh] w-[2.4cqh]" /></template>
          <template #default="{ close }">
            <div class="flex flex-col gap-[0.4cqh]">
              <button
                v-for="phrase in store.config.presets.safeChat"
                :key="phrase"
                type="button"
                class="min-h-[3.4cqh] truncate rounded-[0.5em] bg-line px-[0.6em] py-[0.35cqh] text-left text-fs-12 font-bold text-navy hover:bg-sky"
                :aria-label="strings.game.sendQuickPhraseAria(phrase)"
                :title="phrase"
                @click="sendPresetAndClose(phrase, close)"
              >
                {{ phrase }}
              </button>
            </div>
          </template>
        </ActionPopover>
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
