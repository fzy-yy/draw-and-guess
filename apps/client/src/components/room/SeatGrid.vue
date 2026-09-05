<!--
  席位网格（3×2）：展示房间内全部玩家座位、准备状态与空位邀请提示。
  数据来自 store 的房间快照（members/settings），房主可对非自己的成员执行踢人（带确认弹窗）。
  原 RoomView.vue 的席位区（header + 网格）整体迁入本组件；只保留渲染逻辑，不裁决游戏。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { UserPlus, Users, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/common/AvatarImage.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import HostCrownBadge from '@/components/common/HostCrownBadge.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()

// 席位展示：按最大人数生成槽位，空位填空（undefined）
const slots = computed(() =>
  Array.from(
    { length: store.room?.settings.maxPlayers ?? store.config.player.defaultMaxPlayers },
    (_, index) => store.room?.members.find((member) => member.seatIndex === index),
  ),
)

// 待确认踢出的成员：置位后弹出确认框，确认后调用 store.kick（踢人是广播全员的破坏性操作）。
const kickTarget = computed(() =>
  store.room?.members.find((member) => member.id === pendingKickId.value),
)
const pendingKickId = ref<string>()
</script>

<template>
  <!-- 席位区：固定网格展示全部玩家座位与准备状态 -->
  <section v-if="store.room" class="min-w-0 py-[3cqh] px-[2.5cqw] border-r-[0.2cqh] border-r-line">
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
    <div class="grid h-[67cqh] grid-cols-3 grid-rows-2 gap-[2cqh_1.5cqw] mt-[2.5cqh]">
      <article
        v-for="(member, index) in slots"
        :key="member?.id ?? index"
        class="relative flex min-w-0 flex-col items-center justify-center rounded-[1em] border-[0.24cqh] border-line border-b-[0.6cqh] bg-white border-b-line ui-feedback hover-tint"
        :class="[
          !member ? 'border-dashed bg-paper! text-muted!' : '',
          member?.ready && member.id !== store.playerId ? 'border-green! border-b-green!' : '',
          member?.id === store.playerId ? 'border-blue! border-b-blue!' : '',
        ]"
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
            class="min-w-[7em] flex items-center justify-center gap-[0.35em] mt-[0.7cqh] py-[0.4cqh] px-[0.8em] text-muted bg-line rounded-[99em] text-fs-12 font-bold"
            :class="member.ready ? 'text-green! bg-green/10!' : ''"
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
          <!-- 房主移除玩家按钮：只对非自己的成员显示；先弹确认再执行（破坏性操作） -->
          <button
            v-if="store.isHost && member.id !== store.playerId"
            class="absolute right-[0.6cqh] top-[0.6cqh] grid place-items-center h-[3cqh] w-[3cqh] text-red bg-red/10 rounded-full"
            type="button"
            :aria-label="strings.room.kickAria"
            @click="pendingKickId = member.id"
          >
            <X />
          </button>
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
  </section>
</template>
