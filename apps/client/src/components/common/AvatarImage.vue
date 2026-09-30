<!--
  统一 SVG 头像展示组件。
  所有页面只传递服务端已验证的头像编号，组件通过本地白名单映射到静态资源 URL，禁止 v-html。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import type { AvatarId } from '@draw-guess/shared'
import { getAvatarUrl } from '@/utils/avatar'
import { cn } from '@/utils/cn'

withDefaults(
  defineProps<{
    avatarId?: AvatarId | string
    label: string
  }>(),
  { avatarId: undefined },
)

const attrs = useAttrs()
const rootClass = computed(() =>
  cn(
    'inline-grid flex-none place-items-center overflow-hidden rounded-full border-[0.28cqh] border-white bg-white shadow-ring',
    attrs.class,
  ),
)
</script>

<template>
  <!-- role="img" + aria-label：内层 <img> 是装饰图（alt=""），可读名称由外层 span 承担；
       generic 容器不保证无障碍名生效，需显式声明 img 语义（对齐 HostCrownBadge / DifficultyStars）。 -->
  <span :class="rootClass" :aria-label="label" role="img">
    <img
      class="pointer-events-none h-[82%] w-[82%] object-contain"
      :src="getAvatarUrl(avatarId)"
      alt=""
      draggable="false"
    />
  </span>
</template>
