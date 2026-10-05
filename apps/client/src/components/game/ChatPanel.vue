<!--
  右侧常驻聊天区（20cqw 独立黑框常驻版）：
  单行容纳 15~16 汉字，短句猜词不折行，猜词者边看画边打字，手感极其丝滑。
  消息列表 + 底部固定猜词输入。猜词输入、消息滚动跟随与自动聚焦逻辑全部收敛到内部；
  是否可提交由父组件经 canGuess 传入，提交直接调用 store。
  输入框对无权限角色直接禁用（禁用样式已表达状态，不再渲染冗余的文字提示行）。
  高度与宽度撑满父容器（GameView 右栏 aside），流内常驻，上部滚动消息流，底部固定输入。

  聊天语义 props（S84 / S85）：标题 / 占位 / 提交目标由调用方给出——
  经典不传即现状（标题＝猜词消息、占位按角色派生、提交走 `guess:submit`）；
  接龙传入接龙标题与「发送消息」占位、提交目标为 chat（走独立事件 `chat:say`，与作答彻底分离）。
  输入区与发送钮的无障碍名同样按提交目标分流：接龙用 `strings.a11y` 的聊天语义键，
  经典保持 `ui.game.guessLabel` / `a11y.game.sendGuessAria` 逐条不变。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Lightbulb, Send } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { normalizeAnswer, type ChatMessage, type RoomMember } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useToasts } from '@/composables/useToasts'
import { useGameStore } from '@/stores/game'
import { roleTextFor } from '@/utils/role-text'
import AppInput from '@/components/common/AppInput.vue'

// canGuess 由父组件（useGameHud）计算，这里只用于输入框权限与提交保护。
const props = withDefaults(
  defineProps<{
    canGuess: boolean
    /** 面板标题；缺省＝经典「猜词消息」。 */
    title?: string
    /** 输入框占位；缺省＝经典按当前角色派生（画家＝发消息、猜词者＝发猜词）。 */
    placeholder?: string
    /** 提交目标：guess＝经典猜词；chat＝接龙独立聊天（`chat:say`）。 */
    submitTarget?: 'guess' | 'chat'
  }>(),
  { title: undefined, placeholder: undefined, submitTarget: 'guess' },
)

const store = useGameStore()
const toasts = useToasts()

/** 面板标题与输入占位：调用方给了就用，没给就回落到经典的按角色派生。 */
const panelTitle = computed(() => props.title ?? strings.ui.game.chatTitle)
const inputPlaceholder = computed(
  () =>
    props.placeholder ??
    (store.isDrawer ? strings.ui.game.drawerChatPlaceholder : strings.ui.game.guessPlaceholder),
)
/** 是否接龙聊天语义（社交频道，与作答彻底分离，S79）：无障碍名与提交目标都据此分流。 */
const isChatTarget = computed(() => props.submitTarget === 'chat')
/**
 * 输入区无障碍名：接龙聊天用聊天语义（a11y 层自带文案，不复用猜词的「输入你的答案」）；
 * 经典侧保持改造前的 `ui.game.guessLabel`，逐条不变。
 */
const inputAriaLabel = computed(() =>
  isChatTarget.value ? strings.a11y.game.relayChatInputAria : strings.ui.game.guessLabel,
)
/** 发送钮无障碍名：接龙＝「发送聊天消息」，经典＝「发送猜词」。 */
const sendButtonAria = computed(() =>
  isChatTarget.value ? strings.a11y.game.relayChatSendAria : strings.a11y.game.sendGuessAria,
)

// 猜词输入本地状态（输入框内容随 submit 清空）。
const guess = ref('')
// 消息列表 DOM 引用与「是否跟随最新消息」标记：上滚时暂停跟随，底部时恢复。
const messageList = ref<HTMLElement>()
const shouldFollowMessages = ref(true)
// 消息数据直接读取房间快照中的聊天记录，无需独立 ticker。
// 经典房的聊天流在 `game.messages`；接龙房没有经典 `game`，其房间级自由聊天在 `relay.messages`
// （与作答彻底分离，S79 / S20）——两者互斥，一次回退即可同时覆盖两种模式，经典读取顺序与改造前一致。
const messages = computed(() => store.room?.game?.messages ?? store.room?.relay?.messages ?? [])
function memberForMessage(message: ChatMessage): RoomMember | undefined {
  return message.playerId
    ? store.room?.members.find((member) => member.id === message.playerId)
    : undefined
}

