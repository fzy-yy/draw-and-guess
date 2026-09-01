<!--
  统一游戏弹窗外壳：舞台内遮罩 + 对话框卡片 + 可选标题栏（含关闭钮）+ 可选底部操作区。
  收敛原本分散在各视图的 `.stage-overlay` / `.game-dialog` / header / footer 长串行内类。
  - 标准弹窗：传 closeAria 显示标题栏与关闭按钮，header 槽放眉题 + 标题。
  - 确认弹窗：不传 closeAria（无标题栏），用 sectionClass 追加居中布局，footerClass 微调底部按钮区。
  - Esc / 关闭按钮统一触发 close 事件（顺带统一了键盘可访问性）。
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 卡片宽度类（Tailwind），如 w-[58cqw]；不传则无默认宽度 */
    widthClass?: string
    /** 追加到卡片 section 的类（用于确认弹窗的居中/间距布局） */
    sectionClass?: string
    /** 追加到底部操作区的类（用于确认弹窗的整行/上边距） */
    footerClass?: string
    labelledby?: string
    ariaLabel?: string
    /** 若提供则在标题栏渲染关闭按钮，并提供关闭语义 */
    closeAria?: string
  }>(),
  {
    widthClass: '',
    sectionClass: '',
    footerClass: '',
    labelledby: undefined,
    ariaLabel: undefined,
    closeAria: undefined,
  },
)

const emit = defineEmits<{ close: [] }>()

/**
 * 可访问性：Esc 关闭 + 初始聚焦 + Tab 焦点陷阱 + 关闭后焦点还原。
 * Esc 放在 document 级，确保焦点不在弹窗内时也能关闭；监听仅在 `open` 为 true 期间挂载，
 * 这样条件挂载式与常驻式弹窗两种用法下行为一致，也不会出现常驻监听被多实例反复触发。
 */
const dialogRef = ref<HTMLElement>()
/** 打开弹窗前的焦点元素，关闭后归还，避免键盘用户丢失位置。 */
let previouslyFocused: HTMLElement | null = null

/** 枚举弹窗内当前可聚焦元素（跳过禁用与不可见项），用于 Tab 循环。 */
function focusableItems(): HTMLElement[] {
  if (!dialogRef.value) return []
  return Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  // 焦点陷阱：Tab 只在弹窗内部循环，不会跑到遮罩后面的页面内容上
  if (event.key !== 'Tab') return
  const items = focusableItems()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  if (event.shiftKey && (active === first || !dialogRef.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/** 关闭时解除监听并把焦点还给触发元素。 */
function releaseFocus(): void {
  document.removeEventListener('keydown', handleKeydown)
  if (previouslyFocused?.isConnected) previouslyFocused.focus()
  previouslyFocused = null
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeydown)
      previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      // 聚焦卡片本身（tabindex=-1）：不显示焦点环，但让后续 Tab 从弹窗内部开始
      dialogRef.value?.focus()
    } else {
      releaseFocus()
    }
  },
  { immediate: true },
)
onBeforeUnmount(releaseFocus)
</script>

<template>
  <!-- 用 <Transition name="modal"> 包裹，让遮罩淡入淡出、对话框同步缩放（见 index.css 的 modal-* 钩子）。
       v-if="open" 放在内部根元素上，保证 enter/leave 只在开关时触发，Esc/关闭钮行为不变。 -->
  <Transition name="modal">
    <div
      v-if="open"
      class="absolute inset-0 z-30 grid place-items-center bg-[#0f172acc] px-[5cqw] py-[4cqh]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledby"
      :aria-label="ariaLabel"
    >
      <section
        ref="dialogRef"
        tabindex="-1"
        class="game-dialog flex max-h-[86cqh] flex-col overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper text-ink shadow-[0_1.4cqh_4cqh_#0007] outline-none"
        :class="[widthClass, sectionClass]"
      >
        <header
          v-if="closeAria"
          class="flex min-h-[9cqh] items-center justify-between bg-navy px-[1.7em] py-[1.3cqh] text-white"
        >
          <div><slot name="header" /></div>
          <button
            type="button"
            class="grid h-[4cqh] w-[4cqh] place-items-center rounded-full bg-white/10 text-white text-[1.2em]"
            :aria-label="closeAria"
            @click="emit('close')"
          >
            <X />
          </button>
        </header>
        <slot />
        <footer
          v-if="$slots.footer"
          class="flex min-h-[8cqh] items-center justify-end gap-[0.8em] bg-slate-200 px-[1.7em] py-[1cqh]"
          :class="footerClass"
        >
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Transition>
</template>
