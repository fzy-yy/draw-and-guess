<!--
  统一系统警示/通知阻断弹窗（AlertDialog）：
  收敛断线恢复阻断、版本不兼容阻断与被踢提示等单操作通知弹窗的重复手写结构。
  
  完全符合 docs/Vue组件开发规范.md：
  - M1: 仅通过四个插座（props, emits, slots, defineModel）暴露对外契约
  - M2: 严格类型 Props 与默认值声明
  - M3: 双向绑定使用 defineModel<boolean>('open')，不直接修改 props
  - M4: 严格类型 Emits 声明
  - M5: 声明 class prop，并通过 cn() 进行样式合并
  - M7/M8: 完整 Tailwind 字面量变体表与 cn() 消解
  - S9: 语义化色彩变体（danger/warning/info/primary），严格使用设计系统令牌
-->
<script setup lang="ts">
import { computed, useId, type Component } from 'vue'
import { cn, type ClassValue } from '@/utils/cn'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'

export type AlertTone = 'danger' | 'warning' | 'info' | 'primary'

interface Props {
  /** 弹窗主标题 */
  title: string
  /** 弹窗提示正文说明 */
  body?: string
  /** 顶部警示图标组件（Lucide 图标） */
  icon?: Component
  /** 图标底座色彩语义：danger(红)/warning(黄)/info(天蓝)/primary(深蓝) */
  iconTone?: AlertTone
  /** 主操作按钮文案（如“确定”、“刷新游戏”）；未提供时底部不渲染操作按钮 */
  actionLabel?: string
  /** 主操作按钮变体 */
  actionVariant?: 'primary' | 'secondary' | 'danger'
  /** 是否允许 Esc 或点击外部关闭，系统阻断框传 false */
  dismissible?: boolean
  /** 弹窗遮罩层级类，系统阻断提示需高于普通弹窗（如 z-[100]） */
  overlayClass?: string
  /** 弹窗卡片宽度类，默认 w-[44cqw] */
  widthClass?: string
  /** 正文区域 aria role，如 alert 或 status */
  role?: string
  /** 使用方追加的类名 */
  class?: ClassValue
}

const props = withDefaults(defineProps<Props>(), {
  body: undefined,
  icon: undefined,
  iconTone: 'danger',
  actionLabel: undefined,
  actionVariant: 'primary',
  dismissible: true,
  overlayClass: 'z-30',
  widthClass: 'w-[44cqw]',
  role: undefined,
  class: undefined,
})

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  /** 点击主操作按钮触发 */
  action: []
  /** 弹窗关闭触发 */
  close: []
}>()

defineSlots<{
  icon?: () => unknown
  title?: () => unknown
  default?: () => unknown
  action?: () => unknown
}>()

const titleId = useId()

const toneClasses: Record<AlertTone, string> = {
  danger: 'bg-red/10 text-red',
  warning: 'bg-yellow/10 text-warning-fg',
  info: 'bg-sky text-blue',
  primary: 'bg-blue/10 text-blue',
}

const iconBadgeClass = computed(() =>
  cn(
    'grid h-[10cqh] w-[10cqh] place-items-center rounded-full shrink-0 select-none [&>svg]:h-[5cqh] [&>svg]:w-[5cqh]',
    toneClasses[props.iconTone],
  ),
)

function handleAction(): void {
  emit('action')
  if (props.dismissible) {
    open.value = false
  }
}

function handleClose(): void {
  if (!props.dismissible) return
  open.value = false
  emit('close')
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    :dismissible="dismissible"
    :overlay-class="overlayClass"
    :width-class="widthClass"
    section-class="items-center gap-[1em] px-[2.2em] py-[4cqh] text-center"
    footer-class="w-full justify-center mt-[0.5cqh]"
    :labelledby="titleId"
    @close="handleClose"
  >
    <!-- 图标插槽或组件 -->
    <div v-if="$slots.icon || icon" :class="iconBadgeClass" aria-hidden="true">
      <slot name="icon">
        <component :is="icon" />
      </slot>
    </div>

    <!-- 标题 -->
    <slot name="title">
      <h2 :id="titleId" class="text-fs-24 font-bold text-navy leading-tight">
        {{ title }}
      </h2>
    </slot>

    <!-- 说明文本/插槽内容 -->
    <slot>
      <p
        v-if="body"
        class="max-w-[37cqw] text-fs-14 font-bold leading-relaxed text-muted"
        :role="role"
      >
        {{ body }}
      </p>
    </slot>

    <!-- 底部操作区 -->
    <template #footer>
      <slot name="action">
        <AppButton
          v-if="actionLabel"
          :variant="actionVariant"
          type="button"
          class="min-w-[10em]"
          @click="handleAction"
        >
          {{ actionLabel }}
        </AppButton>
      </slot>
    </template>
  </BaseDialog>
</template>
