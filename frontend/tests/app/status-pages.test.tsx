import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorPage from '../../app/error'
import NotFound from '../../app/not-found'

describe('app/not-found', () => {
  it('показывает сообщение по-русски и ссылку на главную', () => {
    render(<NotFound />)

    expect(screen.getByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /на главную/i })).toHaveAttribute('href', '/')
  })
})

describe('app/error', () => {
  it('показывает сообщение, повторяет попытку и ведёт на главную', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    const error = new Error('boom')

    render(<ErrorPage error={error} retry={retry} />)

    expect(screen.getByRole('heading', { name: 'Что-то пошло не так' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /на главную/i })).toHaveAttribute('href', '/')
    expect(consoleError).toHaveBeenCalledWith(error)

    await userEvent.click(screen.getByRole('button', { name: /попробовать снова/i }))
    expect(retry).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
  })
})
