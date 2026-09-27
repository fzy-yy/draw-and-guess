<!--
  通用右键菜单：在指针处弹出的白底动作列表，菜单项由调用方按场景提供。

  设计约束（取舍原因见 docs/adr/0008-context-menu-singleton-vs-teleport.md）：
  - 组件在舞台根层级渲染（absolute inset-0 的透明层），菜单因此永远不会被中间容器的
    overflow 裁剪，也不会像 Teleport 到 body 那样丢失 cqh/cqw/em 的容器单位上下文；
  - 组件本身不持有业务状态：可见性走 v-model:open，菜单项与落点走 props，激活只 emit select，
    于是「不同场景弹不同列表」只是调用方换一份 items（状态侧见 composables/useContextMenu.ts）；
  - 定位以最近定位祖先（游戏舞台）为坐标系：先按指针同步定位，再量取面板尺寸做翻转与夹取
    （纯函数见 context-menu-position.ts），保证菜单始终完整可见；
  - 关闭时机：Esc / Tab / 点击外部 / 窗口失焦 / 窗口缩放 / 任意祖先滚动（面板内部滚动除外），
    避免菜单停留在过期位置；Esc 在捕获阶段终止传播，不会顺手关掉下层弹窗；
  - 面板透明层为 pointer-events-none，只有面板自身接收指针事件，因此「点外关闭」这一次点击
    会穿透给下层 UI，与 ActionPopover 的关闭语义保持一致。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import type { ContextMenuItem } from '@/composables/useContextMenu'
import {
  resolveContextMenuPosition,
  type ContextMenuAnchor,
  type ContextMenuOffset,
} from './context-menu-position'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    /** 本次场景的菜单项（空列表不渲染菜单）。 */
    items: readonly ContextMenuItem[]
    /** 右键事件的视口坐标（clientX / clientY），组件负责换算成舞台内坐标。 */
    x: number
    y: number
    /** 菜单的无障碍名称；缺省取 strings.common.contextMenuAria。 */
    ariaLabel?: string
  }>(),
  { ariaLabel: undefined },
)

const emit = defineEmits<{ select: [item: ContextMenuItem] }>()

/** 常驻透明定位层：既是坐标原点，也是夹取边界。 */
const layer = ref<HTMLElement>()
const panel = ref<HTMLElement>()
/** 面板最终偏移（舞台内 px）；未测量时为 undefined，首帧回退到落点。 */
const offset = ref<ContextMenuOffset>()
/** 舞台内落点：首帧定位与翻转时的动画原点都以它为准。 */
const anchor = ref<ContextMenuAnchor>()
/** 打开前的焦点元素，关闭后归还（右键不改变焦点语义，因此必须还回去）。 */
const previousFocus = ref<HTMLElement>()

const isVisible = computed(() => open.value && props.items.length > 0)
const label = computed(() => props.ariaLabel ?? strings.common.contextMenuAria)
/** 实际生效的偏移：测量完成前回退到落点，避免先闪到舞台左上角。 */
const point = computed<ContextMenuAnchor | undefined>(() => {
  const resolved = offset.value
  return resolved ? { x: resolved.left, y: resolved.top } : anchor.value
})
const panelStyle = computed(() => {
  const position = point.value
  const origin = anchor.value
  return {
    left: `${position?.x ?? 0}px`,
    top: `${position?.y ?? 0}px`,
    // 动画原点取指针所在的那一角：翻转到落点左/上时菜单右/下边缘贴着指针，原点随之换边
    transformOrigin:
      position && origin && offset.value
        ? `${position.x < origin.x ? 'right' : 'left'} ${position.y < origin.y ? 'bottom' : 'top'}`
        : 'left top',
  }
})

/** 面板内当前可用（未禁用）的菜单项按钮。 */
function enabledItems(): HTMLElement[] {
  return Array.from(
    panel.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
  )
}

/** 聚焦首/末个可用项；没有可用项时退化为聚焦面板本身。 */
function focusItem(edge: 'first' | 'last'): void {
  const buttons = enabledItems()
  const target = edge === 'first' ? buttons.at(0) : buttons.at(-1)
  ;(target ?? panel.value)?.focus({ preventScroll: true })
}

/** 上下移动焦点并循环；焦点不在菜单内时按方向落到首/末项。 */
function moveFocus(delta: number): void {
  const buttons = enabledItems()
  if (!buttons.length) {
    panel.value?.focus({ preventScroll: true })
    return
  }
  const current = buttons.findIndex((button) => button === document.activeElement)
  const next =
    current === -1
      ? delta > 0
        ? 0
        : buttons.length - 1
      : (current + delta + buttons.length) % buttons.length
  buttons.at(next)?.focus({ preventScroll: true })
}

function close(): void {
  if (!open.value) return
  open.value = false
}

