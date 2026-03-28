/**
 * Extract a human-readable error message from an API error (typically Axios).
 * Avoids unsafe `as` casts scattered across components.
 */
export function getApiErrorMessage(error: unknown, fallback = 'Произошла ошибка'): string {
  if (error != null && typeof error === 'object') {
    const err = error as { response?: { data?: { detail?: string } } }
    const detail = err.response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }
  }
  return fallback
}
