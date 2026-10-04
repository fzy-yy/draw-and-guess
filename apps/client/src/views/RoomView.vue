<!-- 房间等待界面：固定六个游戏席位、权威准备门槛、房主规则与本局词库管理。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ClipboardCopy, KeyRound, LogOut, Play, ShieldCheck } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { useCopyWithFeedback } from '@/composables/useCopyWithFeedback'
import {
  AppButton,
  ConfirmDialog,
  NetworkStatusButton,
  StageHeader,
  StageHeaderButton,
} from '@/components/common'
import {
  InviteDialog,
  RuleSummary,
  RulesDialog,
  SeatGrid,
  VocabularyDialog,
} from '@/components/room'
import { activeMembers, isOnlineActiveMember } from '@/utils/room-facts'
import type { RoomSettings } from '@draw-guess/shared'

const store = useGameStore()
// ---- 弹窗开关状态 ----
const showVocabulary = ref(false) // 词库管理弹窗（内容与加载逻辑在 VocabularyDialog）
const showSettings = ref(false) // 规则编辑弹窗（草稿在 settingsDraft，编辑在 RulesDialog）
const showInvite = ref(false) // 邀请弹窗（可用玩家计算与发送在 InviteDialog）
const showLeaveConfirm = ref(false) // 退出确认弹窗
const settingsDraft = ref<RoomSettings>() // 规则编辑草稿：打开弹窗时以当前规则初始化，作为 RulesDialog 本地副本的种子（保存直接用回传的 draft）
const vocabularyLoading = ref(false) // 词库拉取中（RuleSummary 禁用按钮 + VocabularyDialog v-model）

// 可玩成员集合（未离局，口径见 utils/room-facts）：allSet 与下方提示文案共用。
const activePlayers = computed(() => activeMembers(store.room?.members ?? []))

// 开局/全员就绪判定：服务端快照已把房主裁剪为「隐式已准备」（见 snapshot.ts 的 ready 字段），
// 因此房主与非房主共用同一个条件：≥ minPlayers 名可玩成员在线且全部已准备（下限取共享配置，与服务端开局门槛一致）。
const allSet = computed(() =>
  Boolean(
    store.room &&
    activePlayers.value.length >= store.config.player.minPlayers &&
    activePlayers.value.every((member) => isOnlineActiveMember(member) && member.ready),
  ),
)

/** 打开词库弹窗：实际拉取与虚拟网格初始化由 VocabularyDialog 在 open 触发时完成。 */
function openVocabulary(): void {
  showVocabulary.value = true
}

// 复制私密房间码：useCopyWithFeedback 统一处理剪贴板（原生 API + execCommand 降级）
// 与成功/失败提示；模板 v-if 已保证按钮只在有短码时渲染（服务端仅向当前房主下发该字段）。
const copyPrivateCode = useCopyWithFeedback({
  text: () => store.room?.privateJoinCode ?? '',
  success: strings.ui.room.privateCodeCopied,
  failure: strings.ui.room.privateCodeCopyFailed,
  notify: (text, type) => store.notify(text, type),
})

/** 复制私密房间码：模板 v-if 已挡无短码场景，无需再设运行时守卫。 */
function handleCopyPrivateCode(): void {
  playInteractionSound('activate')
  void copyPrivateCode()
}

/** 打开规则弹窗：以当前房间规则初始化草稿。 */
function openSettings(): void {
  if (!store.room) return
  settingsDraft.value = { ...store.room.settings }
  showSettings.value = true
}

/** 保存规则：以 RulesDialog 回传的草稿更新房间规则；失败（版本冲突等已 Toast）时保留弹窗供重试。 */
async function saveSettings(draft: RoomSettings): Promise<void> {
  const ok = await store.updateRoomSettings(draft)
  if (ok) showSettings.value = false
}
</script>

