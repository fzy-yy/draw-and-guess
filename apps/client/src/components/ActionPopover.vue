<!--
  可复用的图标操作悬浮面板：负责触发、点外关闭、Esc 关闭与基础定位；
  具体图标和面板内容全部由插槽提供，后续聊天工具或其它操作区可复用同一交互外壳。
-->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'

const props = withDefaults(
  defineProps<{
    triggerLabel: string
    panelAriaLabel: string
    disabled?: boolean
    align?: 'start' | 'end'
  }>(),
  {
    disabled: false,
    align: 'start',
  },
)

const root = ref<HTMLElement>()
const trigger = ref<HTMLElement>()
const open = ref(false)

function close(restoreFocus = false): void {
  if (!open.value) return
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function toggle(): void {
  if (!props.disabled) open.value = !open.value
}

onClickOutside(root, () => close())
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close()
  },
)

defineExpose({ close })
</script>

<template>
  <div ref="root" class="relative inline-flex" @keydown.esc.stop="close(true)">
    <button
      ref="trigger"
      type="button"
      class="round-icon-btn"
      :disabled="disabled"
      :aria-label="triggerLabel"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <slot name="trigger" />
    </button>
    <div
      v-if="open"
      role="dialog"
      :aria-label="panelAriaLabel"
      :class="[
        'absolute bottom-[calc(100%+0.8cqh)] z-50 w-max max-w-[18cqw] rounded-[0.7em] border-[0.18cqh] border-line bg-white p-[0.65em] shadow-[0_1cqh_3cqh_#0f172a2e]',
        align === 'end' ? 'right-0' : 'left-0',
      ]"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
