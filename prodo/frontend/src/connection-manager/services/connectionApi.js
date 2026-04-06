/**
 * Connection Manager API service layer.
 */
export {
  listConnections,
  upsertConnection,
  deleteConnection,
  testConnection,
  healthcheckConnection,
  getConnectionSchema,
  getConnectionTablePreview,
  getFavorites,
  toggleFavorite,
} from '@/api/client'