/**
 * 玩家发言气泡沿用固定席位色；系统通知、猜对广播与差一字提示采用专属视觉分层样式，
 * 覆盖底色与边框。
 */
function messageStyle(message: ChatMessage): Record<string, string> | undefined {
  // 非玩家普通发言不附加席位强调色
  if (message.type === 'system' || message.type === 'correct' || message.type === 'near_miss') {
    return undefined
  }
  const member = memberForMessage(message)
  if (!member) return undefined
  return {
    borderLeftColor: member.seatColor,
    backgroundColor: `color-mix(in srgb, ${member.seatColor} 12%, white)`,
  }
}

/**
 * 玩家昵称胶囊徽章样式：以玩家所属席位颜色作为文字与边框，辅以半透明浅色底，
 * 与右侧发言正文形成鲜明区隔。
 */
function nicknameBadgeStyle(message: ChatMessage): Record<string, string> | undefined {
  const member = memberForMessage(message)
  if (!member) return undefined
  return {
    color: member.seatColor,
    borderColor: `color-mix(in srgb, ${member.seatColor} 45%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${member.seatColor} 18%, white)`,
  }
}
/** 聊天消息类型对应的分层着色样式类。 */
function messageClass(message: ChatMessage): string {
  switch (message.type) {
    case 'system':
      // 常规系统消息（进出房间等）：中性浅灰微字，低侵入感
      return 'border-line/60 bg-paper/60 text-muted border-l-line'
    case 'correct':
      // 猜对答案广播：淡绿微底色，清晰激励
      return 'bg-green/10 text-success-fg border border-green/30 border-l-green'
    case 'near_miss':
      // 差一字私密提示：淡橙微底色，带有专属警示醒目标记
      return 'bg-yellow/15 text-navy border border-yellow/40 border-l-yellow font-bold'
    default:
      // 常规猜词与预设互动消息
      return 'border-line bg-white text-navy'
  }
}

/**
 * 提交输入内容：先交由服务端裁决，只有成功送达才清空输入框；
 * 超时或业务失败（如重复猜中）时保留草稿，避免玩家已输入的内容被吞。
 * 接龙的提交目标是独立聊天频道（`chat:say`），永不携带作答（S79 / S20）。
 */
