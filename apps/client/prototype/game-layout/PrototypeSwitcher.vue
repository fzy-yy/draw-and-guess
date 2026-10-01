<!--
  原型底部切换条（原型工具，不属于被评估的设计本身）：
  ← / → 循环切换布局变体（写入 ?variant=，可分享、刷新稳定），并切换「猜词者 / 画家」视角。
  键盘 ←/→ 同样生效（输入框聚焦时不拦截，见 PrototypeApp）。
-->
<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { labels } from './labels.ts'
import type { PrototypeRole } from './prototype-store.ts'
import type { PrototypeVariantKey } from './prototype-context.ts'

defineProps<{ variant: PrototypeVariantKey; role: PrototypeRole }>()
const emit = defineEmits<{
  prev: []
  next: []
  'update:role': [role: PrototypeRole]
}>()
</script>

<template>
  <div
    class="fixed bottom-[1.6vh] left-1/2 z-[999] flex -translate-x-1/2 items-center gap-[0.7em] rounded-full border border-white/25 bg-navy px-[1em] py-[0.55em] text-white shadow-float"
  >
    <button
      type="button"
      class="grid h-[2.2em] w-[2.2em] place-items-center rounded-full bg-white/10 hover:bg-blue"
      :aria-label="labels.prevVariant"
      :title="labels.prevVariant"
      @click="emit('prev')"
    >
      <ChevronLeft />
    </button>
    <span class="flex items-baseline gap-[0.5em]">
      <b class="text-fs-16">{{ variant }}</b>
      <span class="text-fs-14 text-sky">{{ labels.variants[variant] }}</span>
    </span>
    <button
      type="button"
      class="grid h-[2.2em] w-[2.2em] place-items-center rounded-full bg-white/10 hover:bg-blue"
      :aria-label="labels.nextVariant"
      :title="labels.nextVariant"
      @click="emit('next')"
    >
      <ChevronRight />
    </button>

    <span class="mx-[0.3em] h-[1.6em] w-px bg-white/25" aria-hidden="true"></span>

    <span class="text-fs-14 text-sky">{{ labels.roleLabel }}</span>
    <span class="flex items-center gap-[0.3em]">
      <button
        type="button"
        class="rounded-full px-[0.8em] py-[0.3em] text-fs-14 font-bold"
        :class="role === 'guesser' ? 'bg-blue text-white' : 'bg-white/10 hover:bg-white/20'"
        @click="emit('update:role', 'guesser')"
      >
        {{ labels.roleGuesser }}
      </button>
      <button
        type="button"
        class="rounded-full px-[0.8em] py-[0.3em] text-fs-14 font-bold"
        :class="role === 'drawer' ? 'bg-blue text-white' : 'bg-white/10 hover:bg-white/20'"
        @click="emit('update:role', 'drawer')"
      >
        {{ labels.roleDrawer }}
      </button>
    </span>

    <span class="mx-[0.3em] h-[1.6em] w-px bg-white/25" aria-hidden="true"></span>

    <span class="text-fs-12 text-sky/80">{{ labels.switcherNote }}</span>
  </div>
</template>
