/**
 * Что открыто поверх доски и какие горячие клавиши оно отнимает.
 *
 * - `modal` — окно (Dialog, AlertDialog, Sheet, палитра команд): клавиатура целиком его;
 * - `menu` — выпадающее меню или список выбора: буквы в них — поиск по пунктам;
 * - `popover` — поповер (таймер, реакции, участники): конфликтует только Escape, которым он
 *   закрывается; остальные клавиши доски продолжают работать.
 */
export type OverlayKind = 'modal' | 'menu' | 'popover'

const DIALOG_SELECTOR =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
const MENU_SELECTOR = '[role="menu"][data-state="open"], [role="listbox"][data-state="open"]'
/** Radix кладёт содержимое поповеров и меню в обёртку позиционирования; у окон её нет. */
const POPPER_WRAPPER = '[data-radix-popper-content-wrapper]'

export function blockingOverlay(root: ParentNode = document): OverlayKind | null {
  let popover = false
  for (const el of Array.from(root.querySelectorAll(DIALOG_SELECTOR))) {
    if (!el.closest(POPPER_WRAPPER)) return 'modal'
    popover = true
  }
  if (root.querySelector(MENU_SELECTOR)) return 'menu'
  return popover ? 'popover' : null
}
