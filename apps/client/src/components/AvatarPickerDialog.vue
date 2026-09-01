<!-- 内置 SVG 头像选择弹窗：列出全部白名单资源，选择后立即回写并关闭。 -->
<script setup lang="ts">
import type { AvatarId } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import { useGameStore } from '@/stores/game'

const props = defineProps<{
  open: boolean
  modelValue: AvatarId
}>()
const emit = defineEmits<{
  'update:modelValue': [value: AvatarId]
  close: []
}>()
const store = useGameStore()

/** 只允许从配置白名单产生头像编号；点击后立即应用并关闭弹窗。 */
function selectAvatar(avatarId: AvatarId): void {
  emit('update:modelValue', avatarId)
  emit('close')
}
</script>

<template>
  <!-- 统一使用 BaseDialog：自动获得 document 级 Esc 关闭、遮罩/卡片/标题栏骨架与淡入缩放过渡 -->
  <BaseDialog
    :open="props.open"
    width-class="w-[64cqw]"
    labelledby="avatar-picker-title"
    :close-aria="strings.profile.avatarPickerCloseAria"
    @close="emit('close')"
  >
    <template #header>
      <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
        {{ strings.profile.avatarPickerLabel }}
      </p>
      <h2 id="avatar-picker-title">{{ strings.profile.avatarPickerTitle }}</h2>
    </template>
    <div
      class="grid min-h-0 grid-cols-[repeat(8,minmax(0,1fr))] gap-[1.4cqh_1cqw] overflow-y-auto px-[2cqw] py-[2.5cqh] [overscroll-behavior:contain]"
      role="radiogroup"
      :aria-label="strings.profile.avatarPickerAria"
    >
      <button
        v-for="avatarId in store.config.player.avatarIds"
        :key="avatarId"
        type="button"
        role="radio"
        class="grid aspect-square place-items-center rounded-full border-[0.22cqh] border-line bg-white p-[0.7cqh]"
        :class="{
          '!border-navy shadow-[0_0_0_0.45cqh_#facc15]': props.modelValue === avatarId,
        }"
        :aria-checked="props.modelValue === avatarId"
        :aria-label="strings.profile.avatarOptionAria(avatarId)"
        @click="selectAvatar(avatarId)"
      >
        <AvatarImage
          :avatar-id="avatarId"
          :label="strings.profile.avatarOptionAria(avatarId)"
          class="h-full w-full !border-0 !shadow-none"
        />
      </button>
    </div>
  </BaseDialog>
</template>
