'use client'

import { use } from 'react'
import App from '../../../components/App'

export default function BoardRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <App boardId={id} />
}
