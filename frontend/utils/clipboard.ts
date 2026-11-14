type SelectableField = HTMLInputElement | HTMLTextAreaElement

/**
 * Скопировать текст в буфер обмена. Возвращает `false`, если браузер не дал этого сделать.
 *
 * `navigator.clipboard` есть только в защищённом контексте (HTTPS или localhost). Стенд,
 * открытый по HTTP с другого устройства в сети, копирует через выделение: в поле `field`,
 * где этот текст уже показан, или во временном поле.
 */
export async function copyText(text: string, field?: SelectableField | null): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Нет разрешения или документ не в фокусе — пробуем запасной способ
    }
  }
  if (typeof document === 'undefined') return false
  if (field && field.value === text) return copySelection(field)

  const temp = document.createElement('textarea')
  temp.value = text
  temp.setAttribute('readonly', '')
  temp.style.position = 'fixed'
  temp.style.opacity = '0'
  document.body.appendChild(temp)
  try {
    return copySelection(temp)
  } finally {
    temp.remove()
  }
}

function copySelection(field: SelectableField): boolean {
  try {
    field.focus()
    field.select()
    // Устаревший, но единственный способ скопировать без Clipboard API
    return document.execCommand('copy')
  } catch {
    return false
  }
}
