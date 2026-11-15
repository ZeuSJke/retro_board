import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatBoardMarkdown } from '../../lib/export-markdown'
import { showToast } from '../../store/toastStore'
import type { ActionItem, Board } from '../../types'
import { buildBoardPDFHtml, exportBoardToPDF } from '../../utils/exportPDF'

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const board: Board = {
  id: 'b-1',
  name: 'Спринт 42',
  slug: 'sprint-42',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  columns: [],
}

const task = (id: string, extra: Partial<ActionItem> = {}): ActionItem => ({
  id,
  board_id: 'b-1',
  title: `Задача ${id}`,
  text: 'Текст',
  assignee: null,
  source_card_ids: [],
  status: 'open',
  completed_at: null,
  created_at: '2026-03-01T10:00:00Z',
  ...extra,
})

describe('exportBoardToPDF — окно печати', () => {
  let clicks: HTMLAnchorElement[]
  let originalCreate: typeof URL.createObjectURL | undefined
  let originalRevoke: typeof URL.revokeObjectURL | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    clicks = []
    originalCreate = URL.createObjectURL
    originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:report')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCreate) URL.createObjectURL = originalCreate
    if (originalRevoke) URL.revokeObjectURL = originalRevoke
  })

  it('окно открылось — ничего не скачиваем и ничего не объясняем', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    expect(exportBoardToPDF(board, [])).toBe('opened')

    expect(open).toHaveBeenCalledWith('blob:report', '_blank')
    expect(clicks).toHaveLength(0)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('браузер заблокировал окно — файл сохраняется, и человеку объясняют, что произошло', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)

    expect(exportBoardToPDF(board, [])).toBe('downloaded')

    expect(clicks).toHaveLength(1)
    expect(clicks[0].download).toBe('retro-Спринт_42.html')
    expect(showToast).toHaveBeenCalledTimes(1)
    const [title, type, options] = vi.mocked(showToast).mock.calls[0]
    expect(title).toBe('Браузер не дал открыть окно печати')
    expect(type).toBe('info')
    // Что случилось, что делать с файлом и как избежать этого в следующий раз
    expect(options?.description).toContain('retro-Спринт_42.html')
    expect(options?.description).toContain('Сохранить как PDF')
    expect(options?.description).toContain('всплывающие окна')
    // Длинный текст не должен исчезнуть раньше, чем его прочитают
    expect(options?.duration).toBeGreaterThanOrEqual(10000)
  })
})

describe('экспорт — задачи', () => {
  const tasks = [task('1'), task('2', { status: 'done' }), task('3', { superseded_by_id: 'copy-3' })]

  it('Markdown: раздел называется «Задачи», перенесённая задача помечена', () => {
    const md = formatBoardMarkdown(board, tasks)

    expect(md).toContain('## Задачи (3)')
    expect(md).not.toContain('по итогам')
    expect(md).toContain('- [ ] **Задача 1** — Открыта')
    expect(md).toContain('- [x] **Задача 2** — Выполнена')
    expect(md).toContain('- [ ] **Задача 3** — Перенесена на другую доску')
  })

  it('отчёт для печати: перенесённая задача не выглядит открытой', () => {
    const html = buildBoardPDFHtml(board, [], tasks)

    expect(html).toContain('<h2 class="section-title">Задачи</h2>')
    expect(html).toContain('Перенесена на другую доску')
    // Статус «Открыто» остался только у первой задачи
    expect(html.match(/>Открыто</g)).toHaveLength(1)
  })
})
