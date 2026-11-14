import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LazyCommandPalette from '../../components/CommandPaletteLazy'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

const baseProps = {
  boards: [],
  onSelectBoard: vi.fn(),
  onCreateBoard: vi.fn(),
  onNavigateDashboard: vi.fn(),
}

describe('LazyCommandPalette', () => {
  it('пока палитру не открывали, ничего не рисует, но ловит Ctrl+K', () => {
    const onOpenChange = vi.fn()
    render(<LazyCommandPalette {...baseProps} open={false} onOpenChange={onOpenChange} />)

    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('не реагирует на K без Ctrl/Cmd', () => {
    const onOpenChange = vi.fn()
    render(<LazyCommandPalette {...baseProps} open={false} onOpenChange={onOpenChange} />)

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK' })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('при открытии подгружает и показывает палитру', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <LazyCommandPalette {...baseProps} open={false} onOpenChange={onOpenChange} />,
    )

    rerender(<LazyCommandPalette {...baseProps} open onOpenChange={onOpenChange} />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Найти доску или команду...')).toBeInTheDocument()

    // дальше сочетание обрабатывает сама палитра: одно нажатие — один вызов (закрыть)
    onOpenChange.mockClear()
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
