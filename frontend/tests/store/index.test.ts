import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../../store'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      username: 'Аноним',
      currentBoardId: null,
      theme: { primary: '#6750A4', dark: false },
    })
  })

  it('has correct default values', () => {
    const state = useAppStore.getState()
    expect(state.username).toBe('Аноним')
    expect(state.currentBoardId).toBeNull()
    expect(state.theme).toEqual({ primary: '#6750A4', dark: false })
  })

  it('setUsername updates username', () => {
    useAppStore.getState().setUsername('Alice')
    expect(useAppStore.getState().username).toBe('Alice')
  })

  it('setCurrentBoard updates currentBoardId', () => {
    useAppStore.getState().setCurrentBoard('board-123')
    expect(useAppStore.getState().currentBoardId).toBe('board-123')
  })

  it('setTheme updates theme', () => {
    useAppStore.getState().setTheme({ primary: '#FF0000', dark: true })
    expect(useAppStore.getState().theme).toEqual({ primary: '#FF0000', dark: true })
  })
})
