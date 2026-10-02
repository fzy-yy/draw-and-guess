<!--
  统一游戏弹窗外壳：舞台内遮罩 + 对话框卡片 + 可选标题栏（含关闭钮）+ 可选底部操作区。
  收敛原本分散在各视图的 `.stage-overlay` / `.game-dialog` / header / footer 长串行内类。
  - 标准弹窗：传 closeAria 显示标题栏与关闭按钮，header 槽放眉题 + 标题。
  - 确认弹窗：不传 closeAria（无标题栏），用 sectionClass 追加居中布局，footerClass 微调底部按钮区。
  - Esc / 关闭按钮统一触发 close 事件；系统阻断框可用 dismissible=false 禁止关闭。
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useFocusTrap } from '@vueuse/integrations/useFocusTrap'
import { X } from 'lucide-vue-next'
import { playInteractionSound } from '@/audio'
import { selectTopmostDialog } from './dialog-stack'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
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
    /** 不可关闭的系统阻断弹窗传 false：禁用 Esc 与关闭按钮。 */
    dismissible?: boolean
    /** 遮罩层级等附加类；系统断线提示需高于普通弹窗与 Toast。 */
    overlayClass?: string
  }>(),
  {
    widthClass: '',
    sectionClass: '',
    footerClass: '',
    labelledby: undefined,
    ariaLabel: undefined,
    closeAria: undefined,
    dismissible: true,
    overlayClass: 'z-30',
  },
)

const emit = defineEmits<{ close: [] }>()

function closeDialog(): void {
  if (!props.dismissible) return
  playInteractionSound('close')
  open.value = false
  emit('close')
}

/**
 * 可访问性：Esc 关闭 + 初始聚焦 + Tab 焦点陷阱 + 关闭后焦点还原。
 * Tab 循环、初始聚焦与焦点归还原处交由 @vueuse/integrations 的 useFocusTrap 接管
 * （其内部基于 focus-trap 实现：激活时聚焦容器/首个可聚焦项、Tab/shift+Tab 循环、
 * 失活时把焦点还给触发元素）。
 * Esc 关闭与多弹窗顶层仲裁仍需自行处理：useFocusTrap 不响应 Escape，且本项目
 * 在断线瞬间可能同时存在多个弹窗，只有视觉层级最高者才应响应键盘。
 */
const overlayRef = ref<HTMLElement>()
const dialogRef = ref<HTMLElement>()

// useFocusTrap：挂载到对话框卡片（section，tabindex=-1）。immediate 关闭以便在 open 时手动激活。
// fallbackFocus 指向容器本身：系统阻断框等可能没有任何可聚焦按钮，focus-trap 要求至少一个
// tabbable 节点，此时把 fallback 设为容器（tabindex=-1）即可保证它能聚焦而不抛错。
const { activate: activateTrap, deactivate: deactivateTrap } = useFocusTrap(dialogRef, {
  immediate: false,
  // 初始聚焦从容器内部第一个可聚焦项开始（卡片本身为 -1，不会被选中）。
  initialFocus: false,
  // 失活后把焦点还给打开前的触发元素，避免键盘用户丢失位置。
  returnFocusOnDeactivate: true,
  // 允许点击弹窗外部元素（如 Toast 提示条），避免 focus-trap 在捕获阶段吞掉外部点击
  allowOutsideClick: true,
  // 无任何可聚焦节点时兜底聚焦容器，避免 focus-trap 抛“至少一个 tabbable 节点”错误。
  fallbackFocus: () => dialogRef.value as HTMLElement,
})

/**
 * 多个弹窗可能在断线瞬间同时存在；只允许视觉层级最高者处理键盘，
 * 防止系统阻断框在最上层时，底层普通弹窗仍响应 Esc 并把焦点还到游戏控件。
 * 注意：仲裁集合按 [role="dialog"] 全局查询——ActionPopover 面板同为 role=dialog，
 * 也会进入该集合。两处隐性耦合：依赖 ActionPopover 根节点的 @keydown.esc.stop
 * 在其打开期间先截获 Esc，键盘事件不落至本文件的 document 级监听（互指说明见
 * ActionPopover.vue 的 Esc 截获注释，两侧须同步维护）。
 */
function isTopmostDialog(): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(
    (element) => element.offsetParent !== null,
  )
  const topmost = selectTopmostDialog(
    dialogs,
    (element) => element.offsetParent !== null,
    (element) => Number.parseInt(window.getComputedStyle(element).zIndex, 10) || 0,
  )
  return topmost === overlayRef.value
}

/** 只处理 Esc 关闭；Tab 循环由 useFocusTrap 负责。不处于顶层弹窗时直接忽略。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isTopmostDialog()) return
  event.stopImmediatePropagation()
  event.preventDefault()
  // dismissible 门禁只在 closeDialog 内保留一道：Esc 与模板关闭钮共用同一守卫，不再双重判断
  closeDialog()
}

/** 打开/关闭弹窗时同步激活/失活焦点陷阱，并在失活时归还焦点。 */
function releaseFocus(): void {
  document.removeEventListener('keydown', handleKeydown)
  deactivateTrap()
}

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      playInteractionSound('open')
      document.addEventListener('keydown', handleKeydown)
      await nextTick()
      // 激活焦点陷阱：让 Tab 循环从弹窗内部开始，初次聚焦进入容器。
      activateTrap()
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
  <Transition name="modal" appear>
    <div
      v-if="open"
      ref="overlayRef"
      class="absolute inset-0 grid place-items-center bg-navy/80 px-[5cqw] py-[4cqh]"
      :class="overlayClass"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledby"
      :aria-label="ariaLabel"
    >
      <section
        ref="dialogRef"
        tabindex="-1"
        class="game-dialog dialog-shell outline-hidden"
        :class="[widthClass, sectionClass]"
      >
        <header
          v-if="closeAria || $slots.header"
          class="flex min-h-[9cqh] items-center justify-between bg-navy px-[1.7em] py-[1.3cqh] text-white"
        >
          <div><slot name="header" /></div>
          <button
            v-if="closeAria && dismissible"
            type="button"
            class="grid h-[4cqh] w-[4cqh] place-items-center rounded-full bg-white/10 text-white text-fs-18"
            :aria-label="closeAria"
            @click="closeDialog"
          >
            <X />
          </button>
        </header>
        <slot />
        <footer
          v-if="$slots.footer"
          class="flex min-h-[8cqh] items-center justify-end gap-[0.8em] bg-line px-[1.7em] py-[1cqh]"
          :class="footerClass"
        >
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Transition>
</template>
