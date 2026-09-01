<!-- 房间等待界面：固定六个游戏席位、权威准备门槛、房主规则与本局词库管理。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  BookOpenCheck,
  Check,
  ClipboardCopy,
  Crown,
  KeyRound,
  LogOut,
  Play,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import { useGameStore } from '@/stores/game'
import type { RoomSettings, VocabularyItem } from '@draw-guess/shared'

const store = useGameStore()
// ---- 弹窗开关状态 ----
const showVocabulary = ref(false) // 词库管理弹窗
const showSettings = ref(false) // 规则编辑弹窗
const showInvite = ref(false) // 邀请弹窗
const showLeaveConfirm = ref(false) // 退出确认弹窗
const search = ref('') // 搜索框即时输入
const searchKeyword = ref('') // 150ms 防抖后的实际筛选关键词
const selectedIds = ref(new Set<string>()) // 使用响应式 Set，5000+ 词条下单选仍为 O(1)
const settingsDraft = ref<RoomSettings>() // 规则编辑草稿（保存前可取消）
const vocabularyLoading = ref(false)
const wordGrid = ref<HTMLElement>()
const wordGridScrollTop = ref(0)
const wordGridHeight = ref(1)
const wordRowStride = ref(44)
let searchTimer: number | undefined
let gridObserver: ResizeObserver | undefined
const WORD_GRID_COLUMNS = 6
const WORD_GRID_OVERSCAN_ROWS = 3

// 席位展示：按最大人数生成槽位，空位填空（undefined）
const slots = computed(() =>
  Array.from(
    { length: store.room?.settings.maxPlayers ?? 6 },
    (_, index) => store.room?.members[index],
  ),
)
// 开局判定：房主由服务端视为隐式准备，只要求所有可玩成员在线且其他成员显式准备。
const canHostStart = computed(() => {
  const active = (store.room?.members ?? []).filter((member) => !member.spectating)
  return Boolean(
    store.room &&
    active.length >= 2 &&
    active.every((member) => member.connection === 'online') &&
    active.filter((member) => !member.isHost).every((member) => member.ready),
  )
})
// 非房主提示仍沿用“全员就绪”语义；服务端快照会把房主裁剪为已准备。
const allReady = computed(() => {
  const active = (store.room?.members ?? []).filter((member) => !member.spectating)
  return (
    active.length >= 2 && active.every((member) => member.ready && member.connection === 'online')
  )
})
// 可邀请玩家：空闲且允许接收邀请的在线玩家（排除自己）
const availablePlayers = computed(() =>
  store.presence.players.filter(
    (player) => player.id !== store.playerId && player.status === 'idle',
  ),
)
// 词面规范化结果仅在词库快照变化时生成一次，避免每次输入重复处理 5000 个字符串。
const searchableWords = computed(() =>
  (store.vocabulary?.items ?? []).map((item) => ({
    item,
    searchText: item.text.normalize('NFKC').toLocaleLowerCase(),
  })),
)
const filteredWords = computed<VocabularyItem[]>(() => {
  const keyword = searchKeyword.value.normalize('NFKC').trim().toLocaleLowerCase()
  return searchableWords.value
    .filter((entry) => !keyword || entry.searchText.includes(keyword))
    .map((entry) => entry.item)
})
// 虚拟网格只渲染可视行及少量缓冲，滚动到 5000+ 词条后 DOM 数量仍保持稳定。
const firstVirtualRow = computed(() =>
  Math.max(0, Math.floor(wordGridScrollTop.value / wordRowStride.value) - WORD_GRID_OVERSCAN_ROWS),
)
const visibleVirtualRows = computed(
  () => Math.ceil(wordGridHeight.value / wordRowStride.value) + WORD_GRID_OVERSCAN_ROWS * 2,
)
const virtualWords = computed(() => {
  const start = firstVirtualRow.value * WORD_GRID_COLUMNS
  return filteredWords.value.slice(start, start + visibleVirtualRows.value * WORD_GRID_COLUMNS)
})
const virtualGridHeight = computed(
  () => Math.ceil(filteredWords.value.length / WORD_GRID_COLUMNS) * wordRowStride.value,
)
const virtualGridOffset = computed(() => firstVirtualRow.value * wordRowStride.value)

