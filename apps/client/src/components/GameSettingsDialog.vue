<!-- 对局内设置弹窗：复用本地设置状态，不离开当前权威游戏视图。 -->
<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AppButton from '@/components/AppButton.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import { useGameStore } from '@/stores/game'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()
</script>

<template>
  <!-- 统一使用 BaseDialog：获得 document 级 Esc 关闭与一致的弹窗骨架/过渡 -->
  <BaseDialog
    :open="open"
    width-class="w-[62cqw]"
    labelledby="game-settings-title"
    :close-aria="strings.game.settingsCloseAria"
    @close="emit('close')"
  >
    <template #header>
      <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
        {{ strings.settings.label }}
      </p>
      <h2 id="game-settings-title">{{ strings.game.settingsTitle }}</h2>
    </template>
    <div class="grid min-h-0 grid-cols-2 gap-[1.5cqh_1.5em] overflow-y-auto px-[2em] py-[2.2cqh]">
      <div class="col-span-full mb-0 flex items-center gap-[1.2em]">
        <Settings class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
        <div>
          <h2>{{ strings.game.settingsQuickTitle }}</h2>
          <p class="mt-[0.5cqh] text-muted text-[0.72em]">
            {{ strings.game.settingsQuickHint }}
          </p>
        </div>
      </div>
      <div class="flex flex-col gap-[1.2cqh]">
        <label
          class="grid min-h-[6.5cqh] grid-cols-[1.2fr_1.8fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
        >
          <span class="flex flex-col"
            ><b>{{ strings.settings.masterVolume }}</b
            ><small class="text-muted text-[0.7em]">{{
              strings.settings.masterVolumeHint
            }}</small></span
          >
          <input
            v-model.number="store.settings.masterVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="accent-blue"
            @change="store.saveSettings"
          />
          <strong>{{ Math.round(store.settings.masterVolume * 100) }}%</strong>
        </label>
        <label
          class="grid min-h-[6.5cqh] grid-cols-[1fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
        >
          <span class="flex flex-col"
            ><b>{{ strings.settings.muted }}</b
            ><small class="text-muted text-[0.7em]">{{ strings.settings.mutedHint }}</small></span
          >
          <input
            v-model="store.settings.muted"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
          />
        </label>
      </div>
      <div class="grid grid-cols-1 gap-[1.2cqh_1em]">
        <label
          class="flex min-h-[6.5cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
        >
          <span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.animations }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.animationsHint
            }}</small></span
          >
          <input
            v-model="store.settings.animationsEnabled"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
          />
        </label>
        <label
          class="flex min-h-[6.5cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
        >
          <span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.showShortcuts }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.showShortcutsHint
            }}</small></span
          >
          <input
            v-model="store.settings.showShortcuts"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
          />
        </label>
        <label
          class="flex min-h-[6.5cqh] items-center gap-[1em] border-l-[0.35cqh] border-slate-400 bg-white px-[1.2em] py-[1cqh]"
        >
          <span class="flex flex-1 flex-col"
            ><b>{{ strings.settings.autoFocus }}</b
            ><small class="text-muted text-[0.68em]">{{
              strings.settings.autoFocusHint
            }}</small></span
          >
          <input
            v-model="store.settings.autoFocusGuess"
            type="checkbox"
            class="h-[2.6cqh] w-[2.6cqh] accent-blue"
            @change="store.saveSettings"
          />
        </label>
      </div>
    </div>
    <template #footer>
      <AppButton type="button" @click="emit('close')">{{ strings.game.settingsDone }}</AppButton>
    </template>
  </BaseDialog>
</template>
