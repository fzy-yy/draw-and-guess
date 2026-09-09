export { default as InviteDialog } from './InviteDialog.vue'
export { default as RuleRow } from './RuleRow.vue'
export { default as RuleSummary } from './RuleSummary.vue'
export { default as RulesDialog } from './RulesDialog.vue'
export { default as SeatGrid } from './SeatGrid.vue'
export { default as VocabPackageTableView } from './VocabPackageTableView.vue'
export { default as VocabTableView } from './VocabTableView.vue'
// 注意：VocabularyDialog 为懒加载模块，**不要**在此静态 re-export——
// 静态 re-export 会被入口静态图捕获，导致代码分割失效（见 utils/lazy-component.ts）。
