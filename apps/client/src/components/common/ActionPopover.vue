<!--
  可复用的图标操作悬浮面板：负责触发、点外关闭、Esc 关闭与基础定位；
  具体图标和面板内容全部由插槽提供，后续聊天工具或其它操作区可复用同一交互外壳。
  面板设有最大尺寸上限：内容超出时内部滚动，避免弹出框随内容无限撑高遮挡页面；
  面板宽度/层级等细节可通过 panelClass 由调用方按场景扩展。
-->
<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import RoundIconButton from '@/components/common/RoundIconButton.vue'

const props = withDefaults(
  defineProps<{
    triggerLabel: string
    panelAriaLabel: string
    disabled?: boolean
    /**
     * 弹出方向：'top' 向上弹出（适用于屏幕底部的工具，如聊天快捷互动），
     * 'bottom' 向下弹出（适用于页面顶部的工具栏，如词库管理筛选）。
     * 默认 'top' 保持旧行为；在对话框顶部使用时必须传 'bottom'，
     * 否则弹层会越过对话框顶部被 overflow-hidden 裁剪（看不到上半部分）。
     */
    placement?: 'top' | 'bottom'
    /** 触发按钮的悬浮提示（无文字图标按钮的语义补充）；缺省不显示。 */
    triggerTitle?: string
    /** 追加到面板的扩展类（宽度/最大高度等按场景覆盖默认约束）。 */
    panelClass?: string
  }>(),
  {
    disabled: false,
    placement: 'top',
    triggerTitle: undefined,
    panelClass: '',
  },
)

const root = ref<HTMLElement>()
const trigger = ref<InstanceType<typeof RoundIconButton>>()
const panel = ref<HTMLElement>()
const panelId = `action-popover-${useId()}`
const open = ref(false)

function close(restoreFocus = true): void {
  if (!open.value) return
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

async function toggle(): Promise<void> {
  if (props.disabled) return
  if (open.value) {
    close(true)
    return
  }
  open.value = true
  await nextTick()
  const firstFocusable = panel.value?.querySelector<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  )
  ;(firstFocusable ?? panel.value)?.focus()
}

onClickOutside(root, () => close(false))
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close(true)
  },
)

// close 只经作用域插槽（#default="{ close }"）交给面板内容使用；
// 不做 defineExpose——两个消费者都不持实例引用，暴露反而邀请外部绕过 Esc/点外关闭路径。
</script>

<template>
  <!--
    Esc 在根节点 .stop 截获，是与 BaseDialog 的隐性耦合（互指说明见 BaseDialog.vue
    isTopmostDialog 注释）：面板同为 role="dialog"，会进入 BaseDialog 顶层仲裁的全局
    查询集合；面板打开期间必须先截获 Esc 只关面板，键盘事件不得落到 BaseDialog 的
    document 级监听。回退本 .stop 前请先读 BaseDialog 侧注释。
  -->
  <div ref="root" class="relative inline-flex" @keydown.esc.stop="close(true)">
    <RoundIconButton
      ref="trigger"
      :label="triggerLabel"
      :disabled="disabled"
      :title="triggerTitle"
      :aria-expanded="open"
      :aria-controls="panelId"
      :audio-feedback="open ? 'close' : 'open'"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <slot name="trigger" />
    </RoundIconButton>
    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      role="dialog"
      aria-modal="false"
      tabindex="-1"
      :aria-label="panelAriaLabel"
      :class="[
        // 弹出方向：top 从按钮上方弹出，bottom 从按钮下方弹出（见 placement 说明）
        placement === 'top' ? 'bottom-[calc(100%+0.8cqh)]' : 'top-[calc(100%+0.8cqh)]',
        // 水平锚定固定左对齐触发按钮：全部消费点均以此形态出现，不提供右对齐变体。
        'absolute left-0 z-50 max-h-[42cqh] w-max max-w-[18cqw] overflow-y-auto overscroll-contain rounded-[0.7em] border-[0.18cqh] border-line bg-white p-[0.65em] shadow-float',
        panelClass,
      ]"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
