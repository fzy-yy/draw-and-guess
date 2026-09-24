<!--
  规则表单竖排滑块字段（可复用）：上一行标签 + 滑块 + 当前值。
  收敛房间规则弹窗中 6 处重复的「纵向 label + range + 数值」结构；
  数值/滑块区间与步进全部由调用方传入，组件不感知业务字段。
  可选 disabled：禁用时整行半透明并阻止交互（如结构化提示关闭后的时机字段）。
-->
<script setup lang="ts">
import { playInteractionSound } from '@/audio'

const model = defineModel<number>({ required: true })

withDefaults(
  defineProps<{
    /** 字段标签文案（来自 strings） */
    label: string
    min: number
    max: number
    step: number
    /** 当前值展示文案（由调用方格式化，如「60%」「90 秒」） */
    display: string
    disabled?: boolean
    /** 下方辅助说明（可选，如「提示已关闭时不可用」） */
    hint?: string
  }>(),
  { disabled: false, hint: undefined },
)

/** range 输入值始终是字符串，转为数值再更新，保持数值语义。 */
function onInput(event: Event): void {
  model.value = Number((event.target as HTMLInputElement).value)
}
</script>

<template>
  <!-- 滑块命中区由自身承担：label 上不得挂任何覆盖层类（伪元素会盖住 range，
       range 只响应指针按下/拖拽，label 只转发 click，滑块将完全无法拖动）。
       尺寸不设像素保底，随舞台等比缩放。 -->
  <label
    class="min-w-0 flex flex-col gap-[0.4cqh] text-fs-14 font-bold"
    :class="{ 'opacity-45 pointer-events-none': disabled }"
  >
    <span class="flex items-baseline justify-between gap-[0.5em]">
      {{ label }}
      <b class="text-blue text-fs-16">{{ display }}</b>
    </span>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="model"
      :disabled="disabled"
      class="h-[2.75em] accent-blue"
      @input="onInput"
      @change="playInteractionSound('select')"
    />
    <small v-if="hint" class="text-muted text-fs-12">{{ hint }}</small>
  </label>
</template>
