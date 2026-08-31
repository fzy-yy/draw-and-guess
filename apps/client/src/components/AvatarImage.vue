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
  <span class="avatar-image" :aria-label="decorative ? undefined : label" :aria-hidden="decorative">
    <img :src="getAvatarUrl(avatarId)" alt="" draggable="false" />
  </span>
</template>
