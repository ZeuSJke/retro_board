/**
 * Генератор ключа доступа команды.
 *
 * Алфавит без похожих знаков (0 и O, 1, l и I): ключ диктуют и переписывают вручную.
 * 20 знаков из 56 дают около 116 бит случайности; дефисы между группами — только для чтения.
 * Итог — 23 символа ASCII, что укладывается в серверные границы (от 4 символов, до 72 байт).
 */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const GROUPS = 4
const GROUP_LENGTH = 5

/** Случайный индекс в алфавите без перекоса: байты за границей кратного диапазона отбрасываются. */
function randomIndexes(count: number, alphabetSize: number): number[] {
  const limit = 256 - (256 % alphabetSize)
  const indexes: number[] = []
  while (indexes.length < count) {
    const bytes = crypto.getRandomValues(new Uint8Array(count * 2))
    for (const byte of bytes) {
      if (byte < limit && indexes.length < count) indexes.push(byte % alphabetSize)
    }
  }
  return indexes
}

/** Надёжный ключ доступа вида `Xk7Pq-m3RtZ-9fGhJ-w2NbC`. */
export function generateAccessKey(): string {
  const chars = randomIndexes(GROUPS * GROUP_LENGTH, KEY_ALPHABET.length).map((i) => KEY_ALPHABET[i])
  const groups: string[] = []
  for (let g = 0; g < GROUPS; g++) {
    groups.push(chars.slice(g * GROUP_LENGTH, (g + 1) * GROUP_LENGTH).join(''))
  }
  return groups.join('-')
}
