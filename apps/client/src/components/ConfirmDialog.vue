<!--
  通用确认弹窗：图标 + 标题 + 正文 + 底部「取消/确认」按钮，基于 BaseDialog 复用了无标题栏的确认布局。
  供对局（清空/提前结束）与房间（退出）等破坏性确认场景复用，使用统一红色 danger 确认按钮。
-->
<script setup lang="ts">
import type { FunctionalComponent } from 'vue'
import BaseDialog from '@/components/BaseDialog.vue'
import AppButton from '@/components/AppButton.vue'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    body: string
    confirmLabel: string
    cancelLabel: string
    /** 顶部警示图标（lucide 组件），默认无 */
    icon?: FunctionalComponent
    /** 确认按钮变体，默认 danger（红） */
    confirmVariant?: 'primary' | 'danger'
  }>(),
  { icon: undefined, confirmVariant: 'danger' },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <BaseDialog
    :open="open"
    width-class="w-[40cqw]"
    section-class="items-center gap-[1.4cqh] pt-[3cqh] text-center"
    footer-class="w-full mt-[1cqh]"
    :aria-label="title"
    @close="emit('cancel')"
  >
    <component
      :is="icon"
      v-if="icon"
      class="h-[7cqh] w-[7cqh] rounded-full bg-red-100 p-[1.4cqh] text-[#991b1b]"
    />
    <h2>{{ title }}</h2>
    <p class="max-w-[30em] leading-[1.6] text-muted">{{ body }}</p>
    <template #footer>
      <AppButton variant="secondary" type="button" @click="emit('cancel')">
        {{ cancelLabel }}
      </AppButton>
      <AppButton :variant="confirmVariant" type="button" @click="emit('confirm')">
        {{ confirmLabel }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
