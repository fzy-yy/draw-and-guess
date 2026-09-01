<!-- 游戏内设置页：使用分页布局避免舞台内长列表和可见滚动条。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  Brush,
  Eraser,
  Eye,
  Keyboard,
  PaintBucket,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
} from 'lucide-vue-next'
import { useClipboard } from '@vueuse/core'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import AudioTab from '@/components/settings/AudioTab.vue'
import AccessibilityTab from '@/components/settings/AccessibilityTab.vue'
import ShortcutsTab from '@/components/settings/ShortcutsTab.vue'
import DiagnosticsTab from '@/components/settings/DiagnosticsTab.vue'

const store = useGameStore()
// 当前激活的设置分类标签
const tab = ref<'audio' | 'accessibility' | 'shortcuts' | 'diagnostics'>('audio')
const shortcutError = ref('') // 快捷键错误提示文案
const showAvatarPicker = ref(false) // 资料页复用的内置 SVG 头像选择弹窗
// 可自定义的快捷键设置键名类型
type ShortcutSettingKey = 'penShortcut' | 'eraserShortcut' | 'fillShortcut'

// 快捷键配置行：设置键、中文名（来自 strings）、说明与图标
const shortcutRows: Array<{
  setting: ShortcutSettingKey
  name: string
  detail: string
  icon: typeof Brush
}> = [
  {
    setting: 'penShortcut',
    name: strings.settings.pen,
    detail: strings.settings.penDetail,
    icon: Brush,
  },
  {
    setting: 'eraserShortcut',
    name: strings.settings.eraser,
    detail: strings.settings.eraserDetail,
    icon: Eraser,
  },
  {
    setting: 'fillShortcut',
    name: strings.settings.fill,
    detail: strings.settings.fillDetail,
    icon: PaintBucket,
  },
]

// 诊断信息：当前页面来源（host）作为服务地址展示
const serverAddress = location.origin
// 汇总连接与身份诊断文本，供一键复制排障（统一文案来自 strings.settings.diag*）
const diagnostic = computed(() =>
  [
    strings.settings.diagAppLine(store.config.app.name, store.config.app.version),
    strings.settings.diagProtocol(store.config.app.protocolVersion),
    strings.settings.diagAddress(serverAddress),
    strings.settings.diagConnection(store.connectionLabel),
    strings.settings.diagLatency(
      store.latency ? String(store.latency) : strings.settings.unknownLatency,
    ),
    strings.settings.diagPlayerId(
      store.playerId ? `${store.playerId.slice(0, 8)}…` : strings.settings.notLoggedIn,
    ),
    strings.settings.diagRoom(store.room?.name ?? strings.settings.noRoom),
  ].join('\n'),
)

// 剪切板写入交给 @vueuse/core 的 useClipboard 统一处理：优先原生 API，失败后自动走 execCommand 降级（legacy）。
const { copy: copyToClipboard } = useClipboard({ legacy: true })

/**
 * 复制脱敏后的诊断信息到剪贴板。
 * useClipboard 内置 execCommand 降级（legacy），无需再手写 textarea 分支；
 * 其 copy 在完成写入后标记成功，能力缺失时不产生副作用，据此判断成功与否并提示。
 */
async function copyDiagnostics(): Promise<void> {
  let copied = false
  try {
    await copyToClipboard(diagnostic.value)
    copied = true
  } catch {
    copied = false
  }
  store.notify(
    copied ? strings.settings.copied : strings.settings.copyFailed,
    copied ? 'success' : 'warning',
  )
}

/**
 * 捕获一个不带修饰键的可打印字符作为工具快捷键。
 * 重复键会被拒绝，避免一次按键对应多个工具；输入框本身只展示结果，不接收普通文本编辑。
 */
function captureShortcut(setting: ShortcutSettingKey, event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.trim().length !== 1) {
    shortcutError.value = strings.settings.shortcutErrorSimple
    return
  }
  const next = event.key.toLocaleLowerCase()
  const conflict = shortcutRows.find(
    (row) => row.setting !== setting && store.settings[row.setting].toLocaleLowerCase() === next,
  )
  if (conflict) {
    shortcutError.value = strings.settings.shortcutErrorConflict(next, conflict.name)
    return
  }
  store.settings[setting] = next
  store.saveSettings()
  shortcutError.value = ''
}
</script>

