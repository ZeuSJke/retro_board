'use client'

import { use } from 'react'
import { normalizeBoardRef } from '@/utils/inviteLinks'
import InviteJoin from './InviteJoin'

interface JoinRoutePageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ board?: string | string[] }>
}

/** Вход по ссылке-приглашению: `/join/<токен>` и `/join/<токен>?board=<доска>`. */
export default function JoinRoutePage({ params, searchParams }: JoinRoutePageProps) {
  const { token } = use(params)
  const { board } = use(searchParams)
  // Другая ссылка — другая проверка: состояние прежней не переносим
  return <InviteJoin key={token} token={token} boardRef={normalizeBoardRef(board)} />
}