/** 打开词库弹窗：请求失败时保持关闭；成功后初始化虚拟滚动测量。 */
async function openVocabulary(): Promise<void> {
  if (vocabularyLoading.value) return
  vocabularyLoading.value = true
  try {
    await store.loadVocabulary()
    selectedIds.value = new Set(store.vocabulary?.selectedIds ?? [])
    search.value = ''
    searchKeyword.value = ''
    showVocabulary.value = true
    await nextTick()
    updateVirtualMetrics()
    gridObserver?.disconnect()
    if (wordGrid.value) {
      gridObserver = new ResizeObserver(updateVirtualMetrics)
      gridObserver.observe(wordGrid.value)
    }
  } finally {
    vocabularyLoading.value = false
  }
}
/** 批量增删选中词条；响应式 Set 避免每次点击复制整个 5000 项数组。 */
function setSelection(ids: string[], selected: boolean): void {
  for (const id of ids) {
    if (selected) selectedIds.value.add(id)
    else selectedIds.value.delete(id)
  }
}
/** 保存词库选择；请求失败由统一请求层提示，并保留当前弹窗和选择供重试。 */
async function saveVocabulary(): Promise<void> {
  await store.saveVocabulary([...selectedIds.value])
  showVocabulary.value = false
}
/**
 * 同步虚拟行高与可视区域。
 * 行高以真实渲染测量为准（标签实际高度 + 网格行间距），避免估算值与 CSS 错位造成滚动空白或重叠。
 */
function updateVirtualMetrics(): void {
  const element = wordGrid.value
  if (!element) return
  wordGridHeight.value = Math.max(1, element.clientHeight)
  const gridWindow = element.querySelector('.word-grid-window')
  const sampleLabel = gridWindow?.querySelector('label')
  if (gridWindow && sampleLabel) {
    const rowGap = parseFloat(getComputedStyle(gridWindow).rowGap) || 0
    wordRowStride.value = Math.max(28, sampleLabel.getBoundingClientRect().height + rowGap)
  }
}
/** 只记录滚动位置，不随滚动创建累计 DOM。 */
function handleWordGridScroll(event: Event): void {
  wordGridScrollTop.value = (event.currentTarget as HTMLElement).scrollTop
}
/** 复制私密房间码；局域网 HTTP 下 clipboard 不可用时使用 textarea 降级。 */
async function copyPrivateCode(): Promise<void> {
  const code = store.room?.privateJoinCode
  if (!code) return
  let copied = false
  try {
    if (typeof navigator.clipboard?.writeText !== 'function')
      throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(code)
    copied = true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = code
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    } finally {
      textarea.remove()
    }
  }
  store.notify(
    copied ? strings.room.privateCodeCopied : strings.room.privateCodeCopyFailed,
    copied ? 'success' : 'warning',
  )
}

// 搜索防抖后回到列表顶部，保证筛选结果与虚拟窗口起点一致。
watch(search, (value) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    searchKeyword.value = value
    wordGridScrollTop.value = 0
    if (wordGrid.value) wordGrid.value.scrollTop = 0
  }, 150)
})
onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  gridObserver?.disconnect()
})
/** 打开规则弹窗：以当前房间规则初始化草稿。 */
function openSettings(): void {
  if (!store.room) return
  settingsDraft.value = { ...store.room.settings }
  showSettings.value = true
}
/** 保存规则草稿并关闭弹窗。 */
async function saveSettings(): Promise<void> {
  if (!settingsDraft.value) return
  await store.updateRoomSettings(settingsDraft.value)
  showSettings.value = false
}
</script>

