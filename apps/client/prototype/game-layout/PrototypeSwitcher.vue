<!--
  原型控制条（原型工具，不属于被评估的设计本身）：
  固定在舞台外的视口底部，只保留「猜词者 / 画家」视角切换——
  视角决定工具栏可用态、题目是否明文与聊天是否可输入，是评估布局的关键开关。
  刻意用深色高对比与游戏界面拉开距离，一眼可辨「不是设计的一部分」。
-->
<script setup lang="ts">
import { labels } from './labels.ts'
import type { PrototypeRole } from './prototype-store.ts'

defineProps<{ role: PrototypeRole }>()
const emit = defineEmits<{ 'update:role': [role: PrototypeRole] }>()

const ROLES: ReadonlyArray<{ key: PrototypeRole; label: string }> = [
  { key: 'guesser', label: labels.roleGuesser },
  { key: 'drawer', label: labels.roleDrawer },
]

/** 分段控件的通用按钮样式。 */
function segmentClass(active: boolean): string {
  return [
    'rounded-full px-[0.9em] py-[0.35em] text-fs-12 font-bold transition-colors',
    active ? 'bg-white text-black' : 'text-white/70 hover:text-white',
  ].join(' ')
}
</script>

<template>
  <div
    class="fixed bottom-[1.6vh] left-1/2 z-[999] flex -translate-x-1/2 items-center gap-[1em] whitespace-nowrap rounded-full border border-white/15 bg-black/85 px-[1.1em] py-[0.6em] text-white shadow-float backdrop-blur"
    :aria-label="labels.controlBar"
  >
    <span class="text-fs-12 font-bold tracking-wide text-white/45">{{ labels.controlBar }}</span>

    <span class="h-[2.6cqh] w-px bg-white/20" />

    <!-- 视角切换 -->
    <div class="flex items-center gap-[0.2em]">
      <span class="mr-[0.3em] text-fs-12 text-white/45">{{ labels.roleLabel }}</span>
      <button
        v-for="item in ROLES"
        :key="item.key"
        type="button"
        :class="segmentClass(role === item.key)"
        @click="emit('update:role', item.key)"
      >
        {{ item.label }}
      </button>
    </div>

    <span class="h-[2.6cqh] w-px bg-white/20" />

    <span class="text-fs-12 text-white/45">{{ labels.switcherNote }}</span>
  </div>
</template>
