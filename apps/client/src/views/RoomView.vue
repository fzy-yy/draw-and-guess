<!-- 房间等待界面：固定六个游戏席位、权威准备门槛、房主规则与本局词库管理。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ClipboardCopy, KeyRound, LogOut, Play, ShieldCheck } from 'lucide-vue-next'
import { useClipboard } from '@vueuse/core'
import { clsx } from 'clsx'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import SeatGrid from '@/components/room/SeatGrid.vue'
import RuleSummary from '@/components/room/RuleSummary.vue'
import IconButton from '@/components/common/IconButton.vue'
import NetworkStatusButton from '@/components/common/NetworkStatusButton.vue'
import VocabularyDialog from '@/components/room/VocabularyDialog.vue'
import RulesDialog from '@/components/room/RulesDialog.vue'
import InviteDialog from '@/components/room/InviteDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import type { RoomSettings } from '@draw-guess/shared'

const store = useGameStore()
// ---- 弹窗开关状态 ----
const showVocabulary = ref(false) // 词库管理弹窗（内容与加载逻辑在 VocabularyDialog）
const showSettings = ref(false) // 规则编辑弹窗（草稿在 settingsDraft，编辑在 RulesDialog）
const showInvite = ref(false) // 邀请弹窗（可用玩家计算与发送在 InviteDialog）
const showLeaveConfirm = ref(false) // 退出确认弹窗
const settingsDraft = ref<RoomSettings>() // 规则编辑草稿（保存前可取消）
const vocabularyLoading = ref(false) // 词库拉取中（RuleSummary 禁用按钮 + VocabularyDialog v-model）

// 开局/全员就绪判定：服务端快照已把房主裁剪为「隐式已准备」（见 snapshot.ts 的 ready 字段），
// 因此房主与非房主共用同一个条件：≥ minPlayers 名可玩成员在线且全部已准备（下限取共享配置，与服务端开局门槛一致）。
const allSet = computed(() => {
  const active = (store.room?.members ?? []).filter((member) => !member.spectating)
  return Boolean(
    store.room &&
    active.length >= store.config.player.minPlayers &&
    active.every((member) => member.connection === 'online' && member.ready),
  )
})

/** 打开词库弹窗：实际拉取与虚拟网格初始化由 VocabularyDialog 在 open 触发时完成。 */
function openVocabulary(): void {
  showVocabulary.value = true
}

// 剪切板写入交给 @vueuse/core 的 useClipboard 统一处理：优先原生 API，失败后自动走 execCommand 降级（legacy）。
const { copy: copyToClipboard } = useClipboard({ legacy: true })

/**
 * 复制私密房间码。
 * useClipboard 内置 execCommand 降级（legacy），无需再手写 textarea 分支；
 * 其 copy 在完成写入后标记成功，能力缺失时不产生副作用，据此判断成功与否并提示。
 */
async function copyPrivateCode(): Promise<void> {
  const code = store.room?.privateJoinCode
  if (!code) return
  // 只声明不初始化：成功/失败两条分支都会在读取前赋值，初始值永远不会被读取，避免 no-useless-assignment。
  let copied: boolean
  try {
    await copyToClipboard(code)
    copied = true
  } catch {
    copied = false
  }
  store.notify(
    copied ? strings.room.privateCodeCopied : strings.room.privateCodeCopyFailed,
    copied ? 'success' : 'warning',
  )
}

/** 打开规则弹窗：以当前房间规则初始化草稿。 */
function openSettings(): void {
  if (!store.room) return
  settingsDraft.value = { ...store.room.settings }
  showSettings.value = true
}

/** 保存规则：以 RulesDialog 回传的草稿更新房间规则；失败（版本冲突等已 Toast）时保留弹窗供重试。 */
async function saveSettings(draft: RoomSettings): Promise<void> {
  if (!settingsDraft.value) return
  settingsDraft.value = draft
  const ok = await store.updateRoomSettings(settingsDraft.value)
  if (ok) showSettings.value = false
}
</script>