<template>
  <!-- 房间等待界面骨架：左侧席位区 + 右侧控制区，顶栏含房间名与退出 -->
  <main
    v-if="store.room"
    class="grid h-full grid-cols-[minmax(0,67%)_33%] grid-rows-[11%_89%] bg-[#eef2ff]"
  >
    <!-- 顶栏：房间名、房间可见性标识、连接状态与退出按钮 -->
    <header
      class="col-span-full grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.5cqh] border-yellow bg-navy px-[2cqw] text-white"
    >
      <div class="flex items-baseline gap-[0.8em] min-w-0">
        <span class="text-[#93c5fd] text-[0.65em] tracking-[0.15em]">{{
          strings.room.roomEyebrow
        }}</span>
        <h1 class="overflow-hidden text-ellipsis whitespace-nowrap text-[1.35em]">
          {{ store.room.name }}
        </h1>
      </div>
      <div
        class="flex items-center justify-self-center gap-[0.6em] text-yellow text-[0.72em] font-black"
        :class="store.room.visibility === 'private' ? '!text-[#fbcfe8]' : ''"
      >
        <KeyRound v-if="store.room.visibility === 'private'" />
        <ShieldCheck v-else />
        {{
          store.room.visibility === 'private'
            ? strings.room.privateRoomBadge
            : strings.room.publicRoomBadge
        }}
        <button
          v-if="store.room.privateJoinCode"
          type="button"
          class="flex items-center gap-[0.4em] py-[0.55cqh] px-[0.75em] text-navy bg-yellow rounded-[0.55em] tracking-[0.16em]"
          :aria-label="strings.room.copyPrivateCodeAria"
          @click="copyPrivateCode"
        >
          <b>{{ store.room.privateJoinCode }}</b
          ><ClipboardCopy />
        </button>
      </div>
      <div class="justify-self-end flex items-center gap-[0.6em]">
        <span
          class="inline-flex items-center gap-[0.55em] py-[0.65cqh] px-[1.05em] rounded-[99em] text-[0.65em] font-extrabold text-[#14532d] bg-[#dcfce7]"
          ><ShieldCheck /> {{ strings.room.authoritativeConnected }}</span
        >
        <button type="button" @click="showLeaveConfirm = true">
          <LogOut /> {{ strings.common.exit }}
        </button>
      </div>
    </header>

    <!-- 席位区：固定网格展示全部玩家座位与准备状态 -->
    <section class="min-w-0 py-[3cqh] px-[2.5cqw] border-r-[0.2cqh] border-r-line">
      <div>
        <div>
          <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
            {{ strings.room.playersEyebrow }}
          </p>
          <h2>{{ strings.room.playersTitle }}</h2>
        </div>
        <span class="flex items-center gap-[0.45em] text-muted font-extrabold"
          ><Users />
          {{
            strings.room.seatCount(store.room.members.length, store.room.settings.maxPlayers)
          }}</span
        >
      </div>
      <!-- 席位网格：已占用的显示玩家信息，空位显示邀请提示；房主可踢人 -->
      <div class="grid h-[67cqh] grid-cols-3 grid-rows-2 gap-[2cqh_1.5cqw] mt-[2.5cqh]">
        <article
          v-for="(member, index) in slots"
          :key="member?.id ?? index"
          class="relative flex min-w-0 flex-col items-center justify-center rounded-[1em] border-[0.24cqh] border-[#cbd5e1] border-b-[0.6cqh] bg-white border-b-slate-400 transition-[transform,box-shadow,border-color,background-color,color,opacity] duration-[160ms] hover:border-[#93c5fd] hover:shadow-[0_0.6cqh_1.6cqh_#17255418]"
          :class="[
            !member ? 'border-dashed !bg-slate-50 !text-slate-400' : '',
            member?.ready ? '!border-[#86efac] !border-b-green' : '',
            member?.id === store.playerId ? 'shadow-[inset_0_0_0_0.3cqh_#2563eb]' : '',
          ]"
        >
          <template v-if="member">
            <div class="relative h-[10cqh] w-[10cqh]">
              <AvatarImage
                class="h-full w-full"
                :avatar-id="member.avatarId"
                :label="strings.common.playerAvatarAria(member.nickname)"
              />
              <Crown
                v-if="member.isHost"
                class="absolute right-[-0.4cqh] top-[-0.7cqh] h-[3.2cqh] w-[3.2cqh] p-[0.45cqh] text-[#854d0e] bg-yellow rounded-full"
                :aria-label="strings.room.hostCrownAria"
              />
            </div>
            <div class="flex items-center gap-[0.4em] max-w-[90%] mt-[0.7cqh]">
              <b class="overflow-hidden text-ellipsis whitespace-nowrap">{{ member.nickname }}</b
              ><span
                v-if="member.id === store.playerId"
                class="py-[0.1cqh] px-[0.45em] text-white bg-blue rounded-[99em] text-[0.55em]"
                >{{ strings.room.meTag }}</span
              >
            </div>
            <!-- 准备状态标签：观战 / 已准备 / 重连中 / 未准备 -->
            <span
              v-if="!member.isHost || member.spectating"
              class="min-w-[7em] flex items-center justify-center gap-[0.35em] mt-[0.7cqh] py-[0.4cqh] px-[0.8em] text-slate-600 bg-slate-200 rounded-[99em] text-[0.68em] font-black"
              :class="member.ready ? '!text-[#14532d] !bg-[#dcfce7]' : ''"
              >{{
                member.spectating
                  ? strings.status.roleSpectating
                  : member.ready
                    ? strings.status.roleReady
                    : member.connection === 'reconnecting'
                      ? strings.status.roleReconnecting
                      : strings.status.roleNotReady
              }}</span
            >
            <!-- 房主移除玩家按钮：只对非自己的成员显示 -->
            <button
              v-if="store.isHost && member.id !== store.playerId"
              class="absolute right-[0.6cqh] top-[0.6cqh] grid place-items-center h-[3cqh] w-[3cqh] text-[#991b1b] bg-[#fee2e2] rounded-full"
              type="button"
              :aria-label="strings.room.kickAria"
              @click="store.kick(member.id)"
            >
              <X />
            </button>
          </template>
          <!-- 空席位占位提示 -->
          <template v-else
            ><UserPlus class="h-[5cqh] w-[5cqh]" /><b>{{ strings.room.emptySeatTitle }}</b
            ><span class="text-[0.65em]">{{ strings.room.emptySeatHint }}</span></template
          >
        </article>
      </div>
    </section>

    <!-- 右侧控制区：规则摘要、词库管理、邀请、准备与开始 -->
    <aside class="min-w-0 flex flex-col py-[2.5cqh] px-[1.6cqw] bg-slate-50">
      <!-- 规则摘要：作画轮数 / 时间 / 候选词 / 提示 -->
      <div>
        <div class="grid grid-cols-[1fr_auto] items-center">
          <p class="col-start-1 text-blue font-black tracking-[0.16em] text-[0.72em]">
            {{ strings.room.rulesEyebrow }}
          </p>
          <h2 class="col-start-1">{{ strings.room.rulesTitle }}</h2>
          <button
            v-if="store.isHost"
            type="button"
            class="col-start-2 row-[1_/_3] flex items-center gap-[0.4em] text-blue bg-transparent font-extrabold"
            @click="openSettings"
          >
            <Settings2 /> {{ strings.room.rulesEdit }}
          </button>
        </div>
        <dl class="my-[1.4cqh] border-t-[0.16cqh] border-t-line">
          <div
            class="flex justify-between py-[0.85cqh] border-b-[0.14cqh] border-b-slate-200 text-[0.75em]"
          >
            <dt class="text-muted">{{ strings.room.ruleRoundsDt }}</dt>
            <dd class="m-0 font-black">
              {{ strings.room.ruleRoundsDd(store.room.settings.roundsPerPlayer) }}
            </dd>
          </div>
          <div
            class="flex justify-between py-[0.85cqh] border-b-[0.14cqh] border-b-slate-200 text-[0.75em]"
          >
            <dt class="text-muted">{{ strings.room.ruleDrawDt }}</dt>
            <dd class="m-0 font-black">
              {{ strings.room.ruleDrawDd(store.room.settings.drawSeconds) }}
            </dd>
          </div>
          <div
            class="flex justify-between py-[0.85cqh] border-b-[0.14cqh] border-b-slate-200 text-[0.75em]"
          >
            <dt class="text-muted">{{ strings.room.ruleOptionsDt }}</dt>
            <dd class="m-0 font-black">
              {{ strings.room.ruleOptionsDd(store.room.settings.optionCount) }}
            </dd>
          </div>
          <div
            class="flex justify-between py-[0.85cqh] border-b-[0.14cqh] border-b-slate-200 text-[0.75em]"
          >
            <dt class="text-muted">{{ strings.room.ruleHintsDt }}</dt>
            <dd class="m-0 font-black">
              {{
                store.room.settings.progressiveHints ? strings.room.hintsOn : strings.room.hintsOff
              }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- 词库管理入口：仅房主可编辑，展示已选/总词条数 -->
      <button
        class="flex items-center gap-[0.75em] min-h-[7cqh] py-[0.8cqh] px-[0.8em] text-[#1e3a8a] bg-sky !border-l-[0.45cqh] !border-l-blue text-left"
        type="button"
        :disabled="!store.isHost || vocabularyLoading"
        @click="openVocabulary"
      >
        <BookOpenCheck class="h-[3.4cqh] w-[3.4cqh]" /><span class="flex-1 flex flex-col"
          ><b>{{ strings.room.vocabularyTitle }}</b
          ><small class="text-muted">{{
            strings.room.vocabularyCount(store.room.selectedWordCount, store.room.totalWordCount)
          }}</small></span
        ><span class="text-[0.68em] font-extrabold">{{
          store.isHost ? strings.room.vocabularyManage : strings.room.vocabularyHostOnly
        }}</span>
      </button>

      <!-- 邀请在线玩家：满员或无权限时禁用 -->
      <div class="grid grid-cols-1 gap-[0.6em] my-[1.3cqh]">
        <button
          class="inline-flex min-h-[4.6cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[0.5em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line text-[0.72em]"
          type="button"
          :disabled="
            store.room.members.length >= store.room.settings.maxPlayers ||
            (!store.isHost && !store.room.settings.allowPlayerInvite)
          "
          :title="
            store.room.members.length >= store.room.settings.maxPlayers
              ? strings.room.inviteDisabledFull
              : !store.isHost && !store.room.settings.allowPlayerInvite
                ? strings.room.inviteDisabledHostOnly
                : strings.room.inviteDisabledTip
          "
          @click="showInvite = true"
        >
          <Send /> {{ strings.room.invitePlayers }}
        </button>
      </div>

      <!-- 房主只显示开始按钮；其他玩家保留准备按钮，观战者不能参与准备。 -->
      <div class="mt-auto pt-[1.3cqh] border-t-[0.2cqh] border-t-line text-center">
        <p v-if="store.me?.spectating" class="min-h-[2.4cqh] text-muted text-[0.69em]">
          {{ strings.room.spectatorReadyHint }}
        </p>
        <p
          v-else-if="!(store.isHost ? canHostStart : allReady)"
          class="min-h-[2.4cqh] text-muted text-[0.69em]"
        >
          {{
            (store.room.members || []).filter((member) => !member.spectating).length < 2
              ? strings.room.needMorePlayers
              : store.isHost
                ? strings.room.waitForGuestsReady
                : strings.room.waitForReady
          }}
        </p>
        <p
          v-else
          class="min-h-[2.4cqh] flex items-center justify-center gap-[0.3em] text-green text-[0.69em]"
        >
          <Check /> {{ strings.room.allReady }}
        </p>
        <button
          v-if="!store.isHost && !store.me?.spectating"
          class="w-full min-h-[5.2cqh] my-[0.8cqh] text-navy bg-white border-[0.22cqh] border-blue rounded-[0.7em] font-[1000]"
          :class="store.me?.ready ? '!text-[#14532d] !bg-[#dcfce7] !border-green' : ''"
          type="button"
          @click="store.setReady(!store.me?.ready)"
        >
          {{ store.me?.ready ? strings.room.cancelReady : strings.room.readyGo }}
        </button>
        <button
          v-else-if="!store.isHost"
          class="w-full min-h-[5.2cqh] my-[0.8cqh] text-navy bg-white border-[0.22cqh] border-blue rounded-[0.7em] font-[1000]"
          type="button"
          disabled
          :title="strings.room.spectatorReadyTitle"
        >
          {{ strings.room.spectatorReadyButton }}
        </button>
        <button
          v-if="store.isHost"
          class="w-full inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
          type="button"
          :disabled="!canHostStart"
          @click="store.startGame"
        >
          <Play /> {{ strings.room.startGame }}
        </button>
      </div>
    </aside>

    <!-- 弹窗一：本局词库管理（房主）——搜索、批量选择、确认保存 -->
    <Transition name="modal">
      <div
        v-if="showVocabulary && store.vocabulary"
        class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vocab-title"
      >
        <section
          class="game-dialog flex max-h-[86cqh] flex-col overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper text-ink shadow-[0_1.4cqh_4cqh_#0007] w-[88cqw] h-[84cqh]"
        >
          <header
            class="flex min-h-[9cqh] items-center justify-between bg-navy px-[1.7em] py-[1.3cqh] text-white"
          >
            <div>
              <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
                {{ strings.room.vocabLabel }}
              </p>
              <h2 id="vocab-title">{{ strings.room.vocabTitle }}</h2>
            </div>
            <button
              type="button"
              class="grid h-[4cqh] w-[4cqh] place-items-center rounded-full bg-white/10 text-white text-[1.2em]"
              :aria-label="strings.room.vocabCloseAria"
              @click="showVocabulary = false"
            >
              <X />
            </button>
          </header>
          <!-- 词库统计：全部 / 搜索结果 / 已选数量 -->
          <div
            class="flex gap-[2em] py-[1.2cqh] px-[1.7em] text-slate-600 bg-sky-100 text-[0.78em]"
          >
            <span
              >{{ strings.room.vocabAll }}
              <b class="text-blue">{{ store.vocabulary.items.length }}</b></span
            ><span
              >{{ strings.room.vocabResults }}
              <b class="text-blue">{{ filteredWords.length }}</b></span
            ><span
              >{{ strings.room.vocabSelected }}
              <b class="text-blue">{{ selectedIds.size }}</b></span
            >
          </div>
          <!-- 工具栏：搜索框 + 四个批量选择按钮 -->
          <div
            class="grid grid-cols-[2fr_repeat(4,auto)] gap-[0.6em] py-[1.1cqh] px-[1.7em] border-b-[0.18cqh] border-b-line"
          >
            <label
              class="flex h-[4.8cqh] items-center gap-[0.6em] rounded-[0.65em] border-[0.18cqh] border-line bg-white px-[0.75em]"
              ><Search /><input
                v-model="search"
                class="w-full min-w-0 border-0 outline-0 bg-transparent"
                :placeholder="strings.room.vocabSearchPlaceholder"
                :aria-label="strings.room.vocabSearchAria" /><button
                v-if="search"
                type="button"
                :aria-label="strings.room.vocabClearSearchAria"
                class="grid place-items-center bg-transparent"
                @click="search = ''"
              >
                <X /></button
            ></label>
            <button
              type="button"
              class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
              @click="
                setSelection(
                  store.vocabulary!.items.map((item) => item.id),
                  true,
                )
              "
            >
              {{ strings.room.selectAll }}
            </button>
            <button
              type="button"
              class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
              @click="
                setSelection(
                  store.vocabulary!.items.map((item) => item.id),
                  false,
                )
              "
            >
              {{ strings.room.deselectAll }}
            </button>
            <button
              type="button"
              class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
              @click="
                setSelection(
                  filteredWords.map((item) => item.id),
                  true,
                )
              "
            >
              {{ strings.room.selectResults }}
            </button>
            <button
              type="button"
              class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
              @click="
                setSelection(
                  filteredWords.map((item) => item.id),
                  false,
                )
              "
            >
              {{ strings.room.deselectResults }}
            </button>
          </div>
          <!-- 虚拟词条网格：滚动容器保留完整高度，只挂载可视行和缓冲行。 -->
          <div
            ref="wordGrid"
            class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-[1.7em] [overscroll-behavior:contain] [scrollbar-gutter:stable]"
            @scroll="handleWordGridScroll"
          >
            <div class="relative w-full" :style="{ height: `${virtualGridHeight}px` }">
              <div
                class="word-grid-window absolute inset-x-0 top-0 grid grid-cols-6 [grid-auto-rows:5.6cqh] gap-[0.8cqh_0.6em] pt-[0.4cqh] will-change-transform"
                :style="{ transform: `translateY(${virtualGridOffset}px)` }"
              >
                <label
                  v-for="item in virtualWords"
                  :key="item.id"
                  class="flex min-w-0 items-center gap-[0.4em] rounded-[0.5em] border-[0.16cqh] border-line bg-white px-[0.65em] py-[0.5cqh] text-[0.76em] text-slate-600 cursor-pointer"
                  :class="
                    selectedIds.has(item.id) ? '!border-blue !bg-sky-100 !text-[#1e3a8a]' : ''
                  "
                  ><input
                    type="checkbox"
                    class="absolute [opacity:0]"
                    :checked="selectedIds.has(item.id)"
                    @change="setSelection([item.id], !selectedIds.has(item.id))" /><span
                    class="flex-1 truncate"
                    >{{ item.text }}</span
                  ><Check v-if="selectedIds.has(item.id)" class="text-blue"
                /></label>
              </div>
            </div>
          </div>
          <!-- 底部操作：保存词库（数量不足时禁用）或恢复默认全选 -->
          <footer
            class="flex min-h-[8cqh] items-center justify-end gap-[0.8em] bg-slate-200 px-[1.7em] py-[1cqh]"
          >
            <p
              class="mr-auto text-muted text-[0.72em]"
              :class="selectedIds.size < store.config.vocabulary.minWords ? '!text-red' : ''"
            >
              {{ strings.room.vocabMinHint(store.config.vocabulary.minWords) }}
            </p>
            <button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
              type="button"
              @click="
                setSelection(
                  store.vocabulary!.items.map((item) => item.id),
                  true,
                )
              "
            >
              {{ strings.room.restoreDefault }}</button
            ><button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
              type="button"
              :disabled="selectedIds.size < store.config.vocabulary.minWords"
              @click="saveVocabulary"
            >
              {{ strings.room.confirmSelection }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>

    <!-- 弹窗二：房间规则编辑（房主）——滑块与开关修改规则 -->
    <Transition name="modal">
      <div
        v-if="showSettings && settingsDraft"
        class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
      >
        <section
          class="game-dialog flex max-h-[86cqh] flex-col overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper text-ink shadow-[0_1.4cqh_4cqh_#0007] w-[70cqw]"
        >
          <header
            class="flex min-h-[9cqh] items-center justify-between bg-navy px-[1.7em] py-[1.3cqh] text-white"
          >
            <div>
              <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
                {{ strings.room.settingsLabel }}
              </p>
              <h2 id="rules-title">{{ strings.room.settingsTitle }}</h2>
            </div>
            <button
              type="button"
              class="grid h-[4cqh] w-[4cqh] place-items-center rounded-full bg-white/10 text-white text-[1.2em]"
              :aria-label="strings.room.settingsCloseAria"
              @click="showSettings = false"
            >
              <X />
            </button>
          </header>
          <!-- 规则编辑表单：数值字段用滑块，开关用复选框；中途加入策略为下拉框 -->
          <div class="grid grid-cols-3 gap-[1.2cqh_1.3em] py-[2cqh] px-[1.8em]">
            <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
              >{{ strings.room.maxPlayersField }}
              <select
                v-model="settingsDraft.maxPlayers"
                class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
              >
                <option v-for="value in 5" :key="value" :value="value + 1">
                  {{ strings.common.playersUnit(value + 1) }}
                </option></select
              ><small class="text-muted text-[0.8em]">{{
                strings.room.maxPlayersNote
              }}</small></label
            >
            <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
              >{{ strings.common.roundsField }}
              <input
                v-model.number="settingsDraft.roundsPerPlayer"
                type="range"
                :min="store.config.game.roundsPerPlayer.min"
                :max="store.config.game.roundsPerPlayer.max"
                :step="store.config.game.roundsPerPlayer.step"
              /><b class="text-blue">{{
                strings.common.roundsUnit(settingsDraft.roundsPerPlayer)
              }}</b></label
            >
            <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
              >{{ strings.common.drawTimeField }}
              <input
                v-model.number="settingsDraft.drawSeconds"
                type="range"
                :min="store.config.game.drawSeconds.min"
                :max="store.config.game.drawSeconds.max"
                :step="store.config.game.drawSeconds.step"
              /><b class="text-blue">{{
                strings.common.secondsUnit(settingsDraft.drawSeconds)
              }}</b></label
            >
            <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
              >{{ strings.room.chooseTimeField }}
              <input
                v-model.number="settingsDraft.chooseSeconds"
                type="range"
                :min="store.config.game.chooseSeconds.min"
                :max="store.config.game.chooseSeconds.max"
                :step="store.config.game.chooseSeconds.step"
              /><b class="text-blue">{{
                strings.common.secondsUnit(settingsDraft.chooseSeconds)
              }}</b></label
            >
            <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
              >{{ strings.room.optionCountField }}
              <input
                v-model.number="settingsDraft.optionCount"
                type="range"
                :min="store.config.game.optionCount.min"
                :max="store.config.game.optionCount.max"
                :step="store.config.game.optionCount.step"
              /><b class="text-blue">{{
                strings.room.optionCountUnit(settingsDraft.optionCount)
              }}</b></label
            >
            <label
              class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
              ><input
                v-model="settingsDraft.showWordLength"
                type="checkbox"
                class="h-[2.2cqh] w-[2.2cqh] accent-blue"
              />
              {{ strings.room.toggleShowWordLength }}</label
            >
            <label
              class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
              ><input
                v-model="settingsDraft.progressiveHints"
                type="checkbox"
                class="h-[2.2cqh] w-[2.2cqh] accent-blue"
              />
              {{ strings.room.toggleProgressiveHints }}</label
            >
            <label
              class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
              ><input
                v-model="settingsDraft.closeGuessEnabled"
                type="checkbox"
                class="h-[2.2cqh] w-[2.2cqh] accent-blue"
              />
              {{ strings.room.toggleCloseGuess }}</label
            >
            <label
              class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
              ><input
                v-model="settingsDraft.allowPlayerInvite"
                type="checkbox"
                class="h-[2.2cqh] w-[2.2cqh] accent-blue"
              />
              {{ strings.room.togglePlayerInvite }}</label
            >
            <label
              class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
              ><input
                v-model="settingsDraft.allowPause"
                type="checkbox"
                class="h-[2.2cqh] w-[2.2cqh] accent-blue"
              />
              {{ strings.room.togglePause }}</label
            >
            <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
              >{{ strings.room.joinPolicyField }}
              <select
                v-model="settingsDraft.joinPolicy"
                class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
              >
                <option value="forbid">{{ strings.room.joinPolicyForbid }}</option>
                <option value="spectate">{{ strings.room.joinPolicySpectate }}</option>
                <option value="next_game">{{ strings.room.joinPolicyNextGame }}</option>
              </select></label
            >
          </div>
          <!-- 底部操作：取消或保存规则 -->
          <footer
            class="flex min-h-[8cqh] items-center justify-end gap-[0.8em] bg-slate-200 px-[1.7em] py-[1cqh]"
          >
            <p class="mr-auto text-muted text-[0.72em]">{{ strings.room.rulesChangeNote }}</p>
            <button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
              type="button"
              @click="showSettings = false"
            >
              {{ strings.common.cancel }}</button
            ><button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
              type="button"
              @click="saveSettings"
            >
              {{ strings.room.saveRules }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>

    <!-- 弹窗三：邀请在线玩家（房主或允许邀请的成员） -->
    <Transition name="modal">
      <div
        v-if="showInvite"
        class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
      >
        <section
          class="game-dialog flex max-h-[86cqh] flex-col overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper text-ink shadow-[0_1.4cqh_4cqh_#0007] w-[52cqw]"
        >
          <header
            class="flex min-h-[9cqh] items-center justify-between bg-navy px-[1.7em] py-[1.3cqh] text-white"
          >
            <div>
              <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
                {{ strings.room.inviteLabel }}
              </p>
              <h2 id="invite-title">{{ strings.room.inviteTitle }}</h2>
            </div>
            <button
              type="button"
              class="grid h-[4cqh] w-[4cqh] place-items-center rounded-full bg-white/10 text-white text-[1.2em]"
              :aria-label="strings.room.inviteCloseAria"
              @click="showInvite = false"
            >
              <X />
            </button>
          </header>
          <!-- 可邀请玩家按钮列表：点击即发送邀请 -->
          <div class="min-h-[40cqh] py-[2cqh] px-[2em]">
            <div class="flex flex-col gap-[0.7cqh]">
              <button
                v-for="player in availablePlayers"
                :key="player.id"
                type="button"
                class="flex items-center gap-[0.7em] py-[0.65cqh] px-[0.7em] text-left text-ink bg-white border-solid border-[0.16cqh] border-line rounded-[0.6em]"
                @click="store.invite(player.id)"
              >
                <AvatarImage
                  class="h-[4.7cqh] w-[4.7cqh]"
                  :avatar-id="player.avatarId"
                  :label="strings.common.playerAvatarAria(player.nickname)"
                />
                <b class="flex-1">{{ player.nickname }}</b
                ><Send />
              </button>
              <p v-if="!availablePlayers.length">{{ strings.room.inviteEmpty }}</p>
            </div>
          </div>
        </section>
      </div>
    </Transition>

    <!-- 弹窗四：退出房间确认 -->
    <Transition name="modal">
      <div
        v-if="showLeaveConfirm"
        class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-title"
      >
        <section
          class="game-dialog flex max-h-[86cqh] flex-col overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper text-ink shadow-[0_1.4cqh_4cqh_#0007] w-[40cqw] items-center gap-[1.4cqh] pt-[3cqh] text-center"
        >
          <LogOut class="h-[7cqh] w-[7cqh] rounded-full bg-red-100 p-[1.4cqh] text-[#991b1b]" />
          <h2 id="leave-title">{{ strings.room.leaveTitle }}</h2>
          <p class="max-w-[30em] text-muted leading-[1.6]">{{ strings.room.leaveBody }}</p>
          <footer
            class="flex min-h-[8cqh] items-center justify-end gap-[0.8em] bg-slate-200 px-[1.7em] py-[1cqh] w-full mt-[1cqh]"
          >
            <button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
              type="button"
              @click="showLeaveConfirm = false"
            >
              {{ strings.room.stayInRoom }}</button
            ><button
              class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-red"
              type="button"
              @click="store.leaveRoom"
            >
              {{ strings.room.confirmLeave }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </main>
</template>
