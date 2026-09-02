<!--
  难度星级展示组件（可复用）。
  以「实心星 = 已达难度、空心星 = 未达难度」的形式直观呈现 1~max 的难度值：
  - 选词面板：候选词按钮下方展示该词难度；
  - 词库管理表格：难度列内展示；
  - 后续任何需要「数值星级」的场景均可复用（颜色与尺寸由调用处按上下文传入）。
  难度上限取自全局配置（config/settings.ts 的 ui.difficultyMax），组件内不硬编码。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Star } from 'lucide-vue-next'
import { PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'

const props = withDefaults(
  defineProps<{
    /** 当前难度值（1~max） */
    value: number
    /** 难度上限；缺省用全局配置（避免组件内硬编码） */
    max?: number
    /** 无障碍标签；缺省用统一文案「难度 n 星」 */
    ariaLabel?: string
  }>(),
  { max: PUBLIC_CONFIG.ui.difficultyMax, ariaLabel: undefined },
)

// 实心星数量：钳制在 0~max，防止异常数据渲染出越界星数
const filled = computed(() => Math.max(0, Math.min(props.max, Math.round(props.value))))
// 全部星位的下标序列（v-for 渲染用）
const positions = computed(() => Array.from({ length: props.max }, (_, index) => index + 1))
</script>

<template>
  <!-- role=img + aria-label：屏幕阅读器读到「难度 n 星」而非一串无意义的图标 -->
  <span
    class="inline-flex items-center gap-[0.08em]"
    role="img"
    :aria-label="props.ariaLabel ?? strings.game.wordDifficultyAria(props.value)"
  >
    <Star
      v-for="position in positions"
      :key="position"
      class="h-[1em] w-[1em] shrink-0"
      :class="position <= filled ? 'fill-yellow text-yellow' : 'text-muted'"
      aria-hidden="true"
    />
  </span>
</template>
