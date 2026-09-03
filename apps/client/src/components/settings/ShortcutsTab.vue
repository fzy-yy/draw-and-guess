<!--
  快捷键设置页：展示三个工具各自的捕获输入框。
  快捷键数据（rows）与捕获逻辑（capture）由父层 SettingsView 持有并下发，
  本组件只负责渲染卡片并把按键事件上抛，保证“脚本逻辑不删除、只做模板拆分”。
-->
<script setup lang="ts">
import type { Component } from 'vue'
import { Keyboard } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'

// 快捷键设置键类型（与父组件一致的字符串字面量联合，便于按类型索引 store.settings）
type ShortcutSettingKey = 'penShortcut' | 'eraserShortcut' | 'fillShortcut'

interface ShortcutRow {
  setting: ShortcutSettingKey
  name: string
  detail: string
  icon: Component
}

// 行数据与错误提示由父层传入；本组件为纯展示 + 事件上抛。
defineProps<{
  rows: ShortcutRow[]
  error: string
}>()
const emit = defineEmits<{
  capture: [setting: ShortcutSettingKey, event: KeyboardEvent]
}>()

const store = useGameStore()
</script>

<template>
  <section class="min-h-0 px-[9cqw] py-[3cqh]">
    <div class="flex items-center gap-[1.2em] mb-[2.5cqh]">
      <Keyboard class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
      <div>
        <h2>{{ strings.settings.shortcutsTitle }}</h2>
        <p class="mt-[0.5cqh] text-muted text-[0.72em]">{{ strings.settings.shortcutsIntro }}</p>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-[1em]">
      <label
        v-for="row in rows"
        :key="row.setting"
        class="grid min-h-[12cqh] grid-cols-[auto_1fr_auto] items-center gap-[0.8em] rounded-[0.8em] border-[0.18cqh] border-line bg-white p-[1.2em]"
      >
        <component :is="row.icon" class="w-[3.6cqh] text-blue" />
        <span class="flex flex-col gap-[0.25em]"
          ><b>{{ row.name }}</b
          ><small class="text-muted text-[0.68em]">{{ row.detail }}</small></span
        >
        <input
          :value="store.settings[row.setting]"
          type="text"
          readonly
          class="h-[3.2em] w-[3.2em] rounded-[0.55em] bg-blue text-center text-white uppercase font-mono font-black leading-none cursor-pointer focus:outline-[0.3cqh] focus:outline-yellow focus:outline-offset-[0.2cqh]"
          :aria-label="strings.settings.setShortcutAria(row.name)"
          @keydown.prevent="emit('capture', row.setting, $event)"
        />
      </label>
    </div>
    <p v-if="error" class="mt-[1.2cqh] text-red font-extrabold" role="alert">
      {{ error }}
    </p>
    <p class="mt-[1.2cqh] text-muted text-[0.68em]">{{ strings.settings.shortcutNote }}</p>
  </section>
</template>
