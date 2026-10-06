<!--
  通用确认弹窗：图标 + 标题 + 正文 + 底部「取消/确认」按钮，基于 BaseDialog 复用了无标题栏的确认布局。
  供对局（清空/提前结束）与房间（退出）等破坏性确认场景复用；确认按钮默认 danger（红色），
  非破坏性场景可经 confirmVariant 换 primary（如诊断页「恢复默认设置」）。
-->
<script setup lang="ts">
import { useId, type FunctionalComponent } from 'vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'

const open = defineModel<boolean>('open', { default: false })

withDefaults(
  defineProps<{
    title: string
    body: string
    confirmLabel: string
    cancelLabel: string
    /** 顶部警示图标（lucide 组件），默认无 */
    icon?: FunctionalComponent
    /** 确认按钮变体，默认 danger（红） */
    confirmVariant?: 'primary' | 'danger'
    /** 需要覆盖较高层级页面时，可覆盖通用弹窗的默认层级。 */
    overlayClass?: string
  }>(),
  { icon: undefined, confirmVariant: 'danger', overlayClass: undefined },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
// useId 保证同一页面存在多个确认弹窗（对局内清空/提前结束/退出）时标题 id 不冲突。
const titleId = useId()

function cancel(): void {
  open.value = false
  emit('cancel')
}

function confirm(): void {
  open.value = false
  emit('confirm')
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    size="sm"
    centered
    footer-class="mt-[1cqh]"
    :labelledby="titleId"
    :overlay-class="overlayClass"
    @close="cancel"
  >
    <div
      v-if="icon"
      class="grid h-[7cqh] w-[7cqh] place-items-center rounded-full bg-red/10 text-red"
      aria-hidden="true"
    >
      <component :is="icon" class="h-[55%] w-[55%]" />
    </div>
    <h2 :id="titleId">{{ title }}</h2>
    <p class="max-w-[30em] leading-[1.6] text-muted">{{ body }}</p>
    <template #footer>
      <AppButton variant="secondary" type="button" audio-feedback="close" @click="cancel">
        {{ cancelLabel }}
      </AppButton>
      <AppButton :variant="confirmVariant" type="button" @click="confirm">
        {{ confirmLabel }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
