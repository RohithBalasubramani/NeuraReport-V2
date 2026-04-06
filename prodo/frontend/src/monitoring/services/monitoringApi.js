/**
 * Monitoring API service layer.
 * Re-exports API calls used by the monitoring domain.
 */
export {
  api,
  discoverLoggerDatabases,
  listConnections,
  upsertConnection,
} from '@/api/client'
