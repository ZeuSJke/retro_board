import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionBar from '../../components/SessionBar'
import { TooltipProvider } from '../../components/ui/tooltip'
import type { FacilitatorInfo } from '../../types'

const noFacilitator: FacilitatorInfo = { id: null, name: null, online: false }
const me: FacilitatorInfo = { id: 'p-me', name: 'Анна', online: true }
const other: FacilitatorInfo = { id: 'p-other', name: 'Борис', online: true }

function renderSessionBar(props: Partial<React.ComponentProps<typeof SessionBar>> = {}) {
  const handlers = {
    onFacilitatorStart: vi.fn(),
    onFacilitatorStop: vi.fn(),
    onResetMyVotes: vi.fn(),
    onAutoAdvanceChange: vi.fn(),
  }
  const view = render(
    <TooltipProvider>
      <SessionBar
        facilitator={noFacilitator}
        phase={null}
        myId="p-me"
        onlineCount={2}
        readyIds={[]}
        isLocked={false}
        usedVotes={0}
        maxVotes={5}
        timer={{ duration: 300, remaining: 300, running: false }}
        autoAdvance={false}
        soundMuted
        onToggleSoundMuted={vi.fn()}
        onTimerStart={vi.fn()}
        onTimerPause={vi.fn()}
        onTimerReset={vi.fn()}
        onAddTime={vi.fn()}
        onPhaseChange={vi.fn()}
        onNextPhase={vi.fn()}
        onToggleReady={vi.fn()}
        onSendReaction={vi.fn()}
        {...handlers}
        {...props}
      />
    </TooltipProvider>,
  )
  return { ...view, ...handlers }
}

describe('SessionBar — «Стать ведущим» на заблокированной доске', () => {
  it('на обычной доске кнопка начинает сессию', async () => {
    const user = userEvent.setup()
    const { onFacilitatorStart } = renderSessionBar()

    const button = screen.getByTestId('become-facilitator-btn')
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('title', 'Стать ведущим')
    await user.click(button)

    expect(onFacilitatorStart).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('locked-session-hint')).not.toBeInTheDocument()
  })

  it('на заблокированной доске кнопка отключена и объясняет почему', async () => {
    const user = userEvent.setup()
    const { onFacilitatorStart } = renderSessionBar({ isLocked: true })

    const button = screen.getByTestId('become-facilitator-btn')
    expect(button).toBeDisabled()
    expect(button.getAttribute('title')).toContain('Доска заблокирована')
    expect(screen.getByTestId('locked-session-hint')).toHaveTextContent('разблокируйте доску в настройках')
    await user.click(button)

    // Одно нажатие больше не прячет архивные карточки у всей команды
    expect(onFacilitatorStart).not.toHaveBeenCalled()
  })
})

describe('SessionBar — счётчик своих голосов', () => {
  it('без голосов и вне голосования счётчика нет', () => {
    renderSessionBar()
    expect(screen.queryByTestId('my-votes')).not.toBeInTheDocument()
  })

  it('голоса есть — счётчик и «Сброс» видны вне сессии', async () => {
    const user = userEvent.setup()
    const { onResetMyVotes } = renderSessionBar({ usedVotes: 2 })

    expect(screen.getByTestId('my-votes')).toHaveTextContent('3/5')
    await user.click(screen.getByTestId('reset-votes-btn'))
    expect(onResetMyVotes).toHaveBeenCalledTimes(1)
  })

  it('голоса есть — счётчик виден в любой фазе сессии, не только в «Голосовании»', () => {
    renderSessionBar({ facilitator: other, phase: 'discuss', usedVotes: 1 })

    expect(screen.getByTestId('my-votes')).toHaveTextContent('4/5')
    expect(screen.getByTestId('reset-votes-btn')).toBeInTheDocument()
  })

  it('в «Голосовании» счётчик виден и без голосов, «Сброса» при этом нет', () => {
    renderSessionBar({ facilitator: other, phase: 'vote', votedParticipantsCount: 0 })

    expect(screen.getByTestId('my-votes')).toHaveTextContent('5/5')
    expect(screen.queryByTestId('reset-votes-btn')).not.toBeInTheDocument()
    expect(screen.getByTestId('voted-count')).toHaveTextContent('Проголосовали 0/2')
  })

  it('лимит исчерпан — счётчик говорит об этом', () => {
    renderSessionBar({ usedVotes: 5 })
    expect(screen.getByTestId('my-votes')).toHaveTextContent('0/5 · лимит')
  })

  it('на заблокированной доске голоса видны, но сбросить их нельзя', () => {
    renderSessionBar({ isLocked: true, usedVotes: 2 })

    expect(screen.getByTestId('my-votes')).toBeInTheDocument()
    expect(screen.queryByTestId('reset-votes-btn')).not.toBeInTheDocument()
  })
})

