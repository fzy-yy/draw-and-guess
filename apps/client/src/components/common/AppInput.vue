<!--
  统一基础单行输入控件（AppInput）：
  封装输入框外壳、边框聚焦反馈、前后置插槽（如搜索图标/清除按钮/计数器），
  使用 Vue 3.4+ defineModel() 驱动双向绑定，彻底消除各视图分散手写的原生 input 样式。
-->
<script setup lang="ts">
const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    id?: string
    type?: string
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    maxlength?: number
    autocomplete?: string
    ariaLabel?: string
    align?: 'left' | 'center' | 'right'
    inputClass?: string
    error?: boolean
  }>(),
  {
    id: undefined,
    type: 'text',
    placeholder: '',
    disabled: false,
    readonly: false,
    maxlength: undefined,
    autocomplete: 'off',
    ariaLabel: undefined,
    align: 'left',
    inputClass: '',
    error: false,
  },
)

const emit = defineEmits<{
  enter: [event: KeyboardEvent]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    emit('enter', event)
  }
}
</script>

<template>
  <div
    class="flex h-[4.8cqh] items-center gap-[0.5em] rounded-[0.7em] border-[0.18cqh] bg-white px-[0.75em] transition-colors focus-within:border-navy"
    :class="[
      error ? 'border-red' : 'border-control',
      disabled ? 'cursor-not-allowed opacity-50 bg-line/40' : '',
    ]"
  >
    <div v-if="$slots.prefix" class="flex shrink-0 items-center text-muted">
      <slot name="prefix" />
    </div>

    <input
      :id="id"
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :aria-label="ariaLabel"
      class="w-full min-w-0 border-0 bg-transparent text-navy outline-none placeholder:text-muted text-fs-14 disabled:cursor-not-allowed"
      :class="[
        align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left',
        inputClass,
      ]"
      @keydown="handleKeyDown"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
    />

    <div v-if="$slots.suffix" class="flex shrink-0 items-center text-muted">
      <slot name="suffix" />
    </div>
  </div>
</template>