/** 激活菜单项：先收起菜单再交回调用方，避免动作里弹出的弹窗被菜单压住。 */
function activate(item: ContextMenuItem): void {
  if (item.disabled) return
  close()
  emit('select', item)
}

/** 量取指针相对舞台的落点；首帧同步调用，保证面板不会先闪到左上角。 */
function measureAnchor(): ContextMenuAnchor | undefined {
  const element = layer.value
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  return { x: props.x - rect.left, y: props.y - rect.top }
}

/** 量取面板尺寸（offsetWidth 为布局尺寸，不受入场缩放动画影响）后做翻转与夹取。 */
function reposition(): void {
  const element = layer.value
  const menu = panel.value
  const next = measureAnchor()
  if (!element || !menu || !next) return
  const bounds = element.getBoundingClientRect()
  anchor.value = next
  // 留白缺省按舞台高度等比放大（与舞台圆角、整体留白同步），见 context-menu-position.ts
  offset.value = resolveContextMenuPosition(
    next,
    { width: menu.offsetWidth, height: menu.offsetHeight },
    { width: bounds.width, height: bounds.height },
  )
}

function handleKeydown(event: KeyboardEvent): void {
  if (!isVisible.value) return
  switch (event.key) {
    case 'Escape':
      // 捕获阶段就地终止：这一次 Esc 只关菜单，不再冒泡去关下层弹窗
      event.preventDefault()
      event.stopPropagation()
      close()
      break
    // Tab 是「离开菜单」的语义：不拦截移动，只收起菜单
    case 'Tab':
      close()
      break
    case 'ArrowDown':
      event.preventDefault()
      moveFocus(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveFocus(-1)
      break
    case 'Home':
      event.preventDefault()
      focusItem('first')
      break
    case 'End':
      event.preventDefault()
      focusItem('last')
      break
    default:
      break
  }
}

/** 任何祖先容器滚动都会让菜单脱离语义位置，直接收起；面板自身滚动（内容超高）除外。 */
function handleScroll(event: Event): void {
  const element = panel.value
  if (element && event.composedPath().includes(element)) return
  close()
}

// 打开：记录来源焦点 + 弹出音；关闭：收起音 + 归还焦点。
watch(open, (isOpen) => {
  if (isOpen) {
    previousFocus.value =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : undefined
    playInteractionSound('open')
    return
  }
  playInteractionSound('close')
  const target = previousFocus.value
  previousFocus.value = undefined
  if (target?.isConnected) target.focus({ preventScroll: true })
})

// 每次出现（或打开状态下换场景换落点）都重新定位并聚焦首项：同一次状态变更只跑一遍。
// immediate：调用方挂载时就已经 open=true 的场景也要立刻定位，不能等到下一次 prop 变化。
watch(
  () => [isVisible.value, props.x, props.y, props.items] as const,
  async ([visible]) => {
    if (!visible) return
    offset.value = undefined
    anchor.value = measureAnchor()
    await nextTick()
    reposition()
    focusItem('first')
  },
  { immediate: true },
)

onClickOutside(panel, close)
useEventListener(document, 'keydown', handleKeydown, { capture: true })
useEventListener(window, 'resize', close)
useEventListener(window, 'blur', close)
useEventListener(document, 'scroll', handleScroll, { capture: true, passive: true })
</script>

<template>
  <div ref="layer" class="pointer-events-none absolute inset-0 z-50">
    <Transition name="context-menu" appear>
      <div
        v-if="isVisible"
        ref="panel"
        role="menu"
        tabindex="-1"
        :aria-label="label"
        class="pointer-events-auto absolute max-h-[70cqh] w-max max-w-[22cqw] min-w-[10em] overflow-y-auto overscroll-contain rounded-[0.7em] border-[0.18cqh] border-line bg-white p-[0.35em] shadow-float outline-hidden"
        :style="panelStyle"
      >
        <template v-for="item in items" :key="item.id">
          <div
            v-if="item.separatorBefore"
            role="separator"
            class="my-[0.35cqh] h-[0.18cqh] bg-line"
          />
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            :disabled="item.disabled"
            :class="[
              // 菜单项纵向密排：命中区即视觉尺寸（触控契约已废除），
              // 高度由文字行高与上下内边距（相对单位）自然撑开
              'ui-feedback flex w-full items-center gap-[0.6em] rounded-[0.5em] px-[0.7em] py-[0.5cqh] text-left text-fs-14 font-bold',
              item.disabled
                ? 'text-muted'
                : item.danger
                  ? 'text-red hover:bg-red/10'
                  : 'text-navy hover:bg-sky',
            ]"
            @click="activate(item)"
          >
            <component
              :is="item.icon"
              v-if="item.icon"
              class="h-[2.1cqh] w-[2.1cqh]"
              aria-hidden="true"
            />
            <span class="min-w-0 truncate">{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>