<template>
  <!-- 房间等待界面骨架：左侧席位区 + 右侧控制区，顶栏含房间名与退出 -->
  <!-- relative：BaseDialog 的遮罩是 absolute inset-0，需要最近的定位祖先（本视图的弹窗与浮层都挂在这里） -->
  <main
    v-if="store.room"
    class="relative grid h-full grid-cols-[minmax(0,67%)_33%] grid-rows-[11%_89%] bg-sky"
  >
    <!-- 顶栏：房间名、房间可见性标识、连接状态与退出按钮（共享 StageHeader 骨架） -->
    <StageHeader>
      <template #leading>
        <div class="flex items-baseline gap-[0.8em] min-w-0">
          <span class="text-sky text-fs-12 tracking-[0.15em]">{{
            strings.ui.room.roomEyebrow
          }}</span>
          <h1 class="overflow-hidden text-ellipsis whitespace-nowrap text-fs-20">
            {{ store.room.name }}
          </h1>
        </div>
      </template>
      <template #center>
        <div
          class="flex items-center justify-self-center gap-[0.6em] text-fs-18 font-bold leading-none"
          :class="store.room.visibility === 'private' ? 'text-danger-on-dark' : 'text-yellow'"
        >
          <KeyRound
            v-if="store.room.visibility === 'private'"
            class="h-[4.2cqh] w-[4.2cqh] shrink-0"
          />
          <ShieldCheck v-else class="h-[4.2cqh] w-[4.2cqh] shrink-0" />
          <span>{{
            store.room.visibility === 'private'
              ? strings.ui.room.privateRoomBadge
              : strings.ui.room.publicRoomBadge
          }}</span>
          <button
            v-if="store.room.privateJoinCode"
            type="button"
            class="flex items-center gap-[0.4em] rounded-[0.55em] bg-yellow px-[0.75em] py-[0.55cqh] tracking-[0.16em] text-navy"
            :aria-label="strings.a11y.room.copyPrivateCodeAria"
            @click="handleCopyPrivateCode"
          >
            <b>{{ store.room.privateJoinCode }}</b>
            <ClipboardCopy class="h-[2.2cqh] w-[2.2cqh] shrink-0" />
          </button>
        </div>
      </template>
      <template #trailing>
        <!-- 网络状态：统一复用 NetworkStatusButton 图标按钮展示（与大厅/对局顶栏一致），悬浮查看详情 -->
        <NetworkStatusButton
          size="lg"
          :connected="store.connected"
          :latency="store.latency"
          :connection-label="store.connectionLabel"
          :latency-good-ms="store.config.network.latencyGoodMs"
        />
        <!-- 退出按钮：统一复用 StageHeaderButton，带图标与可见文字「退出」，与大厅/设置页顶栏一致 -->
        <StageHeaderButton
          :title="strings.a11y.common.exit"
          :aria-label="strings.a11y.common.exit"
          :audio-feedback="null"
          @click="showLeaveConfirm = true"
        >
          <LogOut />
          <span>{{ strings.ui.room.exit }}</span>
        </StageHeaderButton>
      </template>
    </StageHeader>

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

      <!-- 房主只显示开始按钮；其他玩家保留准备按钮。 -->
      <div class="mt-auto pt-[1.3cqh] border-t-[0.2cqh] border-t-line text-center">
        <!-- 准备按钮：复用 AppButton secondary（白底描边），已准备时经外部类切换为绿色高亮。 -->
        <AppButton
          v-if="!store.isHost"
          variant="secondary"
          type="button"
          class="w-full"
          :class="{ 'text-success-fg bg-green/10 border-green': store.me?.ready }"
          :audio-feedback="store.me?.ready ? 'activate' : null"
          @click="store.setReady(!store.me?.ready)"
        >
          {{ store.me?.ready ? strings.ui.room.cancelReady : strings.ui.room.readyGo }}
        </AppButton>
        <AppButton
          v-if="store.isHost"
          variant="primary"
          type="button"
          class="w-full"
          :disabled="!allSet"
          :audio-feedback="null"
          @click="store.startGame"
        >
          <Play class="h-[2.4cqh] w-[2.4cqh] shrink-0 fill-current" />
          <span>{{ strings.ui.room.startGame }}</span>
        </AppButton>
      </div>
    </aside>

    <!--
      弹窗一：本局词库管理（房主）——搜索、批量选择、确认保存。
      只由 v-model:open 控制显隐。
    -->
    <VocabularyDialog v-model:open="showVocabulary" v-model:loading="vocabularyLoading" />

    <!-- 弹窗二：房间规则编辑（房主）——滑块与开关修改规则（动画由 BaseDialog 内部负责） -->
    <RulesDialog
      v-model:open="showSettings"
      :draft="settingsDraft"
      :read-only="!store.isHost"
      @save="saveSettings"
    />

    <!-- 弹窗三：邀请在线玩家（房主或允许邀请的成员） -->
    <InviteDialog v-model:open="showInvite" />

    <!-- 弹窗四：退出房间确认（复用通用 ConfirmDialog：图标 + 标题 + 正文 + 取消/确认） -->
    <ConfirmDialog
      v-model:open="showLeaveConfirm"
      :title="strings.ui.room.leaveTitle"
      :body="strings.ui.room.leaveBody"
      :confirm-label="strings.ui.room.confirmLeave"
      :cancel-label="strings.ui.room.stayInRoom"
      :icon="LogOut"
      @confirm="store.leaveRoom"
    />
  </main>
</template>
