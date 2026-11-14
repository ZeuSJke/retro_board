import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../../utils/clipboard'

describe('copyText', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

  function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    })
  }

  function stubExecCommand(result: boolean) {
    const execCommand = vi.fn(() => result)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    return execCommand
  }

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
    else Reflect.deleteProperty(document, 'execCommand')
    document.body.innerHTML = ''
  })

  it('пишет через Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    await expect(copyText('https://retro.example.ru/join/abc')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://retro.example.ru/join/abc')
  })

  it('без Clipboard API (страница по HTTP) копирует через выделение и убирает временное поле', async () => {
    stubClipboard(undefined)
    const execCommand = stubExecCommand(true)

    await expect(copyText('ссылка')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('запасной способ выделяет поле, где ссылка уже показана, а не создаёт новое', async () => {
    stubClipboard(undefined)
    stubExecCommand(true)
    const field = document.createElement('input')
    field.value = 'https://retro.example.ru/join/abc'
    document.body.appendChild(field)
    const select = vi.spyOn(field, 'select')
    const appendChild = vi.spyOn(document.body, 'appendChild')

    await expect(copyText('https://retro.example.ru/join/abc', field)).resolves.toBe(true)
    expect(select).toHaveBeenCalledTimes(1)
    expect(appendChild).not.toHaveBeenCalled()
  })

  it('отказ браузера — false, а не исключение', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    stubExecCommand(false)

    await expect(copyText('ссылка')).resolves.toBe(false)
  })
})
