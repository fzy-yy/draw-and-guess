<!--
  统一基础单行输入控件（AppInput）：
  封装输入框外壳、边框聚焦反馈、前后置插槽（如搜索图标/清除按钮/计数器），
  使用 Vue 3.4+ defineModel() 驱动双向绑定，彻底消除各视图分散手写的原生 input 样式。
  size 只有两档：compact（默认，表单/短码）与 body（聊天猜词等主输入，字号 ≥ 正文阈值）。
-->
<script setup lang="ts">
import { ref } from 'vue'

const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    id?: string
    type?: string
    placeholder?: string
    disabled?: boolean
    maxlength?: number
    autocomplete?: string
    ariaLabel?: string
    align?: 'left' | 'center' | 'right'
    inputClass?: string
    size?: 'compact' | 'body'
  }>(),
  {
    id: undefined,
    type: 'text',
    placeholder: '',
    disabled: false,
    maxlength: undefined,
    autocomplete: 'off',
    ariaLabel: undefined,
    align: 'left',
    inputClass: '',
    size: 'compact',
  },
)

const emit = defineEmits<{
  enter: [event: KeyboardEvent]
}>()

const inputRef = ref<HTMLInputElement>()

/** 供父组件程序化聚焦（如自动聚焦猜词框）；输入元素本身仍是组件内部实现细节。 */
defineExpose({ focus: () => inputRef.value?.focus() })

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    emit('enter', event)
  }
}
</script>

<template>
  <div
    class="flex items-center gap-[0.5em] rounded-[0.7em] border-[0.18cqh] bg-white px-[0.75em] transition-colors focus-within:border-navy"
    :class="[
      size === 'body' ? 'h-[5.2cqh]' : 'h-[4.8cqh]',
      'border-control',
      disabled ? 'cursor-not-allowed opacity-50 bg-line/40' : '',
    ]"
  >
    <div v-if="$slots.prefix" class="flex shrink-0 items-center text-muted">
      <slot name="prefix" />
    </div>

    <input
      :id="id"
      ref="inputRef"
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :aria-label="ariaLabel"
      class="w-full min-w-0 border-0 bg-transparent text-navy outline-none placeholder:text-muted disabled:cursor-not-allowed"
      :class="[
        size === 'body' ? 'text-fs-16' : 'text-fs-14',
        align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left',
        inputClass,
      ]"
      @keydown="handleKeyDown"
    />

    <div v-if="$slots.suffix" class="flex shrink-0 items-center text-muted">
      <slot name="suffix" />
    </div>
  </div>
</template>
