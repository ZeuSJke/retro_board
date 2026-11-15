/**
 * Формирует современную HTML-страницу отчёта RetroBoard и открывает диалог печати в PDF.
 */

import {
  ACCENT_PRESETS,
  CARD_COLOR_PRESETS,
  resolveInitialAccent,
} from '@/lib/board-themes'
import { escapeHtml, richTextToHtml } from '@/lib/rich-text'
import { showToast } from '@/store/toastStore'
import type { ActionItem, Board, BoardSummary, Card, Column } from '../types'
import { initials, userColor } from './theme'

const ACTION_STATUS_META: Record<
  ActionItem['status'],
  { label: string; bg: string; color: string; border: string }
> = {
  open: {
    label: 'Открыто',
    bg: '#FEF3C7',
    color: '#92400E',
    border: '#FDE68A',
  },
  in_progress: {
    label: 'В работе',
    bg: '#E0F2FE',
    color: '#075985',
    border: '#BAE6FD',
  },
  done: {
    label: 'Выполнено',
    bg: '#D1FAE5',
    color: '#065F46',
    border: '#A7F3D0',
  },
}

const CARRIED_STATUS_META = {
  label: 'Перенесена на другую доску',
  bg: '#F1F5F9',
  color: '#475569',
  border: '#E2E8F0',
}

const PDF_CARD_BG_MAP: Record<string, { bg: string; border: string; accent: string }> = {
  default: { bg: '#FFFFFF', border: '#E2E8F0', accent: '#94A3B8' },
  amber: { bg: '#FFFBEB', border: '#FDE68A', accent: '#F59E0B' },
  emerald: { bg: '#ECFDF5', border: '#A7F3D0', accent: '#10B981' },
  sky: { bg: '#F0F9FF', border: '#BAE6FD', accent: '#0EA5E9' },
  violet: { bg: '#F5F3FF', border: '#DDD6FE', accent: '#8B5CF6' },
  rose: { bg: '#FFF1F2', border: '#FECDD3', accent: '#F43F5E' },
  teal: { bg: '#F0FDFA', border: '#99F6E4', accent: '#14B8A6' },
}

function getActiveAccentHex(): string {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.accent
    const found = ACCENT_PRESETS.find((p) => p.id === attr)
    if (found) return found.swatch
  }
  const initial = resolveInitialAccent()
  return ACCENT_PRESETS.find((p) => p.id === initial)?.swatch || '#4F46E5'
}

function resolveCardPrintStyle(hex?: string | null): { bg: string; border: string; accent: string } {
  const clean = (hex || '#FFFFFF').toLowerCase()
  const preset = CARD_COLOR_PRESETS.find((p) => p.hex.toLowerCase() === clean)
  if (preset && PDF_CARD_BG_MAP[preset.id]) {
    return PDF_CARD_BG_MAP[preset.id]
  }
  if (!hex || clean === '#ffffff' || clean === '#fafafa') {
    return PDF_CARD_BG_MAP.default
  }
  return { bg: hex, border: '#E2E8F0', accent: '#64748B' }
}

