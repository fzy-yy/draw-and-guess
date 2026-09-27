<!--
  席位网格（3×2）：展示房间内全部玩家座位、准备状态与空位邀请提示。
  数据来自 store 的房间快照（members/settings）；房主对他人席位右键弹出
  「移交房主 / 移除玩家」菜单（useContextMenu 单例 + ContextMenu 渲染），
  操作仍先经确认弹窗（破坏性操作需确认）。席位角标按钮已移除，菜单是唯一入口。
  原 RoomView.vue 的席位区（header + 网格）整体迁入本组件；只保留渲染逻辑，不裁决游戏。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crown, UserPlus, Users, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'
import AvatarImage from '@/components/common/AvatarImage.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import HostCrownBadge from '@/components/common/HostCrownBadge.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import { useContextMenu } from '@/composables/useContextMenu'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
const contextMenu = useContextMenu()

// 席位展示：解耦界面槽位与底层物理 seatIndex。
// 优先稳定呈现全部已有成员（防止历史跳号或缩容后丢失），并在不足最大人数时用空位补齐。
const slots = computed(() => {
  const members = store.room?.members ?? []
  const max = store.room?.settings.maxPlayers ?? store.config.player.defaultMaxPlayers
  const result: ((typeof members)[number] | undefined)[] = [...members]
  while (result.length < max) {
    result.push(undefined)
  }
  // 超员（历史跳号或缩容后）刻意全部保留展示，补齐只在不足时发生——无需截断。
  return result
})

// 待确认踢出的成员：置位后弹出确认框，确认后调用 store.kick（踢人是广播全员的破坏性操作）。
const kickTarget = computed(() =>
  store.room?.members.find((member) => member.id === pendingKickId.value),
)
const pendingKickId = ref<string>()
const pendingHostId = ref<string>()
const hostTarget = computed(() =>
  store.room?.members.find((member) => member.id === pendingHostId.value),
)

/**
 * 右键玩家席位：仅「房主 + 他人席位」弹出操作菜单（移交房主 / 移除玩家）。
 * 空位、自己的席位或非房主不拦截浏览器默认菜单（无可执行操作）。
 * 菜单项只置位待确认目标，真正的破坏性操作仍经 ConfirmDialog 二次确认后执行。
 */
function openSeatMenu(event: MouseEvent, member: RoomMember): void {
  if (!store.isHost || member.id === store.playerId) return
  contextMenu.open(
    event,
    [
      {
        id: 'transfer-host',
        label: strings.room.transferHostAria,
        icon: Crown,
        action: () => {
          pendingHostId.value = member.id
        },
      },
      {
        id: 'kick',
        label: strings.room.kickAria,
        icon: X,
        danger: true,
        separatorBefore: true,
        action: () => {
          pendingKickId.value = member.id
        },
      },
    ],
    { ariaLabel: strings.room.seatMenuAria },
  )
}
</script>

