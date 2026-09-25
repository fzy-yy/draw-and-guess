import { expect, type Locator } from '@playwright/test'

/**
 * 手写下拉组件（SelectDropdown）的通用交互：
 * 按字段标签定位 combobox → 点击展开 → 按选项文本点击 → 断言面板收起。
 * 原生 selectOption 不再适用（控件为 button + role=listbox 的自定义实现）。
 */
export async function selectDropdownOption(
  scope: Locator,
  label: string | RegExp,
  optionName: string,
): Promise<void> {
  await scope.getByLabel(label).click()
  await scope.getByRole('option', { name: optionName, exact: true }).click()
  await expect(scope.getByRole('listbox')).toHaveCount(0)
}

/** 中途加入策略枚举值 → 界面选项文案（与 strings.room.joinPolicy* 对齐）。 */
export const joinPolicyLabels = {
  forbid: '禁止',
  spectate: '仅观战',
  next_game: '下一局加入',
} as const
