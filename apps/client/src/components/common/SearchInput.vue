<!--
  统一搜索输入控件（SearchInput）：
  基于 AppInput 封装前置搜索图标、后置清除按钮，使用 defineModel() 支持双向绑定。
-->
<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import AppInput from '@/components/common/AppInput.vue'

const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    placeholder?: string
    ariaLabel?: string
    disabled?: boolean
  }>(),
  {
    placeholder: '',
    ariaLabel: undefined,
    disabled: false,
  },
)

const emit = defineEmits<{
  search: [value: string]
  clear: []
}>()

function clear(): void {
  playInteractionSound('activate')
  model.value = ''
  emit('clear')
}

function handleEnter(): void {
  emit('search', model.value)
}
</script>

<template>
  <AppInput
    v-model="model"
    type="text"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @enter="handleEnter"
  >
    <template #prefix>
      <Search class="h-[3.2cqh] w-[3.2cqh] text-muted" />
    </template>
    <template #suffix>
      <!-- 内联清除按钮：视觉尺寸设 24px 下限（WCAG 2.5.8 目标尺寸），
           不用 .touch-target 外扩——外扩命中区会覆盖左侧文本输入区，点击文字变成清空。 -->
      <button
        v-if="model"
        type="button"
        class="grid h-[max(3.2cqh,24px)] w-[max(3.2cqh,24px)] place-items-center rounded-full text-muted hover:bg-line/60 hover:text-navy transition-colors"
        :aria-label="strings.common.clearSearchAria"
        @click="clear"
      >
        <X class="h-[2.4cqh] w-[2.4cqh]" />
      </button>
    </template>
  </AppInput>
</template>
