<!--
  声音设置页：主音量 / 音效音量 / 背景音乐 / 全部静音。
  复用 SettingSliderRow 与 SettingSwitchRow，直接读写 store.settings 并在保存时调用 store.saveSettings。
-->
<script setup lang="ts">
import { Music2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import SettingSliderRow from './SettingSliderRow.vue'
import SettingSwitchRow from './SettingSwitchRow.vue'

const store = useGameStore()
</script>

<template>
  <section class="min-h-0 px-[9cqw] py-[3cqh]">
    <div class="flex items-center gap-[1.2em] mb-[2.5cqh]">
      <Music2 class="h-[6cqh] w-[6cqh] rounded-[0.8em] bg-blue p-[1.2cqh] text-white" />
      <div>
        <h2>{{ strings.settings.audioTitle }}</h2>
        <p class="mt-[0.5cqh] text-muted text-[0.72em]">{{ strings.settings.audioIntro }}</p>
      </div>
    </div>
    <div class="flex flex-col gap-[1.2cqh]">
      <SettingSliderRow
        v-model="store.settings.masterVolume"
        :title="strings.settings.masterVolume"
        :hint="strings.settings.masterVolumeHint"
        :min="0"
        :max="1"
        :step="0.05"
        :display="`${Math.round(store.settings.masterVolume * 100)}%`"
        @save="store.saveSettings"
      />
      <SettingSliderRow
        v-model="store.settings.soundVolume"
        :title="strings.settings.soundVolume"
        :hint="strings.settings.soundVolumeHint"
        :min="0"
        :max="1"
        :step="0.05"
        :display="`${Math.round(store.settings.soundVolume * 100)}%`"
        @save="store.saveSettings"
      />
      <SettingSliderRow
        v-model="store.settings.musicVolume"
        :title="strings.settings.musicVolume"
        :hint="strings.settings.musicVolumeHint"
        :min="0"
        :max="1"
        :step="0.05"
        :display="`${Math.round(store.settings.musicVolume * 100)}%`"
        @save="store.saveSettings"
      />
      <SettingSwitchRow
        v-model="store.settings.muted"
        :title="strings.settings.muted"
        :hint="strings.settings.mutedHint"
        class="border-l-[0.4cqh] border-blue"
        @save="store.saveSettings"
      />
    </div>
  </section>
</template>
