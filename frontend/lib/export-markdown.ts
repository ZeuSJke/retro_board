import type { ActionItem, Board, BoardSummary, Card } from '../types'
import { parseSafeExternalUrl } from './urls'

function formatCardAuthor(card: Card, anonymousVotes: boolean): string {
  const isAgent = card.author_kind === 'agent' && !card.masked
  if (isAgent) return ` — *${card.author} (агент)*`
  return anonymousVotes ? '' : ` — *${card.author}*`
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  done: 'Выполнена',
}

export function formatBoardMarkdown(
  board: Board,
  actionItems: ActionItem[] = [],
  summary?: BoardSummary | null,
): string {
  const lines: string[] = []
  const dateStr = new Date(board.created_at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  lines.push(`# Ретроспектива: ${board.name}`)
  lines.push(`> Дата: ${dateStr}`)
  lines.push('')

  if (summary) {
    lines.push('## AI-резюме')
    lines.push(summary.summary_text)
    lines.push('')
    if (summary.key_themes.length > 0) {
      lines.push('### Ключевые темы')
      summary.key_themes.forEach((t) => lines.push(`- ${t}`))
      lines.push('')
    }
    if (summary.recommendations.length > 0) {
      lines.push('### Рекомендации')
      summary.recommendations.forEach((r) => lines.push(`- ${r}`))
      lines.push('')
    }
  }

  for (const col of board.columns) {
    lines.push(`## ${col.title} (${col.cards.length})`)
    const groupMap = new Map(col.groups.map((g) => [g.id, g.title]))

    const grouped = new Map<string, typeof col.cards>()
    const ungrouped: typeof col.cards = []
    // Чужие карточки до раскрытия сервер присылает без текста и автора:
    // в экспорт попадает только их количество
    const visibleCards = col.cards.filter((c) => !c.masked)
    const maskedCount = col.cards.length - visibleCards.length

    for (const card of visibleCards) {
      if (card.group_id && groupMap.has(card.group_id)) {
        const list = grouped.get(card.group_id) || []
        list.push(card)
        grouped.set(card.group_id, list)
      } else {
        ungrouped.push(card)
      }
    }

    for (const grp of col.groups) {
      const cards = grouped.get(grp.id) || []
      if (cards.length === 0) continue
      lines.push(`### ${grp.title}`)
      for (const c of cards) {
        const votes = c.likes.length > 0 ? ` 👍 ${c.likes.length}` : ''
        const author = formatCardAuthor(c, Boolean(board.anonymous_votes))
        lines.push(`- ${c.text}${author}${votes}`)
      }
    }

    for (const c of ungrouped) {
      const votes = c.likes.length > 0 ? ` 👍 ${c.likes.length}` : ''
      const author = formatCardAuthor(c, Boolean(board.anonymous_votes))
      lines.push(`- ${c.text}${author}${votes}`)
    }
    if (maskedCount > 0) {
      lines.push(`- _Скрыто до раскрытия карточек других участников: ${maskedCount}_`)
    }
    lines.push('')
  }

  if (actionItems.length > 0) {
    lines.push(`## Задачи (${actionItems.length})`)
    for (const item of actionItems) {
      const title = item.title || item.text
      const assignee = item.assignee ? ` (@${item.assignee})` : ''
      // Перенесённая задача живёт на другой доске: здесь она в истории, а не «открыта»
      const status = item.superseded_by_id
        ? 'Перенесена на другую доску'
        : STATUS_LABELS[item.status] || item.status
      const safeLink = parseSafeExternalUrl(item.external_url)
      const linkPart = safeLink ? ` — [${safeLink.label}](${safeLink.href})` : ''
      lines.push(`- [${item.status === 'done' ? 'x' : ' '}] **${title}**${assignee} — ${status}${linkPart}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
