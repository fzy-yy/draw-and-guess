<!--
  规则表单横排开关字段（可复用）：左侧复选框 + 标签，整行可点。
  收敛房间规则弹窗中 6 处重复的「横排 checkbox + 文案」结构；
  v-model 双向绑定布尔值，组件不感知业务字段。
-->
<script setup lang="ts">
import { playInteractionSound } from '@/audio'

const model = defineModel<boolean>({ required: true })

defineProps<{
  /** 字段标签文案（来自 strings） */
  label: string
}>()
</script>

<template>
  <!-- 整行即命中区：touch-target 保证 ≥44×44，compact-control 保证低高度舞台下不缩到不可点。 -->
  <label
    class="touch-target compact-control min-w-0 flex min-h-[4.8cqh] flex-row items-center gap-[0.5cqh] rounded-[0.5em] border-[0.18cqh] border-control bg-line px-[0.8em] text-fs-14 font-bold cursor-pointer"
  >
    <!-- relative z-[1]：让复选框位于 .touch-target 伪元素之上，直接点击/自动化 check() 都能命中它 -->
    <input
      v-model="model"
      type="checkbox"
      class="relative z-[1] h-[max(2.2cqh,18px)] w-[max(2.2cqh,18px)] accent-blue"
      @change="playInteractionSound('toggle')"
    />
    {{ label }}
  </label>
</template>
