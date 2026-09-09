<!--
  统一动作按钮：primary（蓝）/ secondary（白底描边）/ danger（红）。
  收敛原本分散在各视图的 `.primary-action/.secondary-action/.danger-action` 长串行内类。
  额外的布局类（如 w-full、mt-*）由调用处通过 class 传入，会自动与内置类合并。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { playInteractionSound, type InteractionAudioEvent } from '@/audio'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 按钮语义变体 */
    variant?: 'primary' | 'secondary' | 'danger'
    /** 原生 type，默认 button */
    type?: 'button' | 'submit' | 'reset'
    /** 禁用态 */
    disabled?: boolean
    /** 激活态（如导航栏选中、切换按钮选中） */
    active?: boolean
    /** 交互音效语义；null 用于已有专属领域音效的操作。 */
    audioFeedback?: InteractionAudioEvent | null
  }>(),
  {
    variant: 'primary',
    type: 'button',
    disabled: false,
    active: false,
    audioFeedback: 'activate',
  },
)

// 三色动作按钮共用底座 + 各自颜色/描边；按钮统一不使用阴影；支持激活态扩展。
const variantClasses = computed(() => {
  const base =
    'inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-bold'
  switch (props.variant) {
    case 'secondary':
      if (props.active) {
        return `${base} text-blue bg-sky border border-[0.18cqh] border-blue`
      }
      return `${base} text-navy bg-white border border-[0.18cqh] border-control`
    case 'danger':
      if (props.active) {
        return `${base} text-white bg-red ring-2 ring-red/40`
      }
      return `${base} text-white bg-red`
    default:
      if (props.active) {
        return `${base} text-white bg-blue ring-2 ring-blue/40`
      }
      return `${base} text-white bg-blue`
  }
})

// 在 setup 顶层取响应式 attrs 对象（官方要求 useAttrs 必须在 setup 内同步调用；
// 若写在 computed 惰性求值里，会依赖渲染期 currentRenderingInstance 副作用才能取到实例，脆弱且不可靠）。
// attrs 是响应式代理，此处保存引用后，后续变更仍能被下方 computed 追踪。
const attrs = useAttrs()

// 用 cn() 合并内置变体类与调用处透传进来的外部 class：
// 只取 attrs.class（外部类名），不要把整包 attrs 交给 clsx——那会把 class/style/onClick 等键名当作类名
// 追加进按钮 className，且外部类也不会经由 tailwind-merge 与内置类做冲突消解（如调用处 bg-white 覆盖内置 bg-blue）。
// 其余 attrs（style、事件、无障碍属性等）由 Vue 单根组件的隐式透传落到 <button> 上。
const buttonClass = computed(() => cn(variantClasses.value, attrs.class))

function handleClick(): void {
  if (props.audioFeedback) playInteractionSound(props.audioFeedback)
}
</script>

<template>
  <!-- 外部 class 等未声明 attrs 由 Vue 单根组件特性自动透传到按钮（与 buttonClass 合并生效） -->
  <button :type="type" :disabled="disabled" :class="buttonClass" @click="handleClick">
    <slot />
  </button>
</template>