async function sendGuess(): Promise<void> {
  const text = guess.value.trim()
  if (!text || !props.canGuess) return

  if (props.submitTarget === 'chat') {
    const delivered = await store.relayChat(text)
    if (delivered) {
      playInteractionSound('activate')
      guess.value = ''
    }
    return
  }

  // 画家如果发送内容为答案，则在客户端直接拦截并弹出 Toast 提示无法发送答案
  if (store.isDrawer && store.room?.game?.answer) {
    const normalizedInput = normalizeAnswer(text)
    const normalizedAnswer = normalizeAnswer(store.room.game.answer)
    if (normalizedInput === normalizedAnswer) {
      toasts.notify(strings.ui.game.drawerCannotSendAnswer, 'warning')
      return
    }
  }

  const delivered = await store.submitGuess(text)
  if (delivered) {
    playInteractionSound('activate')
    guess.value = ''
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
// 可猜词判定唯一口径是父组件传入的 props.canGuess（useGameHud 计算，含连接态），
// 组件内不再内联第二份 phase/drawer/guessed 组合（ADR-0028 客户端事实口径）。
// AppInput 经 defineExpose 暴露 focus()，输入元素本身仍是原语内部实现细节。
const guessInput = ref<{ focus: () => void }>()
watch(
  () => props.canGuess,
  (canGuessNow) => {
    if (canGuessNow && store.settings.autoFocusGuess) void nextTick(() => guessInput.value?.focus())
  },
  { immediate: true },
)

/** 供父层（对局面板快捷键）聚焦猜词输入框；输入原语仍是本组件内部实现细节。 */
function focusInput(): void {
  void nextTick(() => guessInput.value?.focus())
}
defineExpose({ focusInput })
</script>

<template>
  <!-- 右侧聊天区：上部滚动消息流 + 底部固定猜词输入与预设短语 -->
  <aside v-if="store.room" class="flex h-full min-w-0 flex-col bg-paper px-[0.9cqw] py-[1.2cqh]">
    <header class="flex items-center justify-between border-b-[0.18cqh] border-line pb-[1cqh]">
      <div>
        <span class="text-blue text-fs-10 tracking-[0.15em]">{{
          strings.ui.game.liveChatLabel
        }}</span>
        <h2 class="text-fs-18">{{ panelTitle }}</h2>
      </div>
      <!-- 当前角色标签：已猜中 / 作画中 / 猜词中（与得分条共用同一映射）；
           接龙聊天没有经典局内角色（画家与已猜中在接龙恒不成立），故按提交目标隐藏该标签 -->
      <span
        v-if="props.submitTarget !== 'chat'"
        class="bg-sky px-[0.6em] py-[0.35cqh] text-blue rounded-[99em] text-fs-10 font-bold"
        >{{ roleTextFor(store.me) }}</span
      >
    </header>
    <!-- 消息列表：猜词、系统、猜中、预设等类型分别高亮 -->
    <div
      ref="messageList"
      class="flex min-h-0 flex-1 flex-col gap-[0.6cqh] overflow-y-auto overflow-x-hidden py-[1cqh] pl-0 pr-[0.35em] overscroll-contain scrollbar-gutter-stable"
      aria-live="polite"
      @scroll="handleMessageScroll"
    >
      <!--
        first:mt-auto（聊天窗口锚底技巧）：消息总高不足一屏时，靠首元素自动外边距
        吃掉剩余空间、把整列推到底部，与「最新消息在下方」的阅读锚点一致；
        内容超过一屏后 mt-auto 归零，不影响滚动跟随逻辑。
      -->
      <template v-for="message in messages" :key="message.id">
        <!-- 系统通知消息：水平垂直居中对齐的圆角矩形卡片 -->
        <div
          v-if="message.type === 'system'"
          class="self-center mx-auto my-[0.35cqh] flex flex-col items-center justify-center text-center rounded-[0.55em] border-[0.16cqh] border-line/80 bg-paper/85 px-[0.9em] py-[0.45cqh] text-fs-10 text-muted leading-[1.35] max-w-[92%] first:mt-auto ui-feedback"
        >
          <span>{{ message.text }}</span>
        </div>
        <!-- 其它消息（普通猜词、猜中通报、差一字提示） -->
        <div
          v-else
          :class="[
            'flex flex-wrap items-center gap-[0.45em] border-l-[0.3cqh] px-[0.65em] py-[0.5cqh] text-fs-12 leading-[1.35] first:mt-auto ui-feedback rounded-r-[0.35em]',
            messageClass(message),
            message.playerId && message.type !== 'near_miss' && 'font-bold',
          ]"
          :style="messageStyle(message)"
        >
          <!-- 差一字私密提示专属图标 -->
          <Lightbulb
            v-if="message.type === 'near_miss'"
            class="h-[1.8cqh] w-[1.8cqh] text-warning-fg shrink-0 select-none"
            aria-hidden="true"
          />
          <span
            v-if="message.playerId && message.type !== 'near_miss'"
            class="inline-flex items-center px-[0.45em] py-[0.1cqh] rounded-full text-fs-10 font-bold border"
            :style="nicknameBadgeStyle(message)"
          >
            {{ memberForMessage(message)?.nickname }}
          </span>
          <span class="break-words">{{ message.text }}</span>
        </div>
      </template>
      <div v-if="!messages.length" class="m-auto flex flex-col items-center text-muted text-fs-12">
        <Send class="h-[4cqh] w-[4cqh]" /><span>{{ strings.ui.game.noMessages }}</span>
      </div>
    </div>
    <!-- 底部固定猜词输入：顶部分割线隔开消息列表，无猜词权限时仅禁用输入 -->
    <form
      class="flex gap-[0.5em] border-t-[0.18cqh] border-line pt-[0.8cqh]"
      @submit.prevent="sendGuess"
    >
      <label for="guess-input" class="sr-only">{{ inputAriaLabel }}</label>
      <AppInput
        id="guess-input"
        ref="guessInput"
        v-model="guess"
        size="body"
        class="min-w-0 flex-1"
        :maxlength="store.config.player.chatMaxLength"
        :disabled="!canGuess"
        :placeholder="inputPlaceholder"
      />
      <button
        type="submit"
        class="grid h-[5.2cqh] w-[5.2cqh] shrink-0 place-items-center rounded-[0.65em] bg-blue text-white disabled:cursor-not-allowed disabled:bg-line"
        :disabled="!canGuess || !guess.trim()"
        :aria-label="sendButtonAria"
      >
        <Send class="h-[2.5cqh] w-[2.5cqh]" />
      </button>
    </form>
  </aside>
</template>
