'use client'

import { use } from 'react'
import App from '../../../components/App'

export default function BoardRoutePage({ params }) {
  const { id } = use(params)
  return <App boardId={id} />
}
