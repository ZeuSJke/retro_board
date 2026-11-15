/**
 * Сравнение пропсов для мемоизации колонок, групп и карточек.
 *
 * Все пропсы сравниваются по ссылке, кроме счётчика голосов участника. `userTotalVotes`
 * меняется при каждом собственном лайке, но на карточку влияет только через «лимит
 * исчерпан»: пока лимит не достигнут, точное число ей не нужно. Без этого один лайк
 * перерисовывал бы все карточки доски.
 */
interface VoteLimitProps {
  maxVotes?: number
  userTotalVotes?: number
}

function voteLimitReached(props: VoteLimitProps): boolean {
  const max = props.maxVotes ?? 0
  return max > 0 && (props.userTotalVotes ?? 0) >= max
}

export function sameExceptVoteCount<P extends VoteLimitProps>(prev: P, next: P): boolean {
  const prevKeys = Object.keys(prev) as (keyof P)[]
  const nextKeys = Object.keys(next) as (keyof P)[]
  if (prevKeys.length !== nextKeys.length) return false
  for (const key of nextKeys) {
    if (key === 'userTotalVotes') continue
    if (!Object.is(prev[key], next[key])) return false
  }
  const reached = voteLimitReached(next)
  if (reached !== voteLimitReached(prev)) return false
  // Лимит исчерпан: число голосов показано в подсказке — оно должно быть точным
  return !reached || prev.userTotalVotes === next.userTotalVotes
}