function formatDate(dateStr?: string, withTime = false): string {
  const date = dateStr ? new Date(dateStr) : new Date()
  const target = Number.isNaN(date.getTime()) ? new Date() : date
  return target.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function cardHTML(card: Card, anonymousVotes: boolean, accentHex: string): string {
  const tone = resolveCardPrintStyle(card.color)
  const displayAuthor = anonymousVotes ? 'Участник' : card.author
  const avatarBg = anonymousVotes ? '#64748B' : userColor(card.author)
  const avatarText = anonymousVotes ? '•' : initials(card.author)
  const likeCount = (card.likes || []).length

  return `
    <article class="card" style="background:${tone.bg}; border-color:${tone.border}; border-left-color:${tone.accent}">
      <header class="card-head">
        <span class="card-author">
          <span class="avatar" style="background:${avatarBg}">${escapeHtml(avatarText)}</span>
          <span class="author-name">${escapeHtml(displayAuthor)}</span>
        </span>
        ${
          likeCount > 0
            ? `<span class="likes-pill" style="color:${accentHex}; border-color:${accentHex}33; background:${accentHex}12">♥ ${likeCount}</span>`
            : ''
        }
      </header>
      <div class="card-text">${richTextToHtml(card.text)}</div>
    </article>`
}

function columnHTML(col: Column, anonymousVotes: boolean, accentHex: string): string {
  if (!col) return ''
  const colColor = col.color || accentHex
  // Чужие карточки до раскрытия приходят с сервера без текста и автора:
  // в отчёт попадает только их количество
  const visibleCards = col.cards.filter((c) => !c.masked)
  const maskedCount = col.cards.length - visibleCards.length
  const ungrouped = visibleCards.filter((c) => !c.group_id)
  const groups = (col.groups || [])
    .map((g) => ({
      ...g,
      cards: visibleCards.filter((c) => c.group_id === g.id),
    }))
    .filter((g) => g.cards.length > 0)

  const hasContent = ungrouped.length > 0 || groups.length > 0
  const maskedNote =
    maskedCount > 0
      ? `<div class="empty-box">Скрыто до раскрытия карточек других участников: ${maskedCount}</div>`
      : ''

  const groupsHTML = groups
    .map(
      (g) => `
      <div class="group-block">
        <div class="group-header">
          <span class="group-badge">Группа</span>
          <span class="group-title">${escapeHtml(g.title)}</span>
          <span class="group-count">${g.cards.length}</span>
        </div>
        <div class="cards-grid">
          ${g.cards.map((c) => cardHTML(c, anonymousVotes, accentHex)).join('')}
        </div>
      </div>`,
    )
    .join('')

  const ungroupedHTML = ungrouped
    .map((c) => cardHTML(c, anonymousVotes, accentHex))
    .join('')

  const cardsWord = pluralizeRu(col.cards.length, 'карточка', 'карточки', 'карточек')

  return `
    <section class="column-section">
      <div class="column-header">
        <span class="column-strip" style="background:${colColor}"></span>
        <h2 class="column-title">${escapeHtml(col.title)}</h2>
        <span class="column-count">${col.cards.length} ${cardsWord}</span>
      </div>
      ${
        hasContent
          ? `<div class="cards-grid">${groupsHTML}${ungroupedHTML}</div>`
          : maskedCount > 0
            ? ''
            : '<div class="empty-box">В этой колонке пока нет карточек</div>'
      }
      ${maskedNote}
    </section>`
}

function summarySectionHTML(summary: BoardSummary): string {
  const themesHTML = summary.key_themes.length
    ? `
      <div class="summary-subblock">
        <div class="summary-label">Ключевые темы</div>
        <ul class="summary-list">
          ${summary.key_themes.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
        </ul>
      </div>`
    : ''

  const recsHTML = summary.recommendations.length
    ? `
      <div class="summary-subblock">
        <div class="summary-label">Рекомендации</div>
        <ol class="summary-ordered">
          ${summary.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
        </ol>
      </div>`
    : ''

  return `
    <section class="summary-section">
      <div class="section-heading">
        <h2 class="section-title">Итоги и AI-анализ</h2>
      </div>
      <div class="summary-card">
        <p class="summary-lead">${escapeHtml(summary.summary_text)}</p>
        ${(themesHTML || recsHTML) ? `<div class="summary-columns">${themesHTML}${recsHTML}</div>` : ''}
      </div>
    </section>`
}

function actionItemsSectionHTML(actionItems: ActionItem[]): string {
  if (actionItems.length === 0) return ''

  const itemsHTML = actionItems
    .map((item, idx) => {
      // Перенесённая задача живёт на другой доске: здесь она в истории, а не «открыта»
      const st = item.superseded_by_id
        ? CARRIED_STATUS_META
        : ACTION_STATUS_META[item.status] || ACTION_STATUS_META.open
      const assigneeName = item.assignee || 'Не назначен'
      const avatarBg = item.assignee ? userColor(item.assignee) : '#94A3B8'
      const avatarText = item.assignee ? initials(item.assignee) : '—'

      return `
        <article class="task-card">
          <div class="task-index">${idx + 1}</div>
          <div class="task-body">
            <div class="task-top">
              <div class="task-title">${richTextToHtml(item.title?.trim() || item.text)}</div>
              <span class="status-pill" style="background:${st.bg}; color:${st.color}; border-color:${st.border}">${st.label}</span>
            </div>
            ${
              item.title?.trim()
                ? `<div class="task-desc">${richTextToHtml(item.text)}</div>`
                : ''
            }
            <div class="task-meta">
              <span class="task-assignee">
                <span class="avatar" style="background:${avatarBg}">${escapeHtml(avatarText)}</span>
                ${escapeHtml(assigneeName)}
              </span>
              <span class="task-date">Создано: ${formatDate(item.created_at, true)}</span>
            </div>
          </div>
        </article>`
    })
    .join('')

  const countLabel = `${actionItems.length} ${pluralizeRu(actionItems.length, 'задача', 'задачи', 'задач')}`

  return `
    <section class="tasks-section">
      <div class="section-heading">
        <h2 class="section-title">Задачи</h2>
        <span class="section-pill">${countLabel}</span>
      </div>
      <div class="tasks-list">
        ${itemsHTML}
      </div>
    </section>`
}

const BRAND_MARK_SVG = `<svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="pdf-rb-bg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1B1E5E"/>
      <stop offset="100%" stop-color="#11133E"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#pdf-rb-bg)"/>
  <g transform="translate(1, 0.5)">
    <rect x="19" y="19" width="24" height="22" rx="4.2" transform="rotate(-31 28 41)" fill="#10B981"/>
    <rect x="22" y="21" width="24" height="22" rx="4.2" transform="rotate(-15 28 41)" fill="#F59E0B"/>
    <rect x="25" y="25" width="26" height="23" rx="4.5" fill="#FFFFFF"/>
  </g>
</svg>`

export function buildBoardPDFHtml(
  board: Board,
  columns: Column[],
  actionItems: ActionItem[] = [],
  summary?: BoardSummary | null,
): string {
  const accentHex = getActiveAccentHex()
  const totalCards = columns.reduce((s, c) => s + (c.cards?.length || 0), 0)
  const totalVotes = columns.reduce(
    (s, c) => s + (c.cards || []).reduce((cs, card) => cs + (card.likes?.length || 0), 0),
    0,
  )
  const totalGroups = columns.reduce((s, c) => s + (c.groups?.length || 0), 0)
  const anonymousVotes = Boolean(board.anonymous_votes)

  const columnsHTML = columns
    .map((col) => columnHTML(col, anonymousVotes, accentHex))
    .join('')
  const summaryHTML = summary ? summarySectionHTML(summary) : ''
  const actionItemsHTML = actionItemsSectionHTML(actionItems)

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RetroBoard — ${escapeHtml(board.name)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F8FAFC;
      color: #0F172A;
      font-size: 13px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .print-bar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 24px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #E2E8F0;
    }
    .print-bar-note { font-size: 12px; color: #64748B; }
    .print-bar-actions { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid #E2E8F0;
      background: #FFFFFF;
      color: #0F172A;
      cursor: pointer;
    }
    .btn-primary {
      background: ${accentHex};
      border-color: ${accentHex};
      color: #FFFFFF;
    }

    .page-wrap {
      max-width: 960px;
      margin: 24px auto 40px;
      padding: 0 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .hero-card {
      position: relative;
      overflow: hidden;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 16px;
      padding: 24px 28px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
    }
    .hero-card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto 0;
      height: 4px;
      background: ${accentHex};
    }
    .hero-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .brand-row { display: flex; align-items: center; gap: 10px; }
    .brand-label { font-size: 13px; font-weight: 700; color: #0F172A; letter-spacing: -0.01em; }
    .brand-sub { font-size: 11px; color: #64748B; }
    .date-pill {
      font-size: 11px;
      font-weight: 500;
      color: #475569;
      background: #F1F5F9;
      border: 1px solid #E2E8F0;
      padding: 4px 10px;
      border-radius: 999px;
    }
    .hero-title {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #0F172A;
      margin-bottom: 18px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
    }
    .kpi-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .kpi-value {
      font-size: 18px;
      font-weight: 700;
      color: #0F172A;
      font-variant-numeric: tabular-nums;
    }
    .kpi-label { font-size: 11px; color: #64748B; margin-top: 2px; }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .section-title { font-size: 16px; font-weight: 700; color: #0F172A; letter-spacing: -0.01em; }
    .section-pill {
      font-size: 11px;
      font-weight: 600;
      color: ${accentHex};
      background: ${accentHex}14;
      border: 1px solid ${accentHex}2e;
      padding: 2px 10px;
      border-radius: 999px;
    }

    .summary-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 18px 20px;
      break-inside: avoid;
    }
    .summary-lead { font-size: 13px; color: #1E293B; line-height: 1.6; }
    .summary-columns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #E2E8F0;
    }
    .summary-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748B;
      margin-bottom: 8px;
    }
    .summary-list, .summary-ordered {
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 12px;
      color: #334155;
    }

    .columns-stack { display: flex; flex-direction: column; gap: 22px; }
    .column-section { display: flex; flex-direction: column; gap: 12px; }
    .column-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #E2E8F0;
    }
    .column-strip { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }
    .column-title { font-size: 15px; font-weight: 700; color: #0F172A; flex: 1; }
    .column-count {
      font-size: 11px;
      font-weight: 500;
      color: #475569;
      background: #F1F5F9;
      border: 1px solid #E2E8F0;
      padding: 2px 9px;
      border-radius: 999px;
    }
    .empty-box {
      border: 1px dashed #CBD5E1;
      border-radius: 12px;
      padding: 18px;
      text-align: center;
      font-size: 12px;
      color: #64748B;
      background: #FFFFFF;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      align-items: start;
    }
    .group-block {
      grid-column: 1 / -1;
      border: 1px solid #CBD5E1;
      border-radius: 14px;
      padding: 12px;
      background: #F1F5F9;
      break-inside: avoid;
    }
    .group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .group-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: ${accentHex};
      background: ${accentHex}16;
      padding: 2px 7px;
      border-radius: 6px;
    }
    .group-title { font-size: 12px; font-weight: 700; color: #0F172A; flex: 1; }
    .group-count {
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      padding: 1px 7px;
      border-radius: 999px;
    }

    .card {
      border-radius: 12px;
      border: 1px solid #E2E8F0;
      border-left-width: 4px;
      padding: 11px 13px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      break-inside: avoid;
    }
    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card-author { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .avatar {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      font-weight: 700;
      color: #FFFFFF;
      flex-shrink: 0;
    }
    .author-name { font-size: 11px; font-weight: 600; color: #475569; }
    .likes-pill {
      font-size: 11px;
      font-weight: 600;
      border: 1px solid;
      border-radius: 999px;
      padding: 1px 7px;
      flex-shrink: 0;
    }
    .card-text { font-size: 12.5px; line-height: 1.5; color: #0F172A; word-break: break-word; }

    .rich-code {
      padding: 1px 5px;
      border-radius: 4px;
      background: #F1F5F9;
      border: 1px solid #E2E8F0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.88em;
    }
    .rich-link {
      color: ${accentHex};
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 2px;
      word-break: break-all;
    }

    .tasks-section { break-before: page; }
    .tasks-list { display: flex; flex-direction: column; gap: 10px; }
    .task-card {
      display: flex;
      gap: 12px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 13px 16px;
      break-inside: avoid;
    }
    .task-index {
      width: 24px;
      height: 24px;
      border-radius: 8px;
      background: ${accentHex};
      color: #FFFFFF;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .task-body { flex: 1; min-width: 0; }
    .task-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 4px;
    }
    .task-title { font-size: 13.5px; font-weight: 700; color: #0F172A; word-break: break-word; }
    .status-pill {
      font-size: 10.5px;
      font-weight: 600;
      border: 1px solid;
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .task-desc { font-size: 12px; color: #475569; margin-bottom: 8px; word-break: break-word; }
    .task-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 11px; color: #64748B; }
    .task-assignee { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; color: #334155; }

    .doc-footer {
      text-align: center;
      font-size: 11px;
      color: #94A3B8;
      padding-top: 12px;
      border-top: 1px solid #E2E8F0;
    }

    @media print {
      body { background: #FFFFFF; }
      .no-print { display: none !important; }
      .page-wrap { max-width: none; margin: 0; padding: 0; }
      .hero-card, .summary-card, .group-block, .card, .task-card, .task-index, .status-pill {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      @page { size: A4; margin: 14mm; }
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <span class="print-bar-note">Предпросмотр отчёта для сохранения в PDF или печати</span>
    <div class="print-bar-actions">
      <button class="btn" onclick="window.close()">Закрыть</button>
      <button class="btn btn-primary" onclick="window.print()">Сохранить в PDF / Печать</button>
    </div>
  </div>

  <main class="page-wrap">
    <section class="hero-card">
      <div class="hero-top">
        <div class="brand-row">
          ${BRAND_MARK_SVG}
          <div>
            <div class="brand-label">RetroBoard</div>
            <div class="brand-sub">Отчёт командной ретроспективы</div>
          </div>
        </div>
        <span class="date-pill">${formatDate(board.created_at)}</span>
      </div>

      <h1 class="hero-title">${escapeHtml(board.name)}</h1>

      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-value">${columns.length}</div>
          <div class="kpi-label">Колонок</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-value">${totalCards}</div>
          <div class="kpi-label">Карточек</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-value">${totalVotes}</div>
          <div class="kpi-label">Голосов</div>
        </div>
        ${
          totalGroups > 0
            ? `<div class="kpi-box"><div class="kpi-value">${totalGroups}</div><div class="kpi-label">Групп</div></div>`
            : ''
        }
        ${
          actionItems.length > 0
            ? `<div class="kpi-box"><div class="kpi-value">${actionItems.length}</div><div class="kpi-label">Задач</div></div>`
            : ''
        }
      </div>
    </section>

    ${summaryHTML}

    <div class="columns-stack">
      ${columnsHTML}
    </div>

    ${actionItemsHTML}

    <footer class="doc-footer">
      Сформировано в RetroBoard · ${formatDate()}
    </footer>
  </main>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 500);
    });
  </script>
</body>
</html>`
}

/** `opened` — отчёт открыт в новой вкладке с диалогом печати; `downloaded` — сохранён файлом. */
export type PdfExportResult = 'opened' | 'downloaded'

/**
 * Открывает отчёт в новой вкладке, где сразу появляется диалог печати («Сохранить как PDF»).
 *
 * Если браузер заблокировал новое окно, отчёт не теряется — он сохраняется файлом `.html`, —
 * но молча так делать нельзя: человек ждал окно печати, а получил загрузку непонятного файла.
 * Поэтому показываем, что произошло и что делать дальше.
 */
export function exportBoardToPDF(
  board: Board,
  columns: Column[],
  actionItems: ActionItem[] = [],
  summary?: BoardSummary | null,
): PdfExportResult {
  const html = buildBoardPDFHtml(board, columns, actionItems, summary)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  setTimeout(() => URL.revokeObjectURL(url), 10000)

  if (window.open(url, '_blank')) return 'opened'

  const filename = `retro-${board.name.replace(/[^а-яёa-z0-9]/gi, '_')}.html`
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  showToast('Браузер не дал открыть окно печати', 'info', {
    description:
      `Отчёт сохранён файлом «${filename}». Откройте его — печать начнётся сама, выберите ` +
      '«Сохранить как PDF». Чтобы отчёт открывался сразу, разрешите этому сайту всплывающие окна.',
    duration: 15000,
  })
  return 'downloaded'
}
