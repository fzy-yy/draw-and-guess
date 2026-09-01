<!-- 游戏内设置页：使用分页布局避免舞台内长列表和可见滚动条。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  Clipboard,
  Brush,
  Eraser,
  Eye,
  Keyboard,
  Music2,
  PaintBucket,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Volume2,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import AvatarPickerDialog from '@/components/AvatarPickerDialog.vue'
import { useGameStore } from '@/stores/game'

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

/**
 * 复制脱敏后的诊断信息到剪贴板。
 * 局域网 HTTP 属非安全上下文，navigator.clipboard 可能不存在，需降级到 execCommand。
 */
async function copyDiagnostics(): Promise<void> {
  const text = diagnostic.value
  let copied = false
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      // 安全上下文内也可能因权限被拒，继续走降级方案
    }
  }
  if (!copied) {
    // 非安全上下文降级：隐藏 textarea + execCommand('copy')
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    document.body.removeChild(textarea)
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

    <!-- 声音设置：主音量 / 音效音量 / 背景音乐 / 全部静音 -->
    <section v-if="tab === 'audio'" class="min-h-0 px-[9cqw] py-[3cqh]">
      <div class="flex items-center gap-[1.2em] mb-[2.5cqh]">
        <Music2 class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
        <div>
          <h2>{{ strings.settings.audioTitle }}</h2>
          <p class="mt-[0.5cqh] text-muted text-[0.72em]">{{ strings.settings.audioIntro }}</p>
        </div>
      </div>
      <div class="flex flex-col gap-[1.2cqh]">
        <label
          class="grid min-h-[8cqh] grid-cols-[1.2fr_1.8fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-col"
            ><b>{{ strings.settings.masterVolume }}</b
            ><small class="text-muted text-[0.7em]">{{
              strings.settings.masterVolumeHint
            }}</small></span
          ><input
            v-model.number="store.settings.masterVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="accent-blue"
            @change="store.saveSettings"
          /><strong>{{ Math.round(store.settings.masterVolume * 100) }}%</strong></label
        >
        <label
          class="grid min-h-[8cqh] grid-cols-[1.2fr_1.8fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-col"
            ><b>{{ strings.settings.soundVolume }}</b
            ><small class="text-muted text-[0.7em]">{{
              strings.settings.soundVolumeHint
            }}</small></span
          ><input
            v-model.number="store.settings.soundVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="accent-blue"
            @change="store.saveSettings"
          /><strong>{{ Math.round(store.settings.soundVolume * 100) }}%</strong></label
        >
        <label
          class="grid min-h-[8cqh] grid-cols-[1.2fr_1.8fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-col"
            ><b>{{ strings.settings.musicVolume }}</b
            ><small class="text-muted text-[0.7em]">{{
              strings.settings.musicVolumeHint
            }}</small></span
          ><input
            v-model.number="store.settings.musicVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="accent-blue"
            @change="store.saveSettings"
          /><strong>{{ Math.round(store.settings.musicVolume * 100) }}%</strong></label
        >
        <label
          class="grid min-h-[8cqh] grid-cols-[1fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-col"
            ><b>{{ strings.settings.muted }}</b
            ><small class="text-muted text-[0.7em]">{{ strings.settings.mutedHint }}</small></span
          ><input
            v-model="store.settings.muted"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
        /></label>
      </div>
    </section>

    <!-- 显示与操作设置：动画 / 快捷键提示 / 自动聚焦 / 发现与邀请开关 -->
    <section v-else-if="tab === 'accessibility'" class="min-h-0 px-[9cqw] py-[3cqh]">
      <div class="flex items-center gap-[1.2em] mb-[2.5cqh]">
        <Eye class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
        <div>
          <h2>{{ strings.settings.accessibilityTitle }}</h2>
          <p class="mt-[0.5cqh] text-muted text-[0.72em]">
            {{ strings.settings.accessibilityIntro }}
          </p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-[1.2cqh_1em]">
        <label
          class="flex min-h-[8cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.animations }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.animationsHint
            }}</small></span
          ><input
            v-model="store.settings.animationsEnabled"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
        /></label>
        <label
          class="flex min-h-[8cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.showShortcuts }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.showShortcutsHint
            }}</small></span
          ><input
            v-model="store.settings.showShortcuts"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
        /></label>
        <label
          class="flex min-h-[8cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.autoFocus }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.autoFocusHint
            }}</small></span
          ><input
            v-model="store.settings.autoFocusGuess"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
        /></label>
        <label
          class="flex min-h-[8cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.discoverable }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.discoverableHint
            }}</small></span
          ><input
            v-model="store.settings.discoverable"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
        /></label>
        <label
          class="flex min-h-[8cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
          ><span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.acceptsInvites }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.acceptsInvitesHint
            }}</small></span
          ><input
            v-model="store.settings.acceptsInvites"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
        /></label>
      </div>
    </section>

    <!-- 快捷键设置：三个工具各自捕获一个单键，重复键会报错 -->
    <section v-else-if="tab === 'shortcuts'" class="min-h-0 px-[9cqw] py-[3cqh]">
      <div class="flex items-center gap-[1.2em] mb-[2.5cqh]">
        <Keyboard class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
        <div>
          <h2>{{ strings.settings.shortcutsTitle }}</h2>
          <p class="mt-[0.5cqh] text-muted text-[0.72em]">{{ strings.settings.shortcutsIntro }}</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-[1em]">
        <label
          v-for="row in shortcutRows"
          :key="row.setting"
          class="grid min-h-[12cqh] grid-cols-[auto_1fr_auto] items-center gap-[0.8em] rounded-[0.8em] border-[0.18cqh] border-line bg-white p-[1.2em]"
        >
          <component :is="row.icon" class="w-[3.6cqh] text-blue" />
          <span class="flex flex-col gap-[0.25em]"
            ><b>{{ row.name }}</b
            ><small class="text-muted text-[0.68em]">{{ row.detail }}</small></span
          >
          <input
            :value="store.settings[row.setting]"
            type="text"
            readonly
            class="h-[3.2em] w-[3.2em] rounded-[0.55em] bg-blue text-center text-white uppercase font-mono font-black leading-none cursor-pointer [text-transform:uppercase] focus:outline-[0.3cqh] focus:outline-yellow focus:outline-offset-[0.2cqh]"
            :aria-label="strings.settings.setShortcutAria(row.name)"
            @keydown.prevent="captureShortcut(row.setting, $event)"
          />
        </label>
      </div>
      <p v-if="shortcutError" class="mt-[1.2cqh] text-red font-extrabold" role="alert">
        {{ shortcutError }}
      </p>
      <p class="mt-[1.2cqh] text-muted text-[0.68em]">{{ strings.settings.shortcutNote }}</p>
    </section>

    <!-- 资料与诊断：修改大厅资料 / 查看诊断 / 恢复默认与清除资料 -->
    <section
      v-else
      class="min-h-0 px-[9cqw] py-[3cqh] grid grid-cols-[1fr_1.3fr] grid-rows-[1fr_auto] gap-[2cqh_2cqw]"
    >
      <div
        class="grid grid-cols-[auto_1fr] items-center gap-[1.5cqh_1em] border-t-[0.4cqh] border-blue bg-white p-[2cqh_1.5em]"
      >
        <button
          type="button"
          class="row-span-2 flex flex-col items-center gap-[0.7cqh] text-blue bg-transparent text-[0.72em] font-black"
          :aria-label="strings.profile.changeAvatarAria"
          @click="showAvatarPicker = true"
        >
          <AvatarImage
            :avatar-id="store.profile.avatarId"
            :label="strings.common.myAvatarAria"
            class="h-[14cqh] w-[14cqh]"
          />
          <span>{{ strings.settings.avatarField }}</span>
        </button>
        <label class="flex flex-col gap-[0.6cqh] font-extrabold"
          >{{ strings.settings.nicknameField
          }}<input
            v-model="store.profile.nickname"
            :maxlength="store.config.player.nicknameMaxLength"
            class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink" /></label
        ><button
          class="col-start-2 inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue shadow-[0_0.4cqh_0_#1e40af]"
          type="button"
          @click="store.updateProfile"
        >
          {{ strings.settings.saveProfile }}
        </button>
      </div>
      <div class="border-t-[0.4cqh] border-blue bg-white p-[2cqh_1.5em]">
        <h2>{{ strings.settings.diagnosticsTitle }}</h2>
        <pre
          class="my-[1.4cqh] rounded-[0.6em] bg-navy p-[1.2cqh_1em] text-[#dbeafe] font-mono text-[0.7em] leading-[1.5] whitespace-pre-wrap"
          >{{ diagnostic }}</pre>
        <button
          class="inline-flex min-h-[5.2cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-navy bg-white !border !border-[0.18cqh] !border-line"
          type="button"
          @click="copyDiagnostics"
        >
          <Clipboard />{{ strings.settings.copyDiagnostics }}
        </button>
      </div>
      <div class="col-span-full flex justify-end gap-[0.8em]">
        <button
          type="button"
          class="flex min-h-[5cqh] items-center gap-[0.5em] rounded-[0.6em] px-[1em] text-navy bg-white border-[0.18cqh] border-line"
          @click="store.resetSettings"
        >
          <RotateCcw />{{ strings.settings.resetSettings }}</button
        ><button
          type="button"
          class="flex min-h-[5cqh] items-center justify-center gap-[0.5em] rounded-[0.6em] px-[1em] font-black text-white bg-red"
          @click="store.clearProfile"
        >
          <Trash2 />{{ strings.settings.clearProfile }}
        </button>
      </div>
    </section>

    <AvatarPickerDialog
      v-model="store.profile.avatarId"
      :open="showAvatarPicker"
      @close="showAvatarPicker = false"
    />
  </main>
</template>
