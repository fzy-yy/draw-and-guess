<!--
  统一 SVG 头像展示组件。
  所有页面只传递服务端已验证的头像编号，组件通过本地白名单映射到静态资源 URL，禁止 v-html。
-->
<script setup lang="ts">
import type { AvatarId } from '@draw-guess/shared'
import { getAvatarUrl } from '@/utils/avatar'

withDefaults(
  defineProps<{
    avatarId?: AvatarId | string
    label: string
    decorative?: boolean
  }>(),
  { avatarId: undefined, decorative: false },
)
</script>

<template>
  <span
    class="inline-grid flex-none place-items-center overflow-hidden rounded-full border-[0.28cqh] border-white bg-white shadow-[0_0_0_0.18cqh_#94a3b8]"
    :aria-label="decorative ? undefined : label"
    :aria-hidden="decorative"
  >
    <img
      class="pointer-events-none h-[82%] w-[82%] object-contain"
      :src="getAvatarUrl(avatarId)"
      alt=""
      draggable="false"
    />
  </span>
</template>
