import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

/** Ключи кэша React Query для команды, дашборда и админки. */
export const queryKeys = {
  boards: (workspaceId: string) => ['boards', workspaceId] as const,
  boardTemplates: () => ['board-templates'] as const,
  dashboardActionItems: (workspaceId: string, filters: { status: string; boardId: string; assignee: string }) =>
    ['dashboard', workspaceId, 'action-items', filters] as const,
  dashboardTrends: (workspaceId: string) => ['dashboard', workspaceId, 'trends'] as const,
  dashboardHealthTrends: (workspaceId: string) => ['dashboard', workspaceId, 'health-trends'] as const,
  dashboardMoodTrends: (workspaceId: string) => ['dashboard', workspaceId, 'mood-trends'] as const,
  dashboardThemes: (workspaceId: string) => ['dashboard', workspaceId, 'themes'] as const,
  adminWorkspaces: () => ['admin', 'workspaces'] as const,
  adminAiSettings: () => ['admin', 'ai-settings'] as const,
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (process.env.NODE_ENV === 'test') return false
  if (failureCount >= 1) return false
  if (isAxiosError(error) && error.response && error.response.status < 500) {
    return false
  }
  return true
}

/** Создаёт изолированный экземпляр QueryClient с безопасной политикой повторов. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Живые списки и аналитика должны перечитываться при возврате на экран;
        // статические справочники (например, шаблоны досок) задают свой staleTime явно.
        staleTime: 0,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
