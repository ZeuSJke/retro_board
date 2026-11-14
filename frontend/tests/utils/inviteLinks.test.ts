import { describe, expect, it } from 'vitest'
import {
  buildInviteLink,
  inviteDestination,
  isInviteTokenShape,
  normalizeBoardRef,
} from '../../utils/inviteLinks'

describe('inviteLinks', () => {
  it('строит ссылку в команду и ссылку на доску', () => {
    expect(buildInviteLink('https://retro.example.ru', 'tok_EN-12345')).toBe(
      'https://retro.example.ru/join/tok_EN-12345',
    )
    expect(buildInviteLink('https://retro.example.ru/', 'tok_EN-12345', 'sprint-42')).toBe(
      'https://retro.example.ru/join/tok_EN-12345?board=sprint-42',
    )
    expect(buildInviteLink('https://retro.example.ru', 'tok_EN-12345', null)).toBe(
      'https://retro.example.ru/join/tok_EN-12345',
    )
  })

  it('принимает токены сервера и отклоняет всё остальное без запроса', () => {
    expect(isInviteTokenShape('MWx1oFtEG7ikF_SBeDA9UHH1Km9u4ZQG')).toBe(true)
    expect(isInviteTokenShape('short')).toBe(false)
    expect(isInviteTokenShape('a'.repeat(65))).toBe(false)
    expect(isInviteTokenShape('токен-кириллицей')).toBe(false)
    expect(isInviteTokenShape('with/slash-12345')).toBe(false)
  })

  it('из параметра board берёт только адрес доски: чужой путь или адрес не подставить', () => {
    expect(normalizeBoardRef('retro-sprinta-42')).toBe('retro-sprinta-42')
    expect(normalizeBoardRef('3f2b8c1e-0a4d-4c6e-9b1a-7d5e2f8a9c10')).toBe(
      '3f2b8c1e-0a4d-4c6e-9b1a-7d5e2f8a9c10',
    )
    expect(normalizeBoardRef(['first', 'second'])).toBe('first')
    expect(normalizeBoardRef('../admin')).toBeNull()
    expect(normalizeBoardRef('//evil.example')).toBeNull()
    expect(normalizeBoardRef('a?b=c')).toBeNull()
    expect(normalizeBoardRef('')).toBeNull()
    expect(normalizeBoardRef(undefined)).toBeNull()
  })

  it('после входа ведёт на доску из ссылки или на стартовую страницу', () => {
    expect(inviteDestination('retro-sprinta-42')).toBe('/board/retro-sprinta-42')
    expect(inviteDestination(null)).toBe('/')
  })
})
