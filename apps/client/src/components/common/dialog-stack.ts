/** 从可见弹窗中选择 z-index 最高者；相同层级以后出现者为顶层。 */
export function selectTopmostDialog<T>(
  dialogs: readonly T[],
  isVisible: (dialog: T) => boolean,
  zIndex: (dialog: T) => number,
): T | undefined {
  return dialogs.filter(isVisible).reduce<T | undefined>((current, dialog) => {
    if (!current) return dialog
    return zIndex(dialog) >= zIndex(current) ? dialog : current
  }, undefined)
}
