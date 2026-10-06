<!--
  头像选择字段组件（AvatarPickerField）：
  将头像展示、点击更换按钮、模态选择弹窗（AvatarPickerDialog）及打开/关闭状态机深度内聚。
  
  完全符合 docs/Vue组件开发规范.md：
  - M1: 仅通过四个插座（props, emits, slots, defineModel）暴露对外契约
  - M2: 严格类型 Props 与默认值声明
  - M3: 双向绑定使用 defineModel<AvatarId>()，不直接修改 props
  - M4: 严格类型 Emits 声明
  - M5: 声明 class prop，并通过 cn() 进行样式合并
  - S4: 封装复杂编排与弹窗生命周期，减少页面调用方样板代码
  - S9: 严格使用设计系统色彩与偶数字号标尺
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { AVATAR_IDS, type AvatarId } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { cn } from '@/utils/cn'
import AvatarImage from '@/components/common/AvatarImage.vue'
import AvatarPickerDialog from '@/components/common/AvatarPickerDialog.vue'

interface Props {
  /** 字段外层顶部标签文本（如“头像”），未传入时不渲染外层 label */
  label?: string
  /** 按钮下方提示文案（如“更换头像”或“头像”） */
  actionText?: string
  /** 头像尺寸类，默认 h-[14cqh] w-[14cqh] */
  avatarSizeClass?: string
  /** 头像白名单列表，默认使用协议定义的全部内置头像 */
  avatarIds?: readonly AvatarId[]
  /** 禁用态 */
  disabled?: boolean
  /** 追加到最外层容器的类名 */
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  actionText: undefined,
  avatarSizeClass: 'h-[14cqh] w-[14cqh]',
  avatarIds: () => AVATAR_IDS,
  disabled: false,
  class: undefined,
})

const model = defineModel<AvatarId>({ required: true })

const emit = defineEmits<{
  select: [avatarId: AvatarId]
}>()

const isPickerOpen = ref(false)

const rootClass = computed(() => cn('flex flex-col items-center', props.class))

function handleSelect(): void {
  emit('select', model.value)
}
</script>

<template>
  <div :class="rootClass">
    <span v-if="label" class="mb-[0.65cqh] block text-navy font-bold">
      {{ label }}
    </span>
    <button
      class="flex flex-col items-center gap-[0.8cqh] bg-transparent text-blue text-fs-12 font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      type="button"
      :disabled="disabled"
      :aria-label="strings.a11y.profile.changeAvatarAria"
      @click="!disabled && (isPickerOpen = true)"
    >
      <AvatarImage
        :avatar-id="model"
        :label="strings.a11y.common.myAvatarAria"
        :class="avatarSizeClass"
      />
      <span v-if="actionText">{{ actionText }}</span>
    </button>

    <AvatarPickerDialog
      v-model:open="isPickerOpen"
      v-model="model"
      :avatar-ids="avatarIds"
      @close="handleSelect"
    />
  </div>
</template>
