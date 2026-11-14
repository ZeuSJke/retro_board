'use client';

import React from 'react';

interface RichCardTextProps {
  text: string;
  className?: string;
  onDoubleClick?: (e: React.MouseEvent) => void;
}

const TOKEN_RE = /(`[^`\n]+`|https?:\/\/[^\s<>`]+|\*\*[^*\n]+\*\*)/g;

function splitTrailingUrlPunctuation(rawUrl: string): { cleanUrl: string; trailing: string } {
  let cleanUrl = rawUrl;
  let trailing = '';

  while (cleanUrl.length > 0) {
    const last = cleanUrl[cleanUrl.length - 1];
    if ('.,;:!?'.includes(last)) {
      trailing = last + trailing;
      cleanUrl = cleanUrl.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (cleanUrl.match(/\(/g) || []).length;
      const closes = (cleanUrl.match(/\)/g) || []).length;
      if (closes > opens) {
        trailing = last + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
        continue;
      }
    }
    break;
  }

  return { cleanUrl, trailing };
}

function renderTokenizedText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      nodes.push(
        <code
          key={`c-${idx++}`}
          className="px-1 py-0.5 rounded bg-muted/85 font-mono text-[0.88em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      nodes.push(
        <strong key={`b-${idx++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      const { cleanUrl, trailing } = splitTrailingUrlPunctuation(token);
      let safeHref: string | null = null;
      try {
        const parsed = new URL(cleanUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          safeHref = parsed.toString();
        }
      } catch {
        safeHref = null;
      }

      if (safeHref) {
        nodes.push(
          <a
            key={`u-${idx++}`}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary break-all cursor-pointer"
          >
            {cleanUrl}
          </a>,
        );
        if (trailing) nodes.push(trailing);
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function RichCardText({ text, className, onDoubleClick }: RichCardTextProps) {
  return (
    <span className={className} onDoubleClick={onDoubleClick}>
      {renderTokenizedText(text)}
    </span>
  );
}
