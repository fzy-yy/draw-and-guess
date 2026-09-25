<!--
  手写通用下拉选择原语（SelectDropdown）：替代原生 <select>，统一表单控件的视觉与可访问性。
  - v-model 绑定值；options 为 { value, label }[]（值类型 string | number，保持数字语义）；
  - 收起态为 button（aria-haspopup=listbox + aria-expanded + aria-controls + aria-activedescendant），
    无障碍名称由调用方经 labelledby / ariaLabel 关联（Playwright getByLabel 与
    testing-library getByLabelText 均识别 aria-labelledby）；
  - 展开态为 **fixed 视口锚定**面板：打开时按触发按钮 getBoundingClientRect 计算 left/top/width
    （宽度与按钮等宽、下方空间不足时向上翻转），面板不进入弹窗表单的滚动流、不被 overflow 裁剪；
    祖先滚动容器滚动或窗口 resize 即关闭（原生 select 语义；面板自身选项滚动不关闭）。
    仍留在弹窗 DOM 内不做 Teleport——保留 cqh 容器单位、focus-trap 与 aria 关联
    （与 ContextMenu 的取舍一致，见 docs/adr/0008；fixed 锚定的取舍见 docs/adr/0015）；
  - 键盘：Enter/Space/↓/↑ 打开并高亮当前项；↑↓ 移动（回绕）、Home/End 跳首尾、
    Enter/Space 选中、Esc 仅关闭下拉并阻断冒泡（防止 BaseDialog 把整个弹窗一起关掉）、
    Tab 关闭并放行焦点流转；
  - 交互音沿用全站语义：open / close / select。
-->
<script setup lang="ts" generic="V extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { playInteractionSound } from '@/audio'

export interface SelectDropdownOption<V extends string | number> {
  value: V
  label: string
}

const props = withDefaults(
  defineProps<{
    options: readonly SelectDropdownOption<V>[]
    disabled?: boolean
    /** 关联外部字段标签元素 id（RuleSelectField 用 span#id 提供名称）。 */
    labelledby?: string
    /** 无关联标签元素时的直接无障碍名称。 */
    ariaLabel?: string
  }>(),
  { disabled: false, labelledby: undefined, ariaLabel: undefined },
)

const model = defineModel<V>({ required: true })

/** 选项元素 id 前缀：useId 保证多实例共存时 aria-activedescendant 唯一。 */
const baseId = useId()

const isOpen = ref(false)
const rootRef = ref<HTMLElement>()
const triggerRef = ref<HTMLElement>()
const listRef = ref<HTMLElement>()
const activeIndex = ref(0)

/**
 * 面板 fixed 锚定样式（left/top/bottom/width/maxHeight，px 计算值）。
 * 内联 px 而非 Tailwind 类：坐标只能在打开瞬间从 getBoundingClientRect 得到；
 * 面板内部字号/圆角/边框仍用 cqh/em，容器单位按 DOM 祖先（.game-stage）照常解析。
 */
const panelStyle = ref<Record<string, string>>({})

/** 面板最大高度标尺（cqh）：与视觉规范一致，翻转判定也用同一数值。 */
const PANEL_MAX_CQH = 26
/** 触发按钮与面板的间距标尺（cqh）。 */
const PANEL_GAP_CQH = 0.3

/**
 * 依据触发按钮视口矩形计算锚定：宽度与按钮等宽；下方放不下整高面板且上方更宽裕时
 * 向上翻转；maxHeight 取「标尺高度」与「所选侧可用空间」较小者（超出部分面板内滚动）。
 */
function computePanelStyle(): void {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  // cqh 标尺换算：以舞台实际高度为 100cqh（无舞台祖先时退化为视口高度）
  const unitPx =
    (trigger.closest<HTMLElement>('.game-stage')?.clientHeight ?? window.innerHeight) / 100
  const gap = unitPx * PANEL_GAP_CQH
  const panelMax = unitPx * PANEL_MAX_CQH
  const availableBelow = window.innerHeight - rect.bottom - gap
  const availableAbove = rect.top - gap
  const placeAbove = availableBelow < panelMax && availableAbove > availableBelow
  const maxHeight = Math.max(60, Math.min(panelMax, placeAbove ? availableAbove : availableBelow))

  const style: Record<string, string> = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
  }
  if (placeAbove) style.bottom = `${window.innerHeight - rect.top + gap}px`
  else style.top = `${rect.bottom + gap}px`
  panelStyle.value = style
}

const selectedIndex = computed(() => {
  const index = props.options.findIndex((option) => option.value === model.value)
  return index < 0 ? 0 : index
})
const currentLabel = computed(() => props.options[selectedIndex.value]?.label ?? '')

function optionId(index: number): string {
  return `${baseId}-option-${index}`
}

function openDropdown(): void {
  if (isOpen.value) return
  isOpen.value = true
  activeIndex.value = selectedIndex.value
  // 先锚定再渲染：面板从第一帧就出现在正确视口位置，避免跳动
  computePanelStyle()
  playInteractionSound('open')
  void nextTick(scrollActiveIntoView)
}

function closeDropdown(): void {
  if (!isOpen.value) return
  isOpen.value = false
  playInteractionSound('close')
}

/**
 * 高亮项移出可视区时贴边滚动——**只滚面板自身**：
 * 原生 scrollIntoView 会连带滚动祖先滚动容器（弹窗表单区），而祖先滚动正是
 * 下面 onScrollClose 的关闭条件，会造成「打开瞬间自我关闭」的冲突。
 * （li 的 offsetParent 即 fixed 面板，offsetTop 天然相对面板内容坐标。）
 */