<template>
  <!-- 设置子页骨架：顶栏 + 标签栏 + 正文四段（声音/显示/快捷键/资料诊断） -->
  <main class="grid h-full grid-rows-[11%_9%_minmax(0,1fr)] bg-[#eef2ff]">
    <!-- 顶栏：返回大厅 / 标题 / 只保存在本机的提示 -->
    <header
      class="grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.45cqh] border-yellow bg-navy px-[2cqw] text-white"
    >
      <button
        type="button"
        class="justify-self-start flex items-center gap-[0.45em] rounded-[0.55em] bg-white/10 px-[0.8em] py-[0.8cqh] text-white"
        @click="store.page = 'lobby'"
      >
        <ArrowLeft /> {{ strings.settings.backToLobby }}
      </button>
      <div class="text-center">
        <p class="text-[#93c5fd] font-black tracking-[0.16em] text-[0.72em]">
          {{ strings.settings.label }}
        </p>
        <h1 class="text-[1.25em]">{{ strings.settings.title }}</h1>
      </div>
      <span class="justify-self-end flex items-center gap-[0.4em] text-[#bfdbfe] text-[0.72em]"
        ><ShieldCheck /> {{ strings.settings.localOnly }}</span
      >
    </header>
    <!-- 分类标签：声音 / 显示与操作 / 快捷键 / 资料与诊断 -->
    <nav
      class="flex justify-center gap-[0.5em] border-b-[0.18cqh] border-line bg-white p-[1cqh]"
      :aria-label="strings.settings.categoryAria"
    >
      <button
        type="button"
        class="bg-transparent flex min-w-[13cqw] items-center justify-center gap-[0.45em] border-b-[0.35cqh] border-transparent font-extrabold text-slate-600"
        :class="{ '!border-b-blue !text-blue': tab === 'audio' }"
        @click="tab = 'audio'"
      >
        <Volume2 />{{ strings.settings.tabAudio }}</button
      ><button
        type="button"
        class="bg-transparent flex min-w-[13cqw] items-center justify-center gap-[0.45em] border-b-[0.35cqh] border-transparent font-extrabold text-slate-600"
        :class="{ '!border-b-blue !text-blue': tab === 'accessibility' }"
        @click="tab = 'accessibility'"
      >
        <Eye />{{ strings.settings.tabAccessibility }}</button
      ><button
        type="button"
        class="bg-transparent flex min-w-[13cqw] items-center justify-center gap-[0.45em] border-b-[0.35cqh] border-transparent font-extrabold text-slate-600"
        :class="{ '!border-b-blue !text-blue': tab === 'shortcuts' }"
        @click="tab = 'shortcuts'"
      >
        <Keyboard />{{ strings.settings.tabShortcuts }}</button
      ><button
        type="button"
        class="bg-transparent flex min-w-[13cqw] items-center justify-center gap-[0.45em] border-b-[0.35cqh] border-transparent font-extrabold text-slate-600"
        :class="{ '!border-b-blue !text-blue': tab === 'diagnostics' }"
        @click="tab = 'diagnostics'"
      >
        <SlidersHorizontal />{{ strings.settings.tabDiagnostics }}
      </button>
    </nav>

    <!-- 声音设置 -->
    <AudioTab v-if="tab === 'audio'" />
    <!-- 显示与操作设置 -->
    <AccessibilityTab v-else-if="tab === 'accessibility'" />
    <!-- 快捷键设置 -->
    <ShortcutsTab
      v-else-if="tab === 'shortcuts'"
      :rows="shortcutRows"
      :error="shortcutError"
      @capture="captureShortcut"
    />
    <!-- 资料与诊断 -->
    <DiagnosticsTab
      v-else
      :diagnostic="diagnostic"
      :server-address="serverAddress"
      :show-avatar-picker="showAvatarPicker"
      @update:show-avatar-picker="showAvatarPicker = $event"
      @copy="copyDiagnostics"
    />
  </main>
</template>
