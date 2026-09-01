<!--
  席位网格（3×2）：展示房间内全部玩家座位、准备状态与空位邀请提示。
  数据来自 store 的房间快照（members/settings），房主可对非自己的成员执行踢人。
  原 RoomView.vue 的席位区（header + 网格）整体迁入本组件；只保留渲染逻辑，不裁决游戏。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Crown, UserPlus, Users, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()

// 席位展示：按最大人数生成槽位，空位填空（undefined）
const slots = computed(() =>
  Array.from(
    { length: store.room?.settings.maxPlayers ?? 6 },
    (_, index) => store.room?.members[index],
  ),
)
</script>

<template>
  <!-- 席位区：固定网格展示全部玩家座位与准备状态 -->
  <section v-if="store.room" class="min-w-0 py-[3cqh] px-[2.5cqw] border-r-[0.2cqh] border-r-line">
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
          strings.room.seatCount(
            store.room?.members.length ?? 0,
            store.room?.settings.maxPlayers ?? 6,
          )
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
</template>
