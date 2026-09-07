<!--
  声音设置页：主音量 / 音效音量 / 背景音乐 / 全部静音 + 音效试听。
  复用 SettingSliderRow 与 SettingSwitchRow，直接读写 store.settings 并在保存时调用 store.saveSettings。
  试听列表以配置清单（soundCatalog）为唯一合法键来源；缺失资源的音效被禁用，无法点击。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Music2, Play } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { isSoundAvailable, playSound } from '@/audio'
import type { SoundName } from '@/audio'
import SettingSliderRow from '@/components/common/SettingSliderRow.vue'
import SettingSwitchRow from '@/components/common/SettingSwitchRow.vue'
import SettingsSectionHeader from '@/components/settings/SettingsSectionHeader.vue'

const store = useGameStore()

// 试听列表：仅展示非 BGM 的键，键以配置清单（soundCatalog）为唯一合法来源
const previewSounds = computed<SoundName[]>(() =>
  (Object.entries(store.config.audio.sounds) as Array<[SoundName, { isBgm: boolean }]>)
    .filter(([, meta]) => !meta.isBgm)
    .map(([key]) => key),
)

/** 音效中文名（来自 string/ 文案表；缺失时回退为键名本身）。 */
function soundLabel(key: SoundName): string {
  return strings.settings.soundLabels[key] ?? key
}

/** 试听按钮的无障碍标签（可用 / 不可用分别给出说明）。 */
function previewAria(key: SoundName): string {
  return isSoundAvailable(key)
    ? strings.settings.soundPreviewAria(soundLabel(key))
    : strings.settings.soundPreviewUnavailableAria(soundLabel(key))
}

function previewSound(key: SoundName): void {
  if (!isSoundAvailable(key)) return
  playSound(key)
}
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

      <!-- 音效试听：不可用音效被禁用（disabled），且给出无障碍说明 -->
      <div class="flex flex-col gap-[1cqh] border-t-[0.4cqh] border-line bg-white p-[1.5cqh_1.5em]">
        <div>
          <h3 class="text-fs-16 font-bold">{{ strings.settings.soundPreviewTitle }}</h3>
          <p class="mt-[0.5cqh] text-muted text-fs-12">{{ strings.settings.soundPreviewIntro }}</p>
        </div>
        <div class="flex flex-wrap gap-[0.7em]">
          <button
            v-for="key in previewSounds"
            :key="key"
            type="button"
            class="inline-flex items-center gap-[0.45em] rounded-[0.6em] border-[0.18cqh] border-line bg-white px-[0.85em] py-[0.5em] text-fs-14 font-bold"
            :class="
              isSoundAvailable(key) ? 'ui-feedback hover-tint' : 'opacity-45 cursor-not-allowed'
            "
            :disabled="!isSoundAvailable(key)"
            :aria-label="previewAria(key)"
            :title="
              isSoundAvailable(key)
                ? undefined
                : strings.settings.soundPreviewUnavailableAria(soundLabel(key))
            "
            @click="previewSound(key)"
          >
            <Play class="h-[0.9em] w-[0.9em] shrink-0" aria-hidden="true" />
            <span>{{ soundLabel(key) }}</span>
            <span
              v-if="!isSoundAvailable(key)"
              class="text-fs-10 font-normal text-red"
              aria-hidden="true"
            >
              {{ strings.settings.soundUnavailable }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
