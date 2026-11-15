import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentTokensDialog, { type AgentTokensAdapter } from '../../components/AgentTokensDialog'
import type { AgentToken, AgentTokenCreated } from '../../types'

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

const tokenFixture = (overrides: Partial<AgentToken> = {}): AgentToken => ({
  id: 'tok-1',
  workspace_id: 'ws-1',
  participant_id: 'p-bot-1',
  name: 'Review Bot',
  token_prefix: 'rba_abc123',
  scope: 'read_only',
  created_by_id: 'p-alice',
  created_at: '2026-11-14T10:00:00Z',
  last_used_at: null,
  revoked_at: null,
  ...overrides,
})

function makeAdapter(overrides: Partial<AgentTokensAdapter> = {}): AgentTokensAdapter {
  return {
    list: vi.fn().mockResolvedValue([tokenFixture()]),
    create: vi.fn(),
    revoke: vi.fn(),
    ...overrides,
  }
}

describe('AgentTokensDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('показывает адрес MCP и список токенов с бейджами прав и отзыва', async () => {
    const adapter = makeAdapter({
      list: vi.fn().mockResolvedValue([
        tokenFixture({ id: 't-ro', name: 'Reader', scope: 'read_only' }),
        tokenFixture({
          id: 't-rw',
          name: 'Writer',
          token_prefix: 'rba_rw9999',
          scope: 'read_write',
          revoked_at: '2026-11-15T09:00:00Z',
        }),
      ]),
    })

    render(
      <AgentTokensDialog
        open
        onOpenChange={vi.fn()}
        teamLabel="Платформа"
        adapter={adapter}
      />,
    )

    const dialog = await screen.findByTestId('agent-tokens-dialog')
    expect(within(dialog).getByTestId('mcp-endpoint-input')).toHaveValue(
      `${window.location.origin}/mcp`,
    )

    const roRow = await within(dialog).findByTestId('agent-token-row-t-ro')
    expect(roRow).toHaveTextContent('Reader')
    expect(roRow).toHaveTextContent('Только чтение')
    expect(within(roRow).getByTestId('agent-token-revoke-t-ro')).toBeInTheDocument()

    const rwRow = within(dialog).getByTestId('agent-token-row-t-rw')
    expect(rwRow).toHaveTextContent('Writer')
    expect(rwRow).toHaveTextContent('Чтение и запись')
    expect(rwRow).toHaveTextContent('Отозван')
    expect(within(rwRow).queryByTestId('agent-token-revoke-t-rw')).not.toBeInTheDocument()
  })

  it('проверяет пустое имя, выпускает токен с одноразовым секретом и копирует JSON для MCP', async () => {
    const user = userEvent.setup()
    const created: AgentTokenCreated = {
      token: tokenFixture({
        id: 't-new',
        name: 'Sprint Bot',
        token_prefix: 'rba_new123',
        scope: 'read_write',
      }),
      secret: 'rba_new123_super_secret_value',
    }
    const adapter = makeAdapter({
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(created),
    })

    render(
      <AgentTokensDialog
        open
        onOpenChange={vi.fn()}
        teamLabel="Платформа"
        adapter={adapter}
      />,
    )

    const dialog = await screen.findByTestId('agent-tokens-dialog')
    await within(dialog).findByText('Пока нет ни одного токена агента.')

    await user.click(within(dialog).getByTestId('agent-token-create-btn'))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Укажите имя агента')
    expect(adapter.create).not.toHaveBeenCalled()

    await user.type(within(dialog).getByTestId('agent-token-name-input'), 'Sprint Bot')
    await user.click(within(dialog).getByRole('radio', { name: 'Чтение и запись' }))
    await user.click(within(dialog).getByTestId('agent-token-create-btn'))

    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith({ name: 'Sprint Bot', scope: 'read_write' }),
    )

    const banner = await within(dialog).findByTestId('agent-token-secret-banner')
    expect(within(banner).getByTestId('agent-token-secret-input')).toHaveValue(
      'rba_new123_super_secret_value',
    )
    expect(within(dialog).getByTestId('agent-token-row-t-new')).toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: 'Скопировать конфиг MCP' }))
    const copied = await navigator.clipboard.readText()
    expect(JSON.parse(copied)).toEqual({
      mcpServers: {
        retroboard: {
          type: 'http',
          url: `${window.location.origin}/mcp`,
          headers: {
            Authorization: 'Bearer rba_new123_super_secret_value',
          },
        },
      },
    })
  })

  it('отзывает токен в два шага и сразу помечает строку отозванной', async () => {
    const user = userEvent.setup()
    const created: AgentTokenCreated = {
      token: tokenFixture({ id: 'tok-1', name: 'Review Bot' }),
      secret: 'rba_abc123_secret',
    }
    const revokedToken = tokenFixture({ revoked_at: '2026-11-15T12:00:00Z' })
    const adapter = makeAdapter({
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(created),
      revoke: vi.fn().mockResolvedValue(revokedToken),
    })

    render(<AgentTokensDialog open onOpenChange={vi.fn()} adapter={adapter} />)
    await screen.findByText('Пока нет ни одного токена агента.')

    await user.type(screen.getByTestId('agent-token-name-input'), 'Review Bot')
    await user.click(screen.getByTestId('agent-token-create-btn'))
    expect(await screen.findByTestId('agent-token-secret-banner')).toBeInTheDocument()

    const row = await screen.findByTestId('agent-token-row-tok-1')
    await user.click(within(row).getByTestId('agent-token-revoke-tok-1'))
    expect(adapter.revoke).not.toHaveBeenCalled()

    await user.click(within(row).getByTestId('agent-token-confirm-revoke-tok-1'))
    await waitFor(() => expect(adapter.revoke).toHaveBeenCalledWith('tok-1'))

    expect(row).toHaveTextContent('Отозван')
    expect(within(row).queryByTestId('agent-token-revoke-tok-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-token-secret-banner')).not.toBeInTheDocument()
  })

  it('обновляет список по кнопке', async () => {
    const user = userEvent.setup()
    const adapter = makeAdapter({
      list: vi
        .fn()
        .mockResolvedValueOnce([tokenFixture({ id: 't-old', name: 'Старый Bot' })])
        .mockResolvedValueOnce([tokenFixture({ id: 't-new', name: 'Новый Bot' })]),
    })

    render(<AgentTokensDialog open onOpenChange={vi.fn()} adapter={adapter} />)
    expect(await screen.findByText('Старый Bot')).toBeInTheDocument()

    await user.click(screen.getByTestId('agent-tokens-refresh-btn'))

    expect(await screen.findByText('Новый Bot')).toBeInTheDocument()
    expect(adapter.list).toHaveBeenCalledTimes(2)
  })

  it('при ошибке загрузки даёт повторить запрос', async () => {
    const user = userEvent.setup()
    const adapter = makeAdapter({
      list: vi
        .fn()
        .mockRejectedValueOnce({ response: { data: { detail: 'Сервис недоступен' } } })
        .mockResolvedValueOnce([tokenFixture({ name: 'Recovered Bot' })]),
    })

    render(<AgentTokensDialog open onOpenChange={vi.fn()} adapter={adapter} />)
    expect(await screen.findByText('Сервис недоступен')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Recovered Bot')).toBeInTheDocument()
    expect(adapter.list).toHaveBeenCalledTimes(2)
  })
})
