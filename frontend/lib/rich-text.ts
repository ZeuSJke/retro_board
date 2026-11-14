export type RichTextToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'link'; href: string; label: string }

const TOKEN_RE =
  /(`[^`\n]+`|\[[^\]]+\]\((?:https?:\/\/|www\.)[^)\s]+\)|(?:https?:\/\/|www\.)[^\s<>`]+|\*\*[^*\n]+\*\*)/g

export function toSafeHttpHref(raw: string): string | null {
  const candidate = raw.startsWith('www.') ? `https://${raw}` : raw
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return null
  }
  return null
}

function splitTrailingUrlPunctuation(rawUrl: string): { cleanUrl: string; trailing: string } {
  let cleanUrl = rawUrl
  let trailing = ''

  while (cleanUrl.length > 0) {
    const last = cleanUrl[cleanUrl.length - 1]
    if ('.,;:!?'.includes(last)) {
      trailing = last + trailing
      cleanUrl = cleanUrl.slice(0, -1)
      continue
    }
    if (last === ')') {
      const opens = (cleanUrl.match(/\(/g) || []).length
      const closes = (cleanUrl.match(/\)/g) || []).length
      if (closes > opens) {
        trailing = last + trailing
        cleanUrl = cleanUrl.slice(0, -1)
        continue
      }
    }
    break
  }

  return { cleanUrl, trailing }
}

/**
 * Разбирает текст карточки/задачи на безопасные токены: обычный текст,
 * инлайн-код, полужирный текст, markdown-ссылки и URL (http/https/www).
 */
export function parseRichTextTokens(text: string): RichTextToken[] {
  if (!text) return []
  const tokens: RichTextToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }

    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      tokens.push({ type: 'code', value: token.slice(1, -1) })
    } else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      tokens.push({ type: 'bold', value: token.slice(2, -2) })
    } else if (token.startsWith('[')) {
      const mdMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const safeHref = mdMatch ? toSafeHttpHref(mdMatch[2]) : null
      if (mdMatch && safeHref) {
        tokens.push({ type: 'link', href: safeHref, label: mdMatch[1] })
      } else {
        tokens.push({ type: 'text', value: token })
      }
    } else if (
      token.startsWith('http://') ||
      token.startsWith('https://') ||
      token.startsWith('www.')
    ) {
      const { cleanUrl, trailing } = splitTrailingUrlPunctuation(token)
      const safeHref = toSafeHttpHref(cleanUrl)
      if (safeHref) {
        tokens.push({ type: 'link', href: safeHref, label: cleanUrl })
        if (trailing) tokens.push({ type: 'text', value: trailing })
      } else {
        tokens.push({ type: 'text', value: token })
      }
    } else {
      tokens.push({ type: 'text', value: token })
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return tokens
}

export function escapeHtml(str: string = ''): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Преобразует rich-текст (ссылки, **жирный**, `код`, переносы строк) в безопасный HTML для PDF/печати.
 */
export function richTextToHtml(text: string = ''): string {
  return parseRichTextTokens(text)
    .map((tok) => {
      switch (tok.type) {
        case 'code':
          return `<code class="rich-code">${escapeHtml(tok.value)}</code>`
        case 'bold':
          return `<strong>${escapeHtml(tok.value)}</strong>`
        case 'link':
          return `<a class="rich-link" href="${escapeHtml(tok.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tok.label)}</a>`
        case 'text':
        default:
          return escapeHtml(tok.value).replace(/\n/g, '<br>')
      }
    })
    .join('')
}
