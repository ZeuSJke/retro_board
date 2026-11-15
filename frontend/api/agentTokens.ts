import type { AgentToken, AgentTokenCreated, AgentTokenScope } from '../types'
import { api } from './index'

export const getAgentTokens = (): Promise<AgentToken[]> =>
  api.get<AgentToken[]>('/workspaces/agent-tokens').then((r) => r.data)

export const createAgentToken = (data: {
  name: string
  scope: AgentTokenScope
}): Promise<AgentTokenCreated> =>
  api.post<AgentTokenCreated>('/workspaces/agent-tokens', data).then((r) => r.data)

export const revokeAgentToken = (tokenId: string): Promise<AgentToken> =>
  api.delete<AgentToken>(`/workspaces/agent-tokens/${tokenId}`).then((r) => r.data)
