<!--
  声音设置页：主音量 / 音效音量 / 背景音乐 / 全部静音。
  复用 SettingSliderRow 与 SettingSwitchRow，直接读写 store.settings 并在保存时调用 store.saveSettings。
-->
<script setup lang="ts">
import { Music2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import SettingSliderRow from '@/components/common/SettingSliderRow.vue'
import SettingSwitchRow from '@/components/common/SettingSwitchRow.vue'
import SettingsSectionHeader from '@/components/settings/SettingsSectionHeader.vue'

const store = useGameStore()
</script>

<template>
  <section class="min-h-0 px-[5cqw] py-[3cqh]">
    <SettingsSectionHeader
      :icon="Music2"
      :title="strings.settings.audioTitle"
      :intro="strings.settings.audioIntro"
    />
    <div class="flex flex-col gap-[1.2cqh]">
      <SettingSliderRow
        v-model="store.settings.masterVolume"
        :title="strings.settings.masterVolume"
        :hint="strings.settings.masterVolumeHint"
        :min="store.config.audio.volumeRange.min"
        :max="store.config.audio.volumeRange.max"
        :step="store.config.audio.volumeRange.step"
        :display="strings.common.percentUnit(Math.round(store.settings.masterVolume * 100))"
        @save="store.saveSettings"
      />
      <SettingSliderRow
        v-model="store.settings.soundVolume"
        :title="strings.settings.soundVolume"
        :hint="strings.settings.soundVolumeHint"
        :min="store.config.audio.volumeRange.min"
        :max="store.config.audio.volumeRange.max"
        :step="store.config.audio.volumeRange.step"
        :display="strings.common.percentUnit(Math.round(store.settings.soundVolume * 100))"
        @save="store.saveSettings"
      />
      <SettingSliderRow
        v-model="store.settings.musicVolume"
        :title="strings.settings.musicVolume"
        :hint="strings.settings.musicVolumeHint"
        :min="store.config.audio.volumeRange.min"
        :max="store.config.audio.volumeRange.max"
        :step="store.config.audio.volumeRange.step"
        :display="strings.common.percentUnit(Math.round(store.settings.musicVolume * 100))"
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