describe('SessionBar — завершение сессии', () => {
  async function openStopDialog(phase: string) {
    const user = userEvent.setup()
    const view = renderSessionBar({ facilitator: me, phase })
    await user.click(screen.getByTestId('stop-facilitator-btn'))
    return { user, dialog: screen.getByRole('alertdialog'), ...view }
  }

  it('кнопка называет действие полностью в подсказке', () => {
    renderSessionBar({ facilitator: me, phase: 'brainstorm' })
    expect(screen.getByTestId('stop-facilitator-btn')).toHaveAttribute('title', 'Завершить режим ведущего')
  })

  it('в «Штурме» предупреждает, что скрытые карточки раскроются', async () => {
    const { dialog } = await openStopDialog('brainstorm')

    expect(dialog).toHaveTextContent('Сейчас идёт «Штурм»')
    expect(dialog).toHaveTextContent('откроются всей команде')
    expect(dialog).not.toHaveTextContent(/фасилитац/i)
  })

  it('после раскрытия не обещает раскрыть то, что уже видно', async () => {
    const { dialog } = await openStopDialog('vote')

    expect(dialog).toHaveTextContent('Карточки уже раскрыты')
    expect(dialog).not.toHaveTextContent('Сейчас идёт «Штурм»')
  })

  it('завершение передаёт, блокировать ли доску', async () => {
    const { user, dialog, onFacilitatorStop } = await openStopDialog('summary')

    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Завершить' }))

    expect(onFacilitatorStop).toHaveBeenCalledWith(true)
  })
})

describe('SessionBar — авто-переход таймера', () => {
  it('вне сессии переключатель отключён с пояснением: переходить некуда', async () => {
    const user = userEvent.setup()
    const { onAutoAdvanceChange } = renderSessionBar({ autoAdvance: true })

    await user.click(screen.getByRole('button', { name: /05:00/ }))

    const toggle = await screen.findByRole('switch', { name: 'Авто-переход после 00:00' })
    expect(toggle).toBeDisabled()
    // Сохранённая когда-то настройка не выглядит включённой там, где не работает
    expect(toggle).not.toBeChecked()
    expect(screen.getByTestId('auto-advance-hint')).toHaveTextContent('Работает в сессии ведущего')
    await user.click(toggle)
    expect(onAutoAdvanceChange).not.toHaveBeenCalled()
  })

  it('ведущий в сессии включает авто-переход', async () => {
    const user = userEvent.setup()
    const { onAutoAdvanceChange } = renderSessionBar({ facilitator: me, phase: 'brainstorm' })

    await user.click(screen.getByRole('button', { name: /05:00/ }))
    const toggle = await screen.findByRole('switch', { name: 'Авто-переход после 00:00' })

    expect(toggle).toBeEnabled()
    expect(screen.queryByTestId('auto-advance-hint')).not.toBeInTheDocument()
    await user.click(toggle)
    expect(onAutoAdvanceChange).toHaveBeenCalledWith(true)
  })
})

describe('SessionBar — этапы', () => {
  it('у каждого этапа есть название для подсказки и экранного диктора', () => {
    renderSessionBar({ facilitator: other, phase: 'discuss' })

    for (const label of ['Штурм', 'Раскрытие', 'Обсуждение', 'Голосование', 'Итоги']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', label)
    }
    expect(screen.getByRole('button', { name: 'Обсуждение' })).toHaveAttribute('aria-current', 'step')
  })
})
