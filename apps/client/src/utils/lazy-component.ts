import { defineComponent, h, onBeforeUnmount, ref, shallowRef, type Component } from 'vue'
import AsyncModuleFallback from '@/components/common/AsyncModuleFallback.vue'

/**
 * 低频组件懒加载工厂：把「动态 import + 轻量 loading 占位 + 失败重试」收敛到一处，
 * 避免每个使用点各写一套配置导致加载/失败体验不一致。
 *
 * 为什么不用 Vue 的 defineAsyncComponent（历史实现，已废弃）：
 * 1) Vue 3.5 渲染 errorComponent 时只注入 `error`、**从不注入 `retry`**
 *    （见 @vue/runtime-core「createVNode(errorComponent, { error })」），
 *    失败兜底里的重试按钮依赖注入 props 的话永远不会渲染；
 * 2) 即使经 onError 回调截获重试函数，一旦按常规先调 `fail()` 进入错误态，
 *    内部 Promise 已 settled，之后的 `retry()` 无法让**当前实例**回到成功渲染
 *    （loader 会被重跑、resolvedComp 会被更新，但 loaded 标记不再触发，UI 卡死在错误页）。
 * 因此这里改为自管理包装组件：pending/占位/超时/错误/重试全部由本组件状态驱动，
 * 「重试」就是原样再跑一次 loader()——ESM 失败不会被浏览器缓存，重新 import 会真实重拉。
 *
 * 使用约定：
 * - 只用于**视图内部的低频组件**（词库弹窗、礼花库等）；
 *   整页视图不再走懒加载——懒加载整页会在 `v-else-if` 视图切换时产生「视图真空帧」
 *   露出舞台近白底板（首开白闪，取舍见 docs/adr/0014-settings-view-static-import.md）；
 *   核心对局链路始终静态导入。
 * - 目标模块**不得**再经各 components 子目录的 barrel（index.ts）静态 re-export——
 *   静态 re-export 会把模块重新拉回主 chunk，切分随之失效（见各 barrel 中的显式说明）。
 * - 宿主容器需为定位元素（relative）：占位组件是 absolute 铺满「最近的定位祖先」。
 *
 * 占位策略与原实现一致：120ms 内完成加载则完全不出现占位（局域网常态）；
 * 20s 未完成视为失败进入错误态（带重试按钮）。
 */

/** 占位延迟：低于此毫秒数完成的加载不渲染 loading 占位，避免快网下闪烁。 */
const PLACEHOLDER_DELAY_MS = 120
/** 加载超时：超过此毫秒数仍未完成则进入失败态，允许用户手动重试。 */
const LOAD_TIMEOUT_MS = 20_000

export function defineLazyComponent<T extends Component>(loader: () => Promise<{ default: T }>): T {
  return defineComponent({
    name: 'LazyComponentWrapper',
    // 手动经 h(目标, attrs) 透传属性与事件监听，关闭默认 fallthrough 防止双重绑定
    inheritAttrs: false,
    setup(_props, { attrs }) {
      const resolved = shallowRef<Component>()
      const error = shallowRef<Error>()
      const pending = ref(false)
      /** 仅当加载时长越过 delay 窗口才为 true（控制占位可见性，等价原 delay:120 语义）。 */
      const showPlaceholder = ref(false)

      // 轮次令牌：重试后旧一轮的异步回调不得改写新一轮状态
      let attemptToken = 0
      let delayTimer: ReturnType<typeof setTimeout> | undefined
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined

      function clearTimers(): void {
        if (delayTimer !== undefined) clearTimeout(delayTimer)
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
        delayTimer = undefined
        timeoutTimer = undefined
      }

      function load(): void {
        const token = ++attemptToken
        clearTimers()
        error.value = undefined
        pending.value = true
        showPlaceholder.value = false
        delayTimer = setTimeout(() => {
          if (token === attemptToken) showPlaceholder.value = true
        }, PLACEHOLDER_DELAY_MS)
        timeoutTimer = setTimeout(() => {
          if (token !== attemptToken) return
          error.value = new Error(`Lazy module load timed out after ${LOAD_TIMEOUT_MS}ms`)
          pending.value = false
          clearTimers()
        }, LOAD_TIMEOUT_MS)
        loader().then(
          (module) => {
            if (token !== attemptToken) return
            clearTimers()
            resolved.value = module.default
            pending.value = false
          },
          (cause: unknown) => {
            if (token !== attemptToken) return
            clearTimers()
            error.value = cause instanceof Error ? cause : new Error(String(cause))
            pending.value = false
          },
        )
      }

      load()
      onBeforeUnmount(clearTimers)

      return () => {
        if (resolved.value) return h(resolved.value, attrs)
        // 失败态传入 retry：按钮点击即重跑 loader（AsyncModuleFallback 的按钮依赖 retry prop）
        if (error.value) return h(AsyncModuleFallback, { error: error.value, retry: load })
        if (pending.value && showPlaceholder.value) return h(AsyncModuleFallback)
        // 延迟窗口内的极短真空：渲染注释节点（与 defineAsyncComponent 原行为一致）
        return null
      }
    },
  }) as unknown as T
}