<template>
  <!-- 席位区：网格展示全部玩家座位与准备状态；席位网格占满剩余高度（低高度时不裁切） -->
  <section
    v-if="store.room"
    class="flex min-h-0 min-w-0 flex-col py-[3cqh] px-[2.5cqw] border-r-[0.2cqh] border-r-line"
  >
    <div>
      <SectionHeader
        :eyebrow="strings.room.playersEyebrow"
        :title="strings.room.playersTitle"
      ></SectionHeader>
      <span class="flex items-center gap-[0.45em] text-muted font-bold"
        ><Users />
        {{
          strings.room.seatCount(
            store.room?.members.length ?? 0,
            store.room?.settings.maxPlayers ?? store.config.player.defaultMaxPlayers,
          )
        }}</span
      >
    </div>
    <!-- 席位网格：已占用的显示玩家信息，空位显示邀请提示；房主可踢人 -->
    <div class="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-[2cqh_1.5cqw] mt-[2.5cqh]">
      <article
        v-for="(member, index) in slots"
        :key="member?.id ?? index"
        class="relative flex min-w-0 flex-col items-center justify-center rounded-[1em] border-[0.24cqh] border-b-[0.6cqh] ui-feedback hover-tint"
        :class="
          !member
            ? 'border-dashed bg-paper text-muted border-line border-b-line'
            : member.id === store.playerId
              ? 'border-blue border-b-blue bg-white text-navy'
              : member.ready
                ? 'border-green border-b-green bg-white text-navy'
                : 'border-line border-b-line bg-white text-navy'
        "
        @contextmenu="member && openSeatMenu($event, member)"
      >
        <template v-if="member">
          <div class="relative h-[10cqh] w-[10cqh]">
            <AvatarImage
              class="h-full w-full"
              :avatar-id="member.avatarId"
              :label="strings.common.playerAvatarAria(member.nickname)"
            />
            <!-- 房主皇冠：淡色圆形衬底保证任何底色上都可见；外扩留出完整圆形不被裁剪 -->
            <HostCrownBadge
              v-if="member.isHost"
              :label="strings.room.hostCrownAria"
              class="absolute right-[-1cqh] top-[-1cqh] h-[3.4cqh] w-[3.4cqh]"
            />
          </div>
          <div class="flex items-center gap-[0.4em] max-w-[90%] mt-[0.7cqh]">
            <b class="overflow-hidden text-ellipsis whitespace-nowrap">{{ member.nickname }}</b
            ><span
              v-if="member.id === store.playerId"
              class="py-[0.1cqh] px-[0.45em] text-white bg-blue rounded-[99em] text-fs-10"
              >{{ strings.room.meTag }}</span
            >
          </div>
          <!-- 准备状态标签：观战 / 已准备 / 重连中 / 未准备 -->
          <span
            v-if="!member.isHost || member.spectating"
            class="min-w-[7em] flex items-center justify-center gap-[0.35em] mt-[0.7cqh] py-[0.4cqh] px-[0.8em] rounded-[99em] text-fs-12 font-bold"
            :class="member.ready ? 'text-success-fg bg-green/10' : 'text-muted bg-line'"
            >{{
              member.waitingForNextGame
                ? strings.status.roleWaitingNextGame
                : member.spectating
                  ? strings.status.roleSpectating
                  : member.ready
                    ? strings.status.roleReady
                    : member.connection === 'reconnecting'
                      ? strings.status.roleReconnecting
                      : strings.status.roleNotReady
            }}</span
          >
        </template>
        <!-- 空席位占位提示 -->
        <template v-else
          ><UserPlus class="h-[5cqh] w-[5cqh]" /><b>{{ strings.room.emptySeatTitle }}</b
          ><span class="text-fs-12">{{ strings.room.emptySeatHint }}</span></template
        >
      </article>
    </div>

    <!-- 踢人确认弹窗：复用通用 ConfirmDialog；目标已离房（成员列表找不到）时自动不渲染。 -->
    <ConfirmDialog
      :open="Boolean(kickTarget)"
      :title="strings.room.kickTitle"
      :body="strings.room.kickBody(kickTarget?.nickname ?? '')"
      :confirm-label="strings.room.kickConfirm"
      :cancel-label="strings.common.cancel"
      :icon="X"
      @cancel="pendingKickId = undefined"
      @confirm="
        () => {
          if (pendingKickId) void store.kick(pendingKickId)
          pendingKickId = undefined
        }
      "
    />
    <ConfirmDialog
      :open="Boolean(hostTarget)"
      :title="strings.room.transferHostTitle"
      :body="strings.room.transferHostBody(hostTarget?.nickname ?? '')"
      :confirm-label="strings.room.transferHostConfirm"
      :cancel-label="strings.common.cancel"
      :icon="Crown"
      @cancel="pendingHostId = undefined"
      @confirm="
        async () => {
          if (pendingHostId) await store.transferHost(pendingHostId)
          pendingHostId = undefined
        }
      "
    />
  </section>
</template>
