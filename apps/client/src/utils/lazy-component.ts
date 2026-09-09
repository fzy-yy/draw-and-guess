import { defineAsyncComponent, type Component } from 'vue'
import AsyncModuleFallback from '@/components/common/AsyncModuleFallback.vue'

/**
 * 低频模块懒加载工厂：把「动态 import + 轻量 loading 占位 + 失败重试」收敛到一处，
 * 避免每个使用点各写一套 defineAsyncComponent 配置导致加载/失败体验不一致。
 *
 * 使用约定：
 * - 只用于**首屏不需要**的低频模块（设置页、诊断页、词库弹窗、头像弹窗等）；
 *   核心对局链路（画布/工具栏/聊天/阶段遮罩）保持静态导入，避免关键路径多一次网络往返。
 * - 目标模块**不得**再经各 components 子目录的 barrel（index.ts）静态 re-export——
 *   静态 re-export 会把模块重新拉回主 chunk，切分随之失效（见各 barrel 中的显式说明）。
 * - 宿主容器需为定位元素（relative）：占位组件是 absolute 铺满「最近的定位祖先」。
 *
 * delay 120ms：局域网内通常已完成加载，不闪占位；timeout 20s 后进入失败态并提供重试。
 */
export function defineLazyComponent<T extends Component>(loader: () => Promise<{ default: T }>): T {
  return defineAsyncComponent({
    loader,
    loadingComponent: AsyncModuleFallback,
    errorComponent: AsyncModuleFallback,
    delay: 120,
    timeout: 20_000,
  }) as unknown as T
}
