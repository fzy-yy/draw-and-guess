<!--
  统一动作按钮：primary（蓝）/ secondary（白底描边）/ danger（红）。
  收敛原本分散在各视图的 `.primary-action/.secondary-action/.danger-action` 长串行内类。
  额外的布局类（如 w-full、mt-*）由调用处通过 class 传入，会自动与内置类合并。
-->
<script setup lang="ts">
import { computed } from 'vue'

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

// 三色动作按钮共用底座 + 各自颜色/描边/阴影
const variantClasses = computed(() => {
  const base =
    'inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black'
  switch (props.variant) {
    case 'secondary':
      return `${base} text-navy bg-white !border !border-[0.18cqh] !border-line`
    case 'danger':
      return `${base} text-white bg-red`
    default:
      return `${base} text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]`
  }
})
</script>

<template>
  <!-- v-bind="$attrs" 让调用处的 class / 原生事件 / aria 透传到按钮并自动与内置类合并 -->
  <button :type="type" :disabled="disabled" :class="variantClasses" v-bind="$attrs">
    <slot />
  </button>
</template>
