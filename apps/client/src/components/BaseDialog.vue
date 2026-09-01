<!--
  统一游戏弹窗外壳：舞台内遮罩 + 对话框卡片 + 可选标题栏（含关闭钮）+ 可选底部操作区。
  收敛原本分散在各视图的 `.stage-overlay` / `.game-dialog` / header / footer 长串行内类。
  - 标准弹窗：传 closeAria 显示标题栏与关闭按钮，header 槽放眉题 + 标题。
  - 确认弹窗：不传 closeAria（无标题栏），用 sectionClass 追加居中布局，footerClass 微调底部按钮区。
  - Esc / 关闭按钮统一触发 close 事件（顺带统一了键盘可访问性）。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
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

/** P2：在 document 级监听 Esc，确保弹窗无论焦点在哪都能可靠关闭（原仅在遮罩 div 上，焦点在外时失效）。 */
function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
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
      @keydown.esc="emit('close')"
    >
      <section
        class="game-dialog flex max-h-[86cqh] flex-col overflow-hidden rounded-[1.2em] border-[0.35cqh] border-white bg-paper text-ink shadow-[0_1.4cqh_4cqh_#0007]"
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
