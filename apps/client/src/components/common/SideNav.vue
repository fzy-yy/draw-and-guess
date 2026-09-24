<!--
  侧边导航栏（可复用）：垂直排列的导航条目，供「顶栏 + 左侧导航 + 右侧内容」的分页布局使用。
  条目由父层数据驱动传入，激活项经 v-model 双向绑定；本组件只负责渲染与切换，不持有页面状态。
  视觉与全站统一：复用 AppButton（secondary 变体），不加左侧指示小条；激活项由 AppButton active
  属性提供统一高亮语言（sky 衬底 + blue 边框文字）；交互走 160ms 统一变色反馈。
-->
<script setup lang="ts" generic="K extends string">
import type { Component } from 'vue'
import AppButton from '@/components/common/AppButton.vue'

/** 单个导航条目：唯一键、文案与图标（lucide 组件）。 */
export interface SideNavItem<K extends string = string> {
  key: K
  label: string
  icon: Component
}

defineProps<{
  /** 导航条目列表（顺序即渲染顺序）。 */
  items: SideNavItem<K>[]
  /** 无障碍标签（nav 语义，如「设置分类」）。注：不能命名为 ariaLabel——Vue 对 aria-* 属性恒透传，无法绑定为 prop（与 IconButton 同规约）。 */
  label: string
}>()

/** 当前激活条目键（v-model 双向绑定）。 */
const active = defineModel<K>({ required: true })
</script>

<template>
  <!-- 白底导航列：右侧 line 分隔线与各页面分区骨架保持一致 -->
  <nav
    class="flex min-h-0 min-w-0 flex-col gap-[0.8cqh] overflow-y-auto border-r-[0.2cqh] border-r-line bg-white px-[1em] py-[2.5cqh] overscroll-contain"
    :aria-label="label"
  >
    <AppButton
      v-for="item in items"
      :key="item.key"
      variant="secondary"
      :active="active === item.key"
      audio-feedback="select"
      :aria-current="active === item.key ? 'page' : undefined"
      class="w-full justify-start gap-[0.6em] px-[0.8em] text-left"
      @click="active = item.key"
    >
      <component :is="item.icon" class="h-[2.4cqh] w-[2.4cqh] shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </AppButton>
  </nav>
</template>
