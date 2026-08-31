<!-- 内置 SVG 头像选择弹窗：列出全部白名单资源，选择后立即回写并关闭。 -->
<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { AvatarId } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
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
  <Transition name="modal">
    <div
      v-if="props.open"
      class="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-picker-title"
      @keydown.esc="emit('close')"
    >
      <section class="game-dialog avatar-picker-dialog">
        <header>
          <div>
            <p class="step-label">{{ strings.profile.avatarPickerLabel }}</p>
            <h2 id="avatar-picker-title">{{ strings.profile.avatarPickerTitle }}</h2>
          </div>
          <button
            type="button"
            :aria-label="strings.profile.avatarPickerCloseAria"
            @click="emit('close')"
          >
            <X />
          </button>
        </header>
        <div
          class="avatar-picker-grid"
          role="radiogroup"
          :aria-label="strings.profile.avatarPickerAria"
        >
          <button
            v-for="avatarId in store.config.player.avatarIds"
            :key="avatarId"
            type="button"
            role="radio"
            :class="{ selected: props.modelValue === avatarId }"
            :aria-checked="props.modelValue === avatarId"
            :aria-label="strings.profile.avatarOptionAria(avatarId)"
            @click="selectAvatar(avatarId)"
          >
            <AvatarImage
              :avatar-id="avatarId"
              :label="strings.profile.avatarOptionAria(avatarId)"
            />
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>
