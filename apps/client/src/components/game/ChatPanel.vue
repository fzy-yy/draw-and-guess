<!--
  右侧聊天区（从 GameView.vue 拆出的子组件）：
  消息列表 + 猜词输入 / 安全预设短语。猜词输入、消息滚动跟随与自动聚焦逻辑全部收敛到内部；
  是否可猜词由父组件经 canGuess 传入，提交猜词/预设短语直接调用 store。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Send } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'

// canGuess 由父组件（useGameHud）计算，这里只用于条件渲染猜词表单。
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

/** 提交猜词：清空输入框并交由服务端判定正确/接近。 */
async function sendGuess(): Promise<void> {
  const text = guess.value.trim()
  if (!text || !props.canGuess) return
  guess.value = ''
  await store.submitGuess(text)
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
    class="flex min-w-0 flex-col border-l-[0.2cqh] border-slate-400 bg-paper px-[0.9cqw] py-[1.5cqh]"
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
        class="bg-sky px-[0.6em] py-[0.35cqh] text-[#1e3a8a] rounded-[99em] text-[0.62em] font-extrabold"
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
          'flex flex-wrap gap-[0.35em] border-l-[0.3cqh] border-slate-400 bg-white px-[0.65em] py-[0.6cqh] text-[0.72em] leading-[1.35] text-slate-700 first:mt-auto transition-[transform,box-shadow,border-color,background-color,color,opacity] duration-[160ms]',
          message.type === 'correct' &&
            '!text-[#14532d] !bg-green-100 !border-l-green font-extrabold',
          message.type === 'system' && '!text-[#1e3a8a] !bg-sky !border-l-blue',
          message.type === 'preset' && '!text-[#7c2d12] !bg-[#ffedd5] !border-l-orange',
        ]"
      >
        <!-- 玩家消息显示发送者昵称 -->
        <b v-if="message.playerId">{{
          store.room.members.find((member) => member.id === message.playerId)?.nickname
        }}</b>
        <span>{{ message.text }}</span>
      </div>
      <div
        v-if="!messages.length"
        class="m-auto flex flex-col items-center text-slate-400 text-[0.7em]"
      >
        <Send class="h-[4cqh] w-[4cqh]" /><span>{{ strings.game.noMessages }}</span>
      </div>
    </div>
    <!-- 猜词输入表单：仅可猜词的玩家显示 -->
    <form
      v-if="canGuess"
      class="border-t-[0.18cqh] border-line pt-[0.8cqh]"
      @submit.prevent="sendGuess"
    >
      <label for="guess-input" class="text-muted text-[0.65em]">{{
        strings.game.guessLabel
      }}</label>
      <div class="flex mt-[0.45cqh]">
        <input
          id="guess-input"
          ref="guessInput"
          v-model="guess"
          maxlength="60"
          autocomplete="off"
          class="w-full min-w-0 h-[5.2cqh] rounded-l-[0.65em] border-[0.2cqh] border-r-0 border-blue px-[0.8em] outline-0"
          :placeholder="strings.game.guessPlaceholder"
        /><button
          type="submit"
          class="grid h-[5cqh] w-[5cqh] place-items-center rounded-r-[0.65em] bg-blue text-white"
          :disabled="!guess.trim()"
          :aria-label="strings.game.sendGuessAria"
        >
          <Send />
        </button>
      </div>
    </form>
    <!-- 安全短语区：画家 / 已猜中者 / 观战者不能发送文字 -->
    <div v-else class="border-t-[0.18cqh] border-line pt-[0.8cqh]">
      <p class="text-muted text-[0.62em] leading-[1.3]">
        {{
          store.isDrawer
            ? strings.game.drawerChatHint
            : store.me?.spectating
              ? strings.game.spectatorChatHint
              : store.me?.guessed
                ? strings.game.guessedChatHint
                : strings.game.waitingChatHint
        }}
      </p>
      <div class="mt-[0.5cqh] grid grid-cols-2 gap-[0.4cqh_0.4em]">
        <button
          v-for="preset in store.config.presets.safeChat"
          :key="preset"
          type="button"
          class="bg-[#ffedd5] px-[0.3em] py-[0.45cqh] text-[#7c2d12] rounded-[0.45em] text-[0.58em]"
          :disabled="store.room.phase !== 'drawing' || store.me?.spectating"
          @click="store.sendPreset(preset)"
        >
          {{ preset }}
        </button>
      </div>
    </div>
  </aside>
</template>
