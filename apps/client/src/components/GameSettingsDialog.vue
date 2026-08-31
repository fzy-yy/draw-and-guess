<!-- 对局内设置弹窗：复用本地设置状态，不离开当前权威游戏视图。 -->
<script setup lang="ts">
import { Settings, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()
</script>

<template>
  <Transition name="modal">
    <div
      v-if="open"
      class="stage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-settings-title"
      @keydown.esc="emit('close')"
    >
      <section class="game-dialog game-settings-dialog">
        <header>
          <div>
            <p class="step-label">{{ strings.settings.label }}</p>
            <h2 id="game-settings-title">{{ strings.game.settingsTitle }}</h2>
          </div>
          <button type="button" :aria-label="strings.game.settingsCloseAria" @click="emit('close')">
            <X />
          </button>
        </header>
        <div class="game-settings-content">
          <div class="settings-intro compact">
            <Settings />
            <div>
              <h2>{{ strings.game.settingsQuickTitle }}</h2>
              <p>{{ strings.game.settingsQuickHint }}</p>
            </div>
          </div>
          <div class="slider-settings compact">
            <label>
              <span
                ><b>{{ strings.settings.masterVolume }}</b
                ><small>{{ strings.settings.masterVolumeHint }}</small></span
              >
              <input
                v-model.number="store.settings.masterVolume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                @change="store.saveSettings"
              />
              <strong>{{ Math.round(store.settings.masterVolume * 100) }}%</strong>
            </label>
            <label class="setting-switch">
              <span
                ><b>{{ strings.settings.muted }}</b
                ><small>{{ strings.settings.mutedHint }}</small></span
              >
              <input v-model="store.settings.muted" type="checkbox" @change="store.saveSettings" />
            </label>
          </div>
          <div class="switch-grid compact">
            <label>
              <span
                ><b>{{ strings.settings.animations }}</b
                ><small>{{ strings.settings.animationsHint }}</small></span
              >
              <input
                v-model="store.settings.animationsEnabled"
                type="checkbox"
                @change="store.saveSettings"
              />
            </label>
            <label>
              <span
                ><b>{{ strings.settings.showShortcuts }}</b
                ><small>{{ strings.settings.showShortcutsHint }}</small></span
              >
              <input
                v-model="store.settings.showShortcuts"
                type="checkbox"
                @change="store.saveSettings"
              />
            </label>
            <label>
              <span
                ><b>{{ strings.settings.autoFocus }}</b
                ><small>{{ strings.settings.autoFocusHint }}</small></span
              >
              <input
                v-model="store.settings.autoFocusGuess"
                type="checkbox"
                @change="store.saveSettings"
              />
            </label>
          </div>
        </div>
        <footer>
          <button class="primary-action" type="button" @click="emit('close')">
            {{ strings.game.settingsDone }}
          </button>
        </footer>
      </section>
    </div>
  </Transition>
</template>
