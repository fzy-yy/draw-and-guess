<!--
  统一动作按钮：primary（蓝）/ secondary（白底描边）/ danger（红）。
  收敛原本分散在各视图的 `.primary-action/.secondary-action/.danger-action` 长串行内类。
  额外的布局类（如 w-full、mt-*）由调用处通过 class 传入，会自动与内置类合并。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 按钮语义变体 */
    variant?: 'primary' | 'secondary' | 'danger'
    /** 原生 type，默认 button */
    type?: 'button' | 'submit' | 'reset'
    /** 禁用态 */
    disabled?: boolean
  }>(),
  { variant: 'primary', type: 'button', disabled: false },
)

// 三色动作按钮共用底座 + 各自颜色/描边；按钮统一不使用阴影。
const variantClasses = computed(() => {
  const base =
    'inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black'
  switch (props.variant) {
    case 'secondary':
      return `${base} text-navy bg-white !border !border-[0.18cqh] !border-line`
    case 'danger':
      return `${base} text-white bg-red`
    default:
      return `${base} text-white bg-blue`
  }
})

// 用 cn() 合并内置变体类与调用处透传进来的外部类（来自 $attrs，见下方 v-bind）：
// tailwind-merge 会消解外部类与内置类之间的冲突（如调用处传 bg-white 覆盖内置 bg-blue），
// 保证最终类名干净、无互相覆盖的残留。
const buttonClass = computed(() => cn(variantClasses.value, useAttrs()))
</script>

<template>
  <!-- v-bind="$attrs" 让调用处的 class / 原生事件 / aria 透传到按钮，并由 cn() 合并内置类与外部类 -->
  <button :type="type" :disabled="disabled" :class="buttonClass">
    <slot />
  </button>
</template>
