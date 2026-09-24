<!-- 内置 SVG 头像选择弹窗：列出全部白名单资源，选择后立即回写并关闭。 -->
<script setup lang="ts">
import type { AvatarId } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import AvatarImage from '@/components/common/AvatarImage.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'

const open = defineModel<boolean>('open', { default: false })
const modelValue = defineModel<AvatarId>({ required: true })
const props = defineProps<{ avatarIds: readonly AvatarId[] }>()
const emit = defineEmits<{ close: [] }>()

/** 只允许从配置白名单产生头像编号；点击后立即应用并关闭弹窗。 */
function selectAvatar(avatarId: AvatarId): void {
  playInteractionSound('select')
  modelValue.value = avatarId
  open.value = false
  emit('close')
}
</script>

<template>
  <!-- 统一使用 BaseDialog：自动获得 document 级 Esc 关闭、遮罩/卡片/标题栏骨架与淡入缩放过渡 -->
  <BaseDialog
    v-model:open="open"
    width-class="w-[64cqw]"
    labelledby="avatar-picker-title"
    :close-aria="strings.profile.avatarPickerCloseAria"
    @close="emit('close')"
  >
    <template #header>
      <p class="eyebrow">
        {{ strings.profile.avatarPickerLabel }}
      </p>
      <h2 id="avatar-picker-title">{{ strings.profile.avatarPickerTitle }}</h2>
    </template>
    <div
      class="grid min-h-0 grid-cols-8 gap-[1.4cqh_1cqw] overflow-y-auto px-[2cqw] py-[2.5cqh] overscroll-contain"
    >
      <!-- 按钮组语义：单选即点即选并关闭，无需 radiogroup 的键盘约定（按钮均为独立 Tab 停靠点） -->
      <button
        v-for="avatarId in props.avatarIds"
        :key="avatarId"
        type="button"
        class="grid aspect-square place-items-center rounded-full border-[0.22cqh] bg-white p-[0.7cqh]"
        :class="
          modelValue === avatarId
            ? 'border-navy outline-[0.45cqh] outline-focus outline-offset-[0.1cqh]'
            : 'border-control'
        "
        :aria-pressed="modelValue === avatarId"
        :aria-label="strings.profile.avatarOptionAria(avatarId)"
        @click="selectAvatar(avatarId)"
      >
        <AvatarImage
          :avatar-id="avatarId"
          :label="strings.profile.avatarOptionAria(avatarId)"
          class="h-full w-full border-0 shadow-none"
        />
      </button>
    </div>
  </BaseDialog>
</template>
