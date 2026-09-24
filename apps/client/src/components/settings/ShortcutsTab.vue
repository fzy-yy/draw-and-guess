<!--
  快捷键设置页：展示三个工具各自的捕获输入框。
  快捷键数据（rows）与捕获逻辑（capture）由父层 SettingsView 持有并下发，
  本组件只负责渲染卡片并把按键事件上抛，保证“脚本逻辑不删除、只做模板拆分”。
-->
<script setup lang="ts">
import type { Component } from 'vue'
import { Keyboard } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { ShortcutSettingKey } from '@/utils/keyboard'
import { useGameStore } from '@/stores/game'
import SettingsSectionHeader from '@/components/settings/SettingsSectionHeader.vue'

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
  <section class="min-h-0 px-[5cqw] py-[3cqh]">
    <SettingsSectionHeader
      :icon="Keyboard"
      :title="strings.settings.shortcutsTitle"
      :intro="strings.settings.shortcutsIntro"
    />
    <!-- 三列快捷键卡片：随舞台等比缩放（紧凑模式单列化已随布局模式移除） -->
    <div class="grid grid-cols-3 gap-[1em]">
      <label
        v-for="row in rows"
        :key="row.setting"
        class="grid min-h-[12cqh] grid-cols-[auto_1fr_auto] items-center gap-[0.8em] rounded-[0.8em] border-[0.18cqh] border-control bg-white p-[1.2em]"
      >
        <component :is="row.icon" class="w-[3.6cqh] text-blue" />
        <span class="flex flex-col gap-[0.25em]"
          ><b>{{ row.name }}</b
          ><small class="text-muted text-fs-12">{{ row.detail }}</small></span
        >
        <input
          :value="store.settings[row.setting]"
          type="text"
          readonly
          class="h-[3.2em] w-[3.2em] rounded-[0.55em] bg-blue text-center text-white uppercase font-mono font-bold leading-none cursor-pointer focus:outline-[0.3cqh] focus:outline-focus focus:outline-offset-[0.2cqh]"
          :aria-label="strings.settings.setShortcutAria(row.name)"
          @keydown.prevent="emit('capture', row.setting, $event)"
        />
      </label>
    </div>
    <p v-if="error" class="mt-[1.2cqh] text-red font-bold" role="alert">
      {{ error }}
    </p>
    <p class="mt-[1.2cqh] text-muted text-fs-12">{{ strings.settings.shortcutNote }}</p>
  </section>
</template>
