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
import VocabularyDialog from '@/components/room/VocabularyDialog.vue'
import RulesDialog from '@/components/room/RulesDialog.vue'
import InviteDialog from '@/components/room/InviteDialog.vue'
import AppButton from '@/components/AppButton.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import type { RoomSettings } from '@draw-guess/shared'

const store = useGameStore()
// ---- 弹窗开关状态 ----
const showVocabulary = ref(false) // 词库管理弹窗（内容与加载逻辑在 VocabularyDialog）
const showSettings = ref(false) // 规则编辑弹窗（草稿在 settingsDraft，编辑在 RulesDialog）
const showInvite = ref(false) // 邀请弹窗（可用玩家计算与发送在 InviteDialog）
const showLeaveConfirm = ref(false) // 退出确认弹窗
const settingsDraft = ref<RoomSettings>() // 规则编辑草稿（保存前可取消）
const vocabularyLoading = ref(false) // 词库拉取中（RuleSummary 禁用按钮 + VocabularyDialog v-model）

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
  let copied = false
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

/** 保存规则：以 RulesDialog 回传的草稿更新房间规则并关闭弹窗。 */
async function saveSettings(draft: RoomSettings): Promise<void> {
  if (!settingsDraft.value) return
  settingsDraft.value = draft
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
        :class="clsx(store.room.visibility === 'private' && '!text-[#fbcfe8]')"
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
    <SeatGrid />

    <!-- 右侧控制区：规则摘要、词库管理、邀请、准备与开始 -->
    <aside class="min-w-0 flex flex-col py-[2.5cqh] px-[1.6cqw] bg-slate-50">
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
          :class="clsx(store.me?.ready && '!text-[#14532d] !bg-[#dcfce7] !border-green')"
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
        <AppButton
          v-if="store.isHost"
          variant="primary"
          type="button"
          class="w-full"
          :disabled="!canHostStart"
          @click="store.startGame"
        >
          <Play /> {{ strings.room.startGame }}
        </AppButton>
      </div>
    </aside>

    <!-- 弹窗一：本局词库管理（房主）——搜索、批量选择、确认保存 -->
    <Transition name="modal">
      <VocabularyDialog
        v-if="showVocabulary"
        v-model:loading="vocabularyLoading"
        :open="showVocabulary"
        @close="showVocabulary = false"
      />
    </Transition>

    <!-- 弹窗二：房间规则编辑（房主）——滑块与开关修改规则 -->
    <Transition name="modal">
      <RulesDialog
        v-if="showSettings"
        :open="showSettings"
        :draft="settingsDraft"
        @close="showSettings = false"
        @save="saveSettings"
      />
    </Transition>

    <!-- 弹窗三：邀请在线玩家（房主或允许邀请的成员） -->
    <Transition name="modal">
      <InviteDialog v-if="showInvite" :open="showInvite" @close="showInvite = false" />
    </Transition>

    <!-- 弹窗四：退出房间确认（保留在父组件，用 BaseDialog + AppButton 直接实现） -->
    <Transition name="modal">
      <BaseDialog
        v-if="showLeaveConfirm"
        :open="showLeaveConfirm"
        width-class="w-[40cqw]"
        section-class="items-center gap-[1.4cqh] pt-[3cqh] text-center"
        footer-class="w-full mt-[1cqh]"
        labelledby="leave-title"
        @close="showLeaveConfirm = false"
      >
        <LogOut class="h-[7cqh] w-[7cqh] rounded-full bg-red-100 p-[1.4cqh] text-[#991b1b]" />
        <h2 id="leave-title">{{ strings.room.leaveTitle }}</h2>
        <p class="max-w-[30em] text-muted leading-[1.6]">{{ strings.room.leaveBody }}</p>
        <template #footer>
          <AppButton variant="secondary" type="button" @click="showLeaveConfirm = false">
            {{ strings.room.stayInRoom }}
          </AppButton>
          <AppButton variant="danger" type="button" @click="store.leaveRoom">
            {{ strings.room.confirmLeave }}
          </AppButton>
        </template>
      </BaseDialog>
    </Transition>
  </main>
</template>
