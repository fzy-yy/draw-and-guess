/**
 * 浮层面板层级协调器（模块级单例）。
 *
 * 缺陷背景：层级计数器若声明在 FloatingPanel 的 `<script setup>` 内，每个面板实例各持一份，
 * 两个面板互相置顶会失效（各自从同一起点递增，谁先挂载谁在下）。
 *
 * 这里把「当前最高层级」提升为模块级共享，所有面板共用同一条递增序列，后点击/拖动者总能
 * 拿到更大的 z。序列上限刻意压在阶段遮罩（z-30）之下：接近上限时先按现有顺序整体下移重排，
 * 再分配新值，保证任何时刻浮层都盖不住暂停/结算遮罩。层级存于响应式 Map，重排会同步更新
 * 其它面板的层级（各面板订阅自己那一格）。
 *
 * 当前对局只有聊天一个浮层面板（玩家面板为常驻左栏、不参与层级竞争），压缩后的下限区远小于上限，重排不会触顶。
 */
import { computed, reactive, type ComputedRef } from 'vue'

/** 起始层级：低于阶段遮罩（z-30），也低于底部工具条（z-25），默认不压住工具条。 */
const BASE_Z_INDEX = 20
/** 固定上限（阶段遮罩 = z-30）：浮层层级不允许追平或超过。 */
const CEILING_Z_INDEX = 30

/** 当前存活面板 → 层级；响应式以便整体重排时其它面板同步降级。 */
const layers = reactive(new Map<symbol, number>())
/** 下一条待分配的层级，单调递增；接近上限时经重排回落。 */
let nextZIndex = BASE_Z_INDEX

interface PanelLayer {
  /** 面板实例的稳定标识（模块内部用于定位该面板的层级）。 */
  id: symbol
  /** 该面板当前层级；面板根节点直接绑定此值。 */
  zIndex: ComputedRef<number>
}

/** 登记一个新面板：分配唯一层级并返回句柄，调用方在卸载时用 id 注销。 */
export function registerPanelLayer(): PanelLayer {
  const id = Symbol('floating-panel')
  layers.set(id, allocateZIndex())
  return {
    id,
    zIndex: computed(() => layers.get(id) ?? BASE_Z_INDEX),
  }
}

/** 将指定面板提到最上层；其余面板保持相对顺序。 */
export function bringPanelToFront(id: symbol): void {
  if (!layers.has(id)) return
  layers.set(id, allocateZIndex())
}

/** 面板卸载时注销，避免 Map 随反复开关面板无限增长。 */
export function unregisterPanelLayer(id: symbol): void {
  layers.delete(id)
}

/** 分配下一个层级；若继续递增会触顶，先把现有面板压缩到下限区再分配。 */
function allocateZIndex(): number {
  if (nextZIndex + 1 >= CEILING_Z_INDEX) compactLayers()
  nextZIndex += 1
  return nextZIndex
}

/** 按现有层级升序重排为 BASE+1..BASE+n，保持面板间原有的前后关系。 */
function compactLayers(): void {
  const ordered = [...layers.entries()].sort((a, b) => a[1] - b[1])
  ordered.forEach(([id], index) => layers.set(id, BASE_Z_INDEX + index + 1))
  nextZIndex = BASE_Z_INDEX + ordered.length
}