<template>
  <!-- 房间等待界面骨架：左侧席位区 + 右侧控制区，顶栏含房间名与退出 -->
  <main
    v-if="store.room"
    class="grid h-full grid-cols-[minmax(0,67%)_33%] grid-rows-[11%_89%] bg-sky"
  >
    <!-- 顶栏：房间名、房间可见性标识、连接状态与退出按钮 -->
    <header
      class="col-span-full grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.5cqh] border-yellow bg-navy px-[2cqw] text-white"
    >
      <div class="flex items-baseline gap-[0.8em] min-w-0">
        <span class="text-sky text-[0.65em] tracking-[0.15em]">{{ strings.room.roomEyebrow }}</span>
        <h1 class="overflow-hidden text-ellipsis whitespace-nowrap text-[1.35em]">
          {{ store.room.name }}
        </h1>
      </div>
      <div
        class="flex items-center justify-self-center gap-[0.6em] text-yellow text-[0.72em] font-black"
        :class="clsx(store.room.visibility === 'private' && 'text-red!')"
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
        <!-- 网络状态：统一复用 NetworkStatusButton 图标按钮展示（与大厅/对局顶栏一致），悬浮查看详情 -->
        <NetworkStatusButton size="lg" />
        <IconButton
          size="lg"
          :label="strings.common.exit"
          :title="strings.common.exit"
          @click="showLeaveConfirm = true"
        >
          <LogOut class="h-[2.6cqh] w-[2.6cqh]" />
        </IconButton>
      </div>
    </header>

    <!-- 席位区：固定网格展示全部玩家座位与准备状态 -->
    <SeatGrid />

    <!-- 右侧控制区：规则摘要、词库管理、邀请、准备与开始 -->
    <aside class="min-w-0 flex flex-col py-[2.5cqh] px-[1.6cqw] bg-paper">
      <RuleSummary
        :vocabulary-loading="vocabularyLoading"
        @open-vocabulary="openVocabulary"
        @open-invite="showInvite = true"
        @edit-rules="openSettings"
      />

      <!-- 房主只显示开始按钮；其他玩家保留准备按钮，观战者不能参与准备。 -->
      <div class="mt-auto pt-[1.3cqh] border-t-[0.2cqh] border-t-line text-center">
        <p v-if="store.me?.spectating" class="min-h-[2.4cqh] text-muted text-[0.69em]">
          {{ strings.room.spectatorReadyHint }}
        </p>
        <p v-else-if="!allSet" class="min-h-[2.4cqh] text-muted text-[0.69em]">
          {{
            (store.room.members || []).filter((member) => !member.spectating).length <
            store.config.player.minPlayers
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
        <!-- 准备按钮：复用 AppButton secondary（白底描边），已准备时经外部类切换为绿色高亮。 -->
        <AppButton
          v-if="!store.isHost && !store.me?.spectating"
          variant="secondary"
          type="button"
          class="w-full my-[0.8cqh]"
          :class="clsx(store.me?.ready && 'text-green! bg-green/10! border-green!')"
          @click="store.setReady(!store.me?.ready)"
        >
          {{ store.me?.ready ? strings.room.cancelReady : strings.room.readyGo }}
        </AppButton>
        <AppButton
          v-else-if="!store.isHost"
          variant="secondary"
          type="button"
          class="w-full my-[0.8cqh]"
          disabled
          :title="strings.room.spectatorReadyTitle"
        >
          {{ strings.room.spectatorReadyButton }}
        </AppButton>
        <AppButton
          v-if="store.isHost"
          variant="primary"
          type="button"
          class="w-full"
          :disabled="!allSet"
          @click="store.startGame"
        >
          <Play /> {{ strings.room.startGame }}
        </AppButton>
      </div>
    </aside>

    <!--
      弹窗一：本局词库管理（房主）——搜索、批量选择、确认保存。
      注意：不要在外层再包 <Transition>：BaseDialog 内部已自带同名的 modal 过渡，
      双重过渡会嵌套作用在同一个遮罩元素上，导致关闭流程卡死、弹窗变成僵尸 DOM
      （表现为弹窗内所有按钮“点击没反应”，100% 复现）。出入场动画统一由 BaseDialog 负责。
    -->
    <VocabularyDialog
      v-if="showVocabulary"
      v-model:loading="vocabularyLoading"
      :open="showVocabulary"
      @close="showVocabulary = false"
    />

    <!-- 弹窗二：房间规则编辑（房主）——滑块与开关修改规则（动画由 BaseDialog 内部负责） -->
    <RulesDialog
      v-if="showSettings"
      :open="showSettings"
      :draft="settingsDraft"
      @close="showSettings = false"
      @save="saveSettings"
    />

    <!-- 弹窗三：邀请在线玩家（房主或允许邀请的成员） -->
    <InviteDialog v-if="showInvite" :open="showInvite" @close="showInvite = false" />

    <!-- 弹窗四：退出房间确认（复用通用 ConfirmDialog：图标 + 标题 + 正文 + 取消/确认） -->
    <ConfirmDialog
      :open="showLeaveConfirm"
      :title="strings.room.leaveTitle"
      :body="strings.room.leaveBody"
      :confirm-label="strings.room.confirmLeave"
      :cancel-label="strings.room.stayInRoom"
      :icon="LogOut"
      @cancel="showLeaveConfirm = false"
      @confirm="store.leaveRoom"
    />
  </main>
</template>
