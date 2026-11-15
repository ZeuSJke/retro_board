/**
 * Health check команды и оценка встречи.
 *
 * Подключение к доске (несколько строк):
 *
 *   const health = useHealthCheck(board.id)
 *   // в обработчике сообщений сокета доски:
 *   if (health.handleServerEvent(msg)) return
 *   // в разметке (onStartForTeam — только тому, кто вправе запускать опрос у всех):
 *   <HealthCheckDialog health={health} onStartForTeam={() => sendMessage(HEALTH_CHECK_START)} />
 *   <RotiPrompt health={health} />
 *   // кнопка в шапке: onClick={health.openDialog}
 *   // после переподключения сокета: health.refresh()
 */
export { default as HealthCheckDialog } from './HealthCheckDialog'
export { default as RotiPrompt } from './RotiPrompt'
export { default as HealthSummaryView } from './HealthSummaryView'
export { HEALTH_CHECK_START, useHealthCheck } from './useHealthCheck'
export type { HealthCheckController } from './useHealthCheck'
