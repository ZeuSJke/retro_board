/** Тексты и числа для блоков дашборда: склонения, серии тем, очистка разметки. */

/** Выбор формы слова по числу: `pluralRu(3, ['участник', 'участника', 'участников'])`. */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(count)
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/** «на 1 доске», «на 3 досках», «на 21 доске». */
export function boardsCountLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  return mod10 === 1 && mod100 !== 11 ? `на ${count} доске` : `на ${count} досках`
}

/** «3-й спринт подряд»: показываем только для серии длиннее одной доски. */
export function streakLabel(streak: number): string | null {
  return streak > 1 ? `${streak}-й спринт подряд` : null
}

/**
 * Текст без разметки Markdown: `**важно**` → «важно».
 * Ответы модели и старые данные могут содержать разметку — на дашборде она не рендерится
 * и не должна показываться сырой.
 */
export function plainText(value: string): string {
  return value
    .replace(/```+/g, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)\s]+\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)[*_]([^*_\s][^*_]*?)[*_](?=\s|[.,;:!?)]|$)/g, '$1$2')
    .replace(/^\s*(?:#{1,6}|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Среднее с одним знаком после запятой в принятом на дашборде виде: «2.4». */
export function formatAverage(value: number): string {
  return value.toFixed(1)
}
