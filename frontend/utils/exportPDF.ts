/**
 * Generates a beautiful HTML print page and opens the print dialog.
 * No external dependencies required.
 */

import type { ActionItem, Board, Column, Card } from '../types'

const AVATAR_COLORS = [
  '#6750A4', '#0061A4', '#006E1C', '#BA1A1A',
  '#E8760A', '#006A60', '#7D5260',
]

function userColor(name: string = ''): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}

function initials(name: string = ''): string {
  return name.slice(0, 2).toUpperCase()
}

function isLight(hex: string): boolean {
  if (!hex || hex === '#FFFFFF') return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 180
}

function formatDate(): string {
  return new Date().toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function cardHTML(card: Card): string {
  const bg = card.color || '#FFFFFF'
  const textColor = isLight(bg) ? '#1C1B1F' : '#FFFFFF'
  const subtleColor = isLight(bg) ? '#49454F' : 'rgba(255,255,255,0.7)'
  const borderColor = bg !== '#FFFFFF' ? bg : 'transparent'
  const avatarBg = userColor(card.author)
  const likeCount = (card.likes || []).length

  return `
    <div class="card" style="background:${bg}; color:${textColor}; border-left-color:${borderColor}">
      <div class="card-author" style="color:${subtleColor}">
        <span class="card-avatar" style="background:${avatarBg}">${initials(card.author)}</span>
        ${escHtml(card.author)}
      </div>
      <div class="card-text">${escHtml(card.text)}</div>
      ${likeCount > 0 ? `<div class="card-likes" style="color:${isLight(bg) ? '#6750A4' : 'rgba(255,255,255,0.85)'}">♥ ${likeCount}</div>` : ''}
    </div>`
}

function escHtml(str: string = ''): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

function columnHTML(col: Column): string {
  if (!col) return ''

  const ungrouped = col.cards.filter((c) => !c.group_id)
  const groups = (col.groups || []).map((g) => ({
    ...g,
    cards: col.cards.filter((c) => c.group_id === g.id),
  }))

  const hasContent = ungrouped.length > 0 || groups.length > 0

  const groupsHTML = groups
    .map(
      (g) => `
    <div class="group-block">
      <div class="group-title">
        <span class="group-icon">⬡</span>
        ${escHtml(g.title)}
        <span class="group-count">${g.cards.length}</span>
      </div>
      <div class="group-cards">
        ${g.cards.map(cardHTML).join('')}
      </div>
    </div>`,
    )
    .join('')

  const ungroupedHTML = ungrouped.map(cardHTML).join('')

  return `
    <div class="column-section">
      <div class="column-header" style="border-color:${col.color}">
        <span class="column-dot" style="background:${col.color}"></span>
        <span class="column-title">${escHtml(col.title)}</span>
        <span class="column-count">${col.cards.length} карт${col.cards.length === 1 ? 'очка' : 'очек'}</span>
      </div>
      ${hasContent ? `<div class="cards-area">${groupsHTML}${ungroupedHTML}</div>` : '<div class="empty-col">Нет заметок</div>'}
    </div>`
}

function actionItemHTML(item: ActionItem, index: number): string {
  const avatarBg = userColor(item.assignee || '?')
  const assigneeName = item.assignee || 'Не назначен'
  const date = new Date(item.created_at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return `
    <div class="action-item">
      <div class="action-item-number">${index + 1}</div>
      <div class="action-item-content">
        <div class="action-item-text">${escHtml(item.text)}</div>
        <div class="action-item-meta">
          <div class="action-item-assignee">
            <span class="card-avatar" style="background:${avatarBg}">${initials(item.assignee || '?')}</span>
            <span class="action-item-assignee-name">${escHtml(assigneeName)}</span>
          </div>
          <div class="action-item-date">Создано: ${date}</div>
        </div>
        ${item.jira_issue_key ? `
        <div class="action-item-jira">
          <span class="jira-icon">🔗</span>
          <span class="jira-key">${escHtml(item.jira_issue_key)}</span>
          <span class="jira-label">— задача создана в Jira</span>
        </div>` : ''}
      </div>
    </div>`
}

function actionItemsSectionHTML(actionItems: ActionItem[]): string {
  if (actionItems.length === 0) return ''

  const itemsHTML = actionItems.map((item, i) => actionItemHTML(item, i)).join('')

  return `
    <div class="action-items-section">
      <div class="action-items-header">
        <span class="action-items-icon">📋</span>
        <span class="action-items-title">Итоги</span>
        <span class="action-items-count">${actionItems.length} пункт${actionItems.length === 1 ? '' : actionItems.length < 5 ? 'а' : 'ов'}</span>
      </div>
      <div class="action-items-description">
        Список решений и задач, принятых по результатам ретроспективы.
        ${actionItems.some((i) => i.jira_issue_key) ? 'Часть задач уже заведена в Jira.' : ''}
      </div>
      <div class="action-items-list">
        ${itemsHTML}
      </div>
    </div>`
}

export function exportBoardToPDF(board: Board, columns: Column[], actionItems: ActionItem[] = []): void {
  const totalCards = columns.reduce((s, c) => s + (c.cards?.length || 0), 0)
  const totalGroups = columns.reduce((s, c) => s + (c.groups?.length || 0), 0)

  const columnsHTML = columns.map(columnHTML).join('')
  const actionItemsHTML = actionItemsSectionHTML(actionItems)

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RetroBoard — ${escHtml(board.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Roboto', sans-serif; background: #F8F5FF; color: #1C1B1F; font-size: 13px; line-height: 1.5; }
    .cover { background: linear-gradient(135deg, #6750A4 0%, #0061A4 100%); color: white; padding: 40px 48px 36px; page-break-after: avoid; }
    .cover-eyebrow { font-size: 11px; font-weight: 500; letter-spacing: 2.5px; text-transform: uppercase; opacity: 0.75; margin-bottom: 10px; }
    .cover-name { font-size: 30px; font-weight: 700; margin-bottom: 16px; line-height: 1.25; }
    .cover-stats { display: flex; gap: 24px; flex-wrap: wrap; }
    .cover-stat { display: flex; flex-direction: column; gap: 2px; }
    .cover-stat-value { font-size: 20px; font-weight: 700; }
    .cover-stat-label { font-size: 11px; opacity: 0.7; letter-spacing: 0.5px; }
    .cover-date { margin-top: 20px; font-size: 12px; opacity: 0.65; border-top: 1px solid rgba(255,255,255,0.25); padding-top: 14px; }
    .columns-area { padding: 28px 48px 48px; display: flex; flex-direction: column; gap: 28px; }
    .column-section { break-inside: avoid-page; }
    .column-header { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 3px solid; margin-bottom: 14px; }
    .column-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .column-title { font-size: 16px; font-weight: 700; flex: 1; }
    .column-count { font-size: 11px; font-weight: 500; color: #49454F; background: #E7E0EC; padding: 2px 10px; border-radius: 20px; }
    .cards-area { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
    .empty-col { font-size: 12px; color: #79747E; font-style: italic; }
    .card { border-radius: 10px; padding: 12px 14px 10px; border-left: 4px solid transparent; box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06); break-inside: avoid; }
    .card-author { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .card-avatar { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; color: white; font-weight: 700; flex-shrink: 0; }
    .card-text { font-size: 13px; line-height: 1.5; word-break: break-word; }
    .card-likes { margin-top: 7px; font-size: 11px; font-weight: 600; }
    .group-block { grid-column: 1 / -1; border: 1.5px solid #CAC4D0; border-radius: 12px; padding: 10px 12px; background: #F3EDF7; }
    .group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6750A4; display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    .group-icon { font-style: normal; }
    .group-count { background: #EADDff; color: #6750A4; padding: 1px 6px; border-radius: 10px; font-size: 10px; }
    .group-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .footer { text-align: center; padding: 16px 48px 24px; font-size: 11px; color: #79747E; border-top: 1px solid #E7E0EC; }
    .action-items-section { margin: 0 48px 32px; padding-top: 28px; border-top: 3px solid #6750A4; page-break-before: always; }
    .action-items-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .action-items-icon { font-size: 20px; }
    .action-items-title { font-size: 20px; font-weight: 700; color: #1C1B1F; flex: 1; }
    .action-items-count { font-size: 11px; font-weight: 500; color: #6750A4; background: #EADDff; padding: 2px 10px; border-radius: 20px; }
    .action-items-description { font-size: 12px; color: #49454F; margin-bottom: 18px; line-height: 1.5; }
    .action-items-list { display: flex; flex-direction: column; gap: 12px; }
    .action-item { display: flex; gap: 14px; background: white; border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06); border-left: 4px solid #6750A4; break-inside: avoid; }
    .action-item-number { width: 28px; height: 28px; border-radius: 50%; background: #6750A4; color: white; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
    .action-item-content { flex: 1; min-width: 0; }
    .action-item-text { font-size: 14px; font-weight: 500; line-height: 1.5; color: #1C1B1F; margin-bottom: 10px; word-break: break-word; }
    .action-item-meta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 6px; }
    .action-item-assignee { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: #49454F; }
    .action-item-assignee-name { }
    .action-item-date { font-size: 11px; color: #79747E; }
    .action-item-jira { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 6px 10px; background: #E8F5E9; border-radius: 8px; font-size: 12px; }
    .jira-icon { font-size: 14px; }
    .jira-key { font-weight: 700; color: #1B5E20; }
    .jira-label { color: #388E3C; }
    @media print {
      body { background: white; }
      .cover, .card, .group-block, .column-section, .action-item, .action-item-number, .action-item-jira { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { size: A4; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="cover">
    <div class="cover-eyebrow">RetroBoard · Экспорт ретроспективы</div>
    <div class="cover-name">${escHtml(board.name)}</div>
    <div class="cover-stats">
      <div class="cover-stat"><span class="cover-stat-value">${columns.length}</span><span class="cover-stat-label">Колонок</span></div>
      <div class="cover-stat"><span class="cover-stat-value">${totalCards}</span><span class="cover-stat-label">Заметок</span></div>
      ${totalGroups > 0 ? `<div class="cover-stat"><span class="cover-stat-value">${totalGroups}</span><span class="cover-stat-label">Групп</span></div>` : ''}
      ${actionItems.length > 0 ? `<div class="cover-stat"><span class="cover-stat-value">${actionItems.length}</span><span class="cover-stat-label">Итогов</span></div>` : ''}
    </div>
    <div class="cover-date">${formatDate()}</div>
  </div>
  <div class="columns-area">${columnsHTML}</div>
  ${actionItemsHTML}
  <div class="footer">Сгенерировано RetroBoard · ${formatDate()}</div>
  <script>window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 800); });</script>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    const a = document.createElement('a')
    a.href = url
    a.download = `retro-${board.name.replace(/[^а-яёa-z0-9]/gi, '_')}.html`
    a.click()
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
