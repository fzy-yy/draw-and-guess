<!--
  异步模块（懒加载）的占位与失败兜底：由 utils/lazy-component.ts 的自管理包装组件
  在 loading/error 两态渲染（不经 defineAsyncComponent 的 loadingComponent/errorComponent 注入）。

  定位约定：本组件绝对定位铺满「最近的定位祖先」，因此宿主容器必须声明 relative，
  否则会逃逸到 .game-stage 上覆盖整个舞台。容器本身 pointer-events-none（不遮挡底层交互），
  只有重试按钮恢复 pointer-events-auto——低频模块加载失败时用户仍可继续使用页面其它功能。
-->
<script setup lang="ts">
import { LoaderCircle, RotateCw } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AppButton from '@/components/common/AppButton.vue'

withDefaults(
  defineProps<{
    /** 加载错误（由 utils/lazy-component 包装组件转发）；loading 态为 undefined。 */
    error?: Error
    /** 重试回调（由 lazy-component 包装组件提供——Vue 不会向 errorComponent 注入 retry）。 */
    retry?: () => void
  }>(),
  { error: undefined, retry: undefined },
)
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 grid place-items-center p-[2cqh]"
    role="status"
    aria-live="polite"
  >
    <div v-if="error" class="flex flex-col items-center gap-[1cqh] text-center">
      <p class="text-fs-14 font-bold text-red">{{ strings.common.moduleLoadFailed }}</p>
      <AppButton v-if="retry" variant="secondary" class="pointer-events-auto" @click="retry">
        <RotateCw />{{ strings.common.retry }}
      </AppButton>
    </div>
    <div v-else class="flex flex-col items-center gap-[0.8cqh] text-muted">
      <LoaderCircle class="h-[3.4cqh] w-[3.4cqh] animate-spin text-blue" />
      <span class="text-fs-12">{{ strings.common.moduleLoading }}</span>
    </div>
  </div>
</template>