function scrollActiveIntoView(): void {
  const list = listRef.value
  const target = list?.querySelector<HTMLElement>(`[id="${optionId(activeIndex.value)}"]`)
  if (!list || !target) return
  const itemTop = target.offsetTop
  const itemBottom = itemTop + target.offsetHeight
  if (itemTop < list.scrollTop) list.scrollTop = itemTop
  else if (itemBottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = itemBottom - list.clientHeight
  }
}

function moveActive(delta: number): void {
  const count = props.options.length
  if (!count) return
  // 回绕移动：从末项按 ↓ 回到首项，与原生 select 键盘习惯一致
  activeIndex.value = (activeIndex.value + delta + count) % count
  void nextTick(scrollActiveIntoView)
}

function commit(index: number): void {
  const option = props.options[index]
  if (!option) return
  if (option.value !== model.value) {
    model.value = option.value
    playInteractionSound('select')
  }
  closeDropdown()
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (!isOpen.value) {
    if (
      event.key === 'Enter' ||
      event.key === ' ' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp'
    ) {
      // 阻止 Enter/Space 的原生 button click（否则 click 处理器会再切换一次开关）
      event.preventDefault()
      openDropdown()
    }
    return
  }
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Home':
      event.preventDefault()
      activeIndex.value = 0
      void nextTick(scrollActiveIntoView)
      break
    case 'End':
      event.preventDefault()
      activeIndex.value = Math.max(0, props.options.length - 1)
      void nextTick(scrollActiveIntoView)
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      commit(activeIndex.value)
      break
    case 'Escape':
      // 只关下拉：阻断冒泡，避免 BaseDialog 的 document 级 Esc 监听把弹窗一起关掉
      event.preventDefault()
      event.stopPropagation()
      closeDropdown()
      break
    case 'Tab':
      // 放行焦点流转，仅收起面板
      isOpen.value = false
      break
  }
}

/** 面板外 pointerdown 关闭下拉（HTMLElement 判定包含关系，null 目标视为外部）。 */
function onDocumentPointerDown(event: PointerEvent): void {
  if (!rootRef.value?.contains(event.target as HTMLElement | null)) closeDropdown()
}

/**
 * 祖先滚动容器滚动 / 窗口 resize 即关闭下拉（原生 select 语义）：
 * fixed 面板锚定在打开瞬间计算的视口坐标，一旦宿主表单滚动就会与触发按钮脱节，
 * 与其每帧重算跟随，不如直接关闭（取舍见 docs/adr/0015）。
 * 面板自身选项列表的滚动不算「脱节」，不触发关闭。
 */
function onScrollClose(event: Event): void {
  if (listRef.value && listRef.value.contains(event.target as Node | null)) return
  closeDropdown()
}

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    // capture：弹窗表单区等任意祖先滚动容器都能捕获到
    window.addEventListener('scroll', onScrollClose, true)
    window.addEventListener('resize', onScrollClose)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    window.removeEventListener('scroll', onScrollClose, true)
    window.removeEventListener('resize', onScrollClose)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('scroll', onScrollClose, true)
  window.removeEventListener('resize', onScrollClose)
})
</script>

<template>
  <div ref="rootRef" class="min-w-0">
    <button
      ref="triggerRef"
      type="button"
      role="combobox"
      class="ui-feedback flex h-[5.2cqh] w-full min-w-0 items-center justify-between gap-[0.6em] rounded-[0.7em] border-[0.2cqh] border-control bg-white px-[1em] text-left font-bold text-navy outline-none focus-visible:border-navy disabled:cursor-not-allowed disabled:opacity-50"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      :aria-controls="isOpen ? `${baseId}-list` : undefined"
      :aria-activedescendant="isOpen ? optionId(activeIndex) : undefined"
      :aria-labelledby="labelledby"
      :aria-label="ariaLabel"
      :disabled="disabled"
      @keydown="onTriggerKeydown"
      @click="isOpen ? closeDropdown() : openDropdown()"
    >
      <span class="min-w-0 flex-1 truncate">{{ currentLabel }}</span>
      <ChevronDown
        class="h-[2.4cqh] w-[2.4cqh] shrink-0 text-muted transition-transform"
        :class="{ 'rotate-180': isOpen }"
        aria-hidden="true"
      />
    </button>

    <!-- mousedown.prevent：保持焦点在触发按钮上，键盘焦点链与 aria-activedescendant 不漂移 -->
    <ul
      v-if="isOpen"
      :id="`${baseId}-list`"
      ref="listRef"
      :style="panelStyle"
      :aria-labelledby="labelledby"
      :aria-label="ariaLabel"
      role="listbox"
      class="fixed z-40 overflow-y-auto overscroll-contain rounded-[0.7em] border-[0.2cqh] border-control bg-white py-[0.4cqh] shadow-float"
      @mousedown.prevent
    >
      <li
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="String(option.value)"
        role="option"
        :aria-selected="option.value === model"
        class="ui-feedback flex cursor-pointer items-center justify-between gap-[0.5em] px-[1em] py-[0.7cqh] font-bold text-navy"
        :class="index === activeIndex ? 'bg-sky' : 'hover:bg-line'"
        @click="commit(index)"
        @mouseenter="activeIndex = index"
      >
        <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
        <Check v-if="option.value === model" class="h-[2.6cqh] w-[2.6cqh] shrink-0 text-blue" />
      </li>
    </ul>
  </div>
</template>
