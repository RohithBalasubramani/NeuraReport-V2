/**
 * connection-manager domain barrel.
 *
 * Default export = ConnectionsPage
 * Named exports  = ConnectionForm
 */
export { default } from '@/features/Connections.jsx'
export { ConnectionForm } from '@/features/Connections.jsx'

// Hooks
export { useConnectionFormState } from './hooks/useConnectionFormState'
export { useConnectionsPageState } from './hooks/useConnectionsPageState'
