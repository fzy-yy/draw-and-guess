<!--
  游戏画框（.game-stage 舞台）以外的页面背景外壳（从 App.vue 抽出的独立组件）。
  职责：把舞台整体居中在视口中央，并承载舞台以外的背景视觉。
  后续若要在背景上加特效（光斑/网格/动效等），统一在本组件内以绝对定位背景层实现，
  不得散落在各业务视图里；舞台内容通过默认插槽传入，保持本组件与页面逻辑完全解耦。
-->
<script setup lang="ts">
// 纯展示外壳：无需逻辑；特效背景层后续可在此以绝对定位元素叠加（位于插槽内容之下）。
</script>

<template>
  <!-- 视口外壳：把舞台整体居中在屏幕中央；舞台（游戏画框）以外区域用 paper 语义色 -->
  <div class="relative grid h-full w-full place-items-center overflow-hidden bg-paper">
    <!-- 默认插槽：游戏画框（.game-stage）。背景特效层未来加在插槽之前，天然垫在舞台下方。 -->
    <slot />
  </div>
</template>
