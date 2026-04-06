/**
 * job-tracker domain barrel.
 *
 * Default export = JobsPage
 * Named exports  = JobsPanel, hooks
 */
export { default } from '@/features/Jobs.jsx'
export { JobsPanel } from '@/features/Jobs.jsx'

// Hooks
export { useJobsPageState } from './hooks/useJobsPageState'
