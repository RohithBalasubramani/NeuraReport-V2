// hooks/hooks.js — BRIDGE
// All hooks have been extracted to src/shared/hooks/ for modularity.
// This file re-exports everything to maintain backward compatibility.

export { useJobsList, useTrackedJobs } from '../shared/hooks/useJobs'
export { useSharedData } from '../shared/hooks/useSharedData'
export { useKeyboardShortcuts, getShortcutDisplay, SHORTCUTS } from '../shared/hooks/useKeyboardShortcuts'
export { useCrossPageActions } from '../shared/hooks/useCrossPageActions'
export { useIncomingTransfer } from '../shared/hooks/useIncomingTransfer'
export { useBootstrapState, savePersistedCache } from '../shared/hooks/useBootstrapState'
export { default as useStepTimingEstimator, formatDuration } from '../shared/hooks/useStepTimingEstimator'
export { useNetworkStatus } from '../shared/hooks/useNetworkStatus'
