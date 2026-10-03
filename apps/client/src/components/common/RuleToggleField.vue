<!--
  规则表单横排开关字段（可复用）：左侧复选框 + 标签，整行可点。
  收敛房间规则弹窗中 6 处重复的「横排 checkbox + 文案」结构；
  v-model 双向绑定布尔值，组件不感知业务字段。
-->
<script setup lang="ts">
import { playInteractionSound } from '@/audio'

const model = defineModel<boolean>({ required: true })

withDefaults(
  defineProps<{
    /** 字段标签文案（来自 strings） */
    label: string
    disabled?: boolean
  }>(),
  { disabled: false },
)
</script>

<template>
  <!-- 整行即命中区（原生 label 关联）：尺寸随舞台等比缩放，不再挂覆盖层类。 -->
  <label
    class="min-w-0 flex min-h-[4.8cqh] flex-row items-center gap-[0.5cqh] rounded-[0.5em] border-[0.18cqh] border-control bg-line px-[0.8em] text-fs-14 font-bold"
    :class="disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'"
  >
    <input
      v-model="model"
      type="checkbox"
      :disabled="disabled"
      class="h-[max(2.2cqh,16px)] w-[max(2.2cqh,16px)] accent-blue disabled:cursor-not-allowed"
      @change="!disabled && playInteractionSound('toggle')"
    />
    {{ label }}
  </label>
</template>
