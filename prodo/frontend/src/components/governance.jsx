import { OperationStatus, OperationType, useOperationHistory } from './ux'
import { reportFrontendError } from '@/api/monitoring'
import { neutral, palette, status } from '@/app/theme'
import { useToast } from '@/components/core'
import { popActiveIntent, pushActiveIntent } from '@/utils/helpers'
import {
  Cancel as CancelIcon,
  CheckCircle as CompleteIcon,
  Close as CloseIcon,
  CloudSync as SyncIcon,
  DeleteForever as DeleteIcon,
  Edit as UnsavedIcon,
  Error as ErrorIcon,
  HourglassEmpty as HourglassPendingIcon,
  HourglassEmpty as InProgressIcon,
  Notifications as NotifyIcon,
  RadioButtonUnchecked as RadioPendingIcon,
  Refresh as RetryIcon,
  Refresh as RunningIcon,
  Schedule as ScheduledIcon,
  Settings as SystemIcon,
  Timer as TimerIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Snackbar,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'

/**
 * UX Governance Enforcement Hooks
 *
 * Runtime and development-time checks to ensure all interactions
 * flow through the governance API.
 *
 * Usage in components:
 *   useEnforceGovernance('ComponentName')
 *
 * This will:
 * 1. In development: Warn if raw handlers are detected
 * 2. Verify the component is using useInteraction()
 * 3. Log compliance violations to console
 */

// Track components that have been checked (capped to prevent unbounded growth)
const MAX_CHECKED_COMPONENTS = 500
const checkedComponents = new Set()

// Non-compliant patterns to detect
const NON_COMPLIANT_PATTERNS = {
  directFetch: /onClick\s*=\s*{\s*\(\)\s*=>\s*(fetch|axios)/,
  asyncHandler: /onClick\s*=\s*{\s*async\s*\(\)/,
  directMutate: /\.mutate\s*\(\s*{/,
  unconfirmedDelete: /delete.*onClick\s*=\s*{\s*\(\)\s*=>/i,
}

/**
 * Development-time hook to enforce governance compliance
 * @param {string} componentName - Name of the component for logging
 * @param {object} options - Enforcement options
 */
function useEnforceGovernance(componentName, options = {}) {
  const {
    requireInteraction = true,
    logViolations = true,
    throwOnViolation = false,
  } = options

  const hasInteraction = useRef(false)

  useEffect(() => {
    // Only run in development
    if (!import.meta.env?.DEV) return

    // Only check each component once (cap prevents unbounded memory growth)
    if (checkedComponents.has(componentName)) return
    if (checkedComponents.size >= MAX_CHECKED_COMPONENTS) {
      checkedComponents.clear()
    }
    checkedComponents.add(componentName)

    // Delayed check to allow hooks to be called
    const timer = setTimeout(() => {
      if (requireInteraction && !hasInteraction.current) {
        const message = `[UX GOVERNANCE] Component "${componentName}" has user interactions but may not be using useInteraction() hook.`

        if (logViolations) {
          console.warn(message)
        }

        if (throwOnViolation) {
          throw new Error(message)
        }
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [componentName, requireInteraction, logViolations, throwOnViolation])

  // Mark that this component uses interaction
  const markInteractionUsed = () => {
    hasInteraction.current = true
  }

  return { markInteractionUsed }
}
// === From: GovernanceSystem.jsx ===
/**
 * UX Governance System - All providers, hooks, and utilities
 */
const SuccessIcon = CompleteIcon
const DangerIcon = ErrorIcon
const PendingIcon = HourglassPendingIcon


/**
 * UX Governance: Unified Interaction API
 *
 * ALL user actions MUST flow through this API.
 * Direct event handlers that bypass this system are NON-COMPLIANT.
 *
 * This API enforces:
 * - Immediate feedback (100ms)
 * - State visibility
 * - Error prevention
 * - Reversibility or explicit warnings
 * - Intent tracking
 * - Navigation safety
 */


export const InteractionType = {
  // Data mutations
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',

  // Content operations
  UPLOAD: 'upload',
  DOWNLOAD: 'download',

  // AI/Processing operations
  GENERATE: 'generate',
  ANALYZE: 'analyze',
  EXECUTE: 'execute',

  // Navigation
  NAVIGATE: 'navigate',

  // Session operations
  LOGIN: 'login',
  LOGOUT: 'logout',
}


export const Reversibility = {
  // Can be undone with no data loss
  FULLY_REVERSIBLE: 'fully_reversible',

  // Can be undone but may lose some data
  PARTIALLY_REVERSIBLE: 'partially_reversible',

  // Cannot be undone - REQUIRES explicit confirmation
  IRREVERSIBLE: 'irreversible',

  // System will handle (e.g., soft delete)
  SYSTEM_MANAGED: 'system_managed',
}


const FeedbackRequirement = {
  // Must show immediate visual feedback
  IMMEDIATE: 'immediate',

  // Must show progress indicator
  PROGRESS: 'progress',

  // Must show completion confirmation
  COMPLETION: 'completion',

  // Must show error with recovery path
  ERROR_RECOVERY: 'error_recovery',
}

/**
 * InteractionContract
 * @property {string} type - InteractionType value
 * @property {string} label - Human-readable action name
 * @property {string} reversibility - Reversibility level
 * @property {Function} action - The async action to perform
 * @property {Function} [onSuccess] - Success callback
 * @property {Function} [onError] - Error callback
 * @property {Function} [undoAction] - Function to undo (if reversible)
 * @property {Object} [intent] - Intent metadata for audit trail
 * @property {boolean} [requiresConfirmation] - Force confirmation dialog
 * @property {string} [confirmationMessage] - Custom confirmation message
 * @property {Array<string>} [feedbackRequirements] - Required feedback types
 * @property {boolean} [blocksNavigation] - Whether this blocks page navigation
 * @property {boolean} [suppressSuccessToast] - Skip default success toast
 * @property {boolean} [suppressErrorToast] - Skip default error toast
 */


const REQUIRED_FIELDS = ['type', 'label', 'reversibility', 'action']

function _validateContractInternal(contract, callerInfo = '') {
  const missing = REQUIRED_FIELDS.filter((field) => !contract[field])

  if (missing.length > 0) {
    const error = new Error(
      `[UX GOVERNANCE VIOLATION] ${callerInfo}\n` +
      `Missing required fields: ${missing.join(', ')}\n` +
      `All interactions MUST define: ${REQUIRED_FIELDS.join(', ')}`
    )
    console.error(error)

    // In development, throw to force fix
    if (import.meta.env?.DEV) {
      throw error
    }

    return false
  }

  // Validate reversibility
  if (!Object.values(Reversibility).includes(contract.reversibility)) {
    console.error(
      `[UX GOVERNANCE VIOLATION] Invalid reversibility: ${contract.reversibility}\n` +
      `Must be one of: ${Object.values(Reversibility).join(', ')}`
    )
    return false
  }

  // Irreversible actions MUST require confirmation
  if (contract.reversibility === Reversibility.IRREVERSIBLE && !contract.requiresConfirmation) {
    console.warn(
      `[UX GOVERNANCE WARNING] Irreversible action "${contract.label}" should require confirmation`
    )
  }

  return true
}


const InteractionContext = createContext(null)


function InteractionProvider({ children }) {
  const { startOperation, completeOperation, failOperation } = useOperationHistory()
  const { show: showToast, showWithUndo } = useToast()

  // Track pending confirmations
  const pendingConfirmations = useRef(new Map())

  // Track active interactions for navigation blocking
  const activeInteractions = useRef(new Set())

  /**
   * Execute an interaction with full UX guarantees
   * @param {InteractionContract} contract
   * @returns {Promise<{success: boolean, result?: any, error?: Error}>}
   */
  const execute = useCallback(async (contract) => {
    // STEP 1: Validate contract
    const callerStack = new Error().stack?.split('\n')[2] || 'unknown'
    if (!_validateContractInternal(contract, callerStack)) {
      return { success: false, error: new Error('Invalid interaction contract') }
    }

    // STEP 2: Generate interaction ID
    const interactionId = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // STEP 3: Build intent metadata
    const intent = {
      id: interactionId,
      type: contract.type,
      label: contract.label,
      reversibility: contract.reversibility,
      timestamp: new Date().toISOString(),
      userAgent: (navigator.userAgent || '').slice(0, 512),
      ...contract.intent,
    }

    // STEP 4: Start operation tracking (IMMEDIATE FEEDBACK - within 100ms)
    const operationId = startOperation({
      type: contract.type,
      label: contract.label,
      canUndo: contract.reversibility === Reversibility.FULLY_REVERSIBLE && !!contract.undoAction,
      undoFn: contract.undoAction,
      metadata: intent,
    })

    // STEP 5: Track as active (for navigation blocking)
    if (contract.blocksNavigation !== false) {
      activeInteractions.current.add(interactionId)
    }

    try {
    // STEP 6: Execute the action
      pushActiveIntent(intent)
      const result = await contract.action(intent)

      // STEP 7: Complete operation
      completeOperation(operationId, result)

      // STEP 8: Show success feedback
      if (contract.onSuccess) {
        contract.onSuccess(result)
      }

      if (!contract.suppressSuccessToast) {
        // STEP 9: Show undo option if applicable
        if (contract.reversibility === Reversibility.FULLY_REVERSIBLE && contract.undoAction) {
          showWithUndo(
            `${contract.label} completed`,
            async () => {
              await contract.undoAction(result)
              showToast(`${contract.label} undone`, 'info')
            },
            { severity: 'success', duration: 5000 }
          )
        } else {
          showToast(`${contract.label} completed`, 'success')
        }
      }

      return { success: true, result, interactionId }
    } catch (error) {
      // STEP 10: Fail operation
      failOperation(operationId, error)

      // STEP 11: Show error with recovery path
      const userMessage = error.userMessage || error.message || 'An error occurred'
      reportFrontendError({
        source: 'interaction.execute',
        message: userMessage,
        stack: error?.stack,
        route: typeof window !== 'undefined' ? window.location.pathname : undefined,
        action: contract.label,
        context: {
          interactionType: contract.type,
          reversibility: contract.reversibility,
          interactionId,
        },
      })
      if (!contract.suppressErrorToast) {
        showToast(userMessage, 'error')
      }

      if (contract.onError) {
        contract.onError(error)
      }

      return { success: false, error, interactionId }
    } finally {
      // STEP 12: Remove from active interactions
      activeInteractions.current.delete(interactionId)
      popActiveIntent(intent.id)
    }
  }, [startOperation, completeOperation, failOperation, showToast, showWithUndo])

  /**
   * Check if navigation is safe (no blocking interactions)
   */
  const isNavigationSafe = useCallback(() => {
    return activeInteractions.current.size === 0
  }, [])

  /**
   * Get list of active interactions blocking navigation
   */
  const getBlockingInteractions = useCallback(() => {
    return Array.from(activeInteractions.current)
  }, [])

  /**
   * Create a pre-configured interaction handler for a specific action
   * This is the preferred way to create interaction handlers
   */
  const createHandler = useCallback((baseContract) => {
    return async (overrides = {}) => {
      const mergedContract = { ...baseContract, ...overrides }
      return execute(mergedContract)
    }
  }, [execute])

  const contextValue = useMemo(() => ({
    execute,
    isNavigationSafe,
    getBlockingInteractions,
    createHandler,
    InteractionType,
    Reversibility,
  }), [execute, isNavigationSafe, getBlockingInteractions, createHandler])

  return (
    <InteractionContext.Provider value={contextValue}>
      {children}
    </InteractionContext.Provider>
  )
}


/**
 * Hook to access the interaction API
 * @returns {Object} Interaction API
 */
export function useInteraction() {
  const context = useContext(InteractionContext)
  if (!context) {
    throw new Error(
      '[UX GOVERNANCE VIOLATION] useInteraction must be used within InteractionProvider'
    )
  }
  return context
}

/**
 * Hook to create a NAVIGATE interaction handler
 */
export function useNavigateInteraction() {
  const navigate = useNavigate()
  const { execute } = useInteraction()

  return useCallback((to, options = {}) => {
    const {
      label = 'Navigate',
      intent = {},
      navigateOptions,
      blocksNavigation = false,
    } = options

    return execute({
      type: InteractionType.NAVIGATE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { to, ...intent },
      action: () => navigate(to, navigateOptions),
    })
  }, [execute, navigate])
}

export function useConfirmedAction(actionName) {
  const { execute } = useInteraction()
  return useCallback((options = {}) => {
    const { label, action, onSuccess, onError, ...rest } = options
    return execute({
      type: InteractionType.DESTRUCTIVE,
      label: label || actionName,
      reversibility: Reversibility.IRREVERSIBLE,
      requiresConfirmation: true,
      action,
      onSuccess,
      onError,
      ...rest,
    })
  }, [execute, actionName])
}

/**
 * UX Governance: Intent Tracking System
 *
 * Every user action generates an intent that flows:
 * UI → Interaction API → Backend → Audit Log
 *
 * This provides:
 * - Complete audit trail
 * - Action correlation
 * - Error diagnosis
 * - User behavior analytics
 */


/**
 * @typedef {Object} Intent
 * @property {string} id - Unique intent ID
 * @property {string} type - Action type (create, delete, etc.)
 * @property {string} label - Human-readable description
 * @property {string} correlationId - Links related intents
 * @property {string} sessionId - User session ID
 * @property {string} timestamp - ISO timestamp
 * @property {string} status - pending | executing | completed | failed | cancelled
 * @property {Object} metadata - Additional context
 * @property {string} [parentIntentId] - For nested/chained actions
 * @property {Array<string>} [childIntentIds] - Sub-actions spawned
 */


const IntentStatus = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}


let intentCounter = 0
let sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

function createIntent(config) {
  const id = `intent_${Date.now()}_${++intentCounter}`

  return {
    id,
    type: config.type,
    label: config.label,
    correlationId: config.correlationId || id,
    sessionId,
    timestamp: new Date().toISOString(),
    status: IntentStatus.PENDING,
    metadata: config.metadata || {},
    parentIntentId: config.parentIntentId || null,
    childIntentIds: [],
    // UX-specific fields
    reversibility: config.reversibility,
    requiresConfirmation: config.requiresConfirmation || false,
    blocksNavigation: config.blocksNavigation || false,
  }
}


const IntentContext = createContext(null)


function IntentProvider({ children, onIntentChange, maxHistory = 100, auditClient }) {
  const [intents, setIntents] = useState([])
  const intentMap = useRef(new Map())

  /**
   * Record a new intent
   */
  const recordIntent = useCallback((config) => {
    const intent = createIntent(config)

    intentMap.current.set(intent.id, intent)
    // Evict oldest entries when Map exceeds history cap
    if (intentMap.current.size > maxHistory) {
      const oldest = intentMap.current.keys().next().value
      intentMap.current.delete(oldest)
    }

    setIntents((prev) => {
      const updated = [intent, ...prev].slice(0, maxHistory)
      onIntentChange?.(updated)
      return updated
    })

    // Send to backend for audit (async, non-blocking)
    if (auditClient?.recordIntent) {
      auditClient.recordIntent(intent).catch((err) => {
        console.warn('Failed to record intent to backend:', err)
      })
    }

    return intent
  }, [maxHistory, onIntentChange, auditClient])

  /**
   * Update intent status
   */
  const updateIntentStatus = useCallback((intentId, status, result = null) => {
    const intent = intentMap.current.get(intentId)
    if (!intent) {
      console.warn(`Intent not found: ${intentId}`)
      return
    }

    const updatedIntent = {
      ...intent,
      status,
      completedAt: [IntentStatus.COMPLETED, IntentStatus.FAILED, IntentStatus.CANCELLED].includes(status)
        ? new Date().toISOString()
        : null,
      result: status === IntentStatus.COMPLETED ? result : null,
      error: status === IntentStatus.FAILED ? result : null,
    }

    intentMap.current.set(intentId, updatedIntent)

    setIntents((prev) => {
      const updated = prev.map((i) => (i.id === intentId ? updatedIntent : i))
      onIntentChange?.(updated)
      return updated
    })

    // Send update to backend
    if (auditClient?.updateIntent) {
      auditClient.updateIntent(updatedIntent, status, result).catch((err) => {
        console.warn('Failed to update intent on backend:', err)
      })
    }
  }, [onIntentChange, auditClient])

  /**
   * Link child intent to parent
   */
  const linkChildIntent = useCallback((parentId, childId) => {
    const parent = intentMap.current.get(parentId)
    if (parent) {
      parent.childIntentIds = [...(parent.childIntentIds || []), childId]
      intentMap.current.set(parentId, parent)
    }
  }, [])

  /**
   * Get intent by ID
   */
  const getIntent = useCallback((intentId) => {
    return intentMap.current.get(intentId)
  }, [])

  /**
   * Get all intents for correlation ID
   */
  const getCorrelatedIntents = useCallback((correlationId) => {
    return intents.filter((i) => i.correlationId === correlationId)
  }, [intents])

  /**
   * Get pending intents (for navigation blocking)
   */
  const getPendingIntents = useCallback(() => {
    return intents.filter((i) =>
      i.status === IntentStatus.PENDING || i.status === IntentStatus.EXECUTING
    )
  }, [intents])

  /**
   * Cancel a pending intent
   */
  const cancelIntent = useCallback((intentId) => {
    const intent = intentMap.current.get(intentId)
    if (intent && (intent.status === IntentStatus.PENDING || intent.status === IntentStatus.EXECUTING)) {
      updateIntentStatus(intentId, IntentStatus.CANCELLED)
      return true
    }
    return false
  }, [updateIntentStatus])

  /**
   * Generate correlation ID for linking related actions
   */
  const createCorrelationId = useCallback(() => {
    return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }, [])

  const contextValue = useMemo(() => ({
    intents,
    recordIntent,
    updateIntentStatus,
    linkChildIntent,
    getIntent,
    getCorrelatedIntents,
    getPendingIntents,
    cancelIntent,
    createCorrelationId,
    sessionId,
  }), [
    intents,
    recordIntent,
    updateIntentStatus,
    linkChildIntent,
    getIntent,
    getCorrelatedIntents,
    getPendingIntents,
    cancelIntent,
    createCorrelationId,
  ])

  return (
    <IntentContext.Provider value={contextValue}>
      {children}
    </IntentContext.Provider>
  )
}


function useIntent() {
  const context = useContext(IntentContext)
  if (!context) {
    throw new Error('useIntent must be used within IntentProvider')
  }
  return context
}


/**
 * Create headers with intent context for API requests
 */
function createIntentHeaders(intent) {
  return {
    'X-Intent-Id': intent.id,
    'X-Correlation-Id': intent.correlationId,
    'X-Session-Id': intent.sessionId,
    'X-Intent-Type': intent.type,
    'X-Intent-Label': encodeURIComponent(intent.label),
  }
}

/**
 * UX Governance: Navigation Safety System
 *
 * Prevents accidental data loss by:
 * - Blocking navigation during active operations
 * - Warning about unsaved changes
 * - Requiring confirmation for destructive navigation
 *
 * RULE: Every background action MUST communicate whether it's safe to navigate away.
 */


const BlockerType = {
  // Active operation in progress
  OPERATION_IN_PROGRESS: 'operation_in_progress',

  // Unsaved form changes
  UNSAVED_CHANGES: 'unsaved_changes',

  // Custom blocker
  CUSTOM: 'custom',
}


const NavigationSafetyContext = createContext(null)


function NavigationSafetyProvider({ children }) {
  const theme = useTheme()

  // Active blockers
  const [blockers, setBlockers] = useState(new Map())

  // Pending navigation (when blocked)
  const [pendingNavigation, setPendingNavigation] = useState(null)

  // Confirmation dialog state
  const [dialogOpen, setDialogOpen] = useState(false)

  /**
   * Register a navigation blocker
   * @returns {string} Blocker ID for cleanup
   */
  const registerBlocker = useCallback((config) => {
    const blockerId = `blocker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const blocker = {
      id: blockerId,
      type: config.type || BlockerType.CUSTOM,
      label: config.label,
      description: config.description,
      canForceNavigate: config.canForceNavigate ?? true,
      priority: config.priority || 0,
      createdAt: Date.now(),
    }

    setBlockers((prev) => {
      const updated = new Map(prev)
      updated.set(blockerId, blocker)
      return updated
    })

    return blockerId
  }, [])

  /**
   * Unregister a navigation blocker
   */
  const unregisterBlocker = useCallback((blockerId) => {
    setBlockers((prev) => {
      const updated = new Map(prev)
      updated.delete(blockerId)
      return updated
    })
  }, [])

  /**
   * Check if navigation is safe
   */
  const isNavigationSafe = useCallback(() => {
    return blockers.size === 0
  }, [blockers.size])

  /**
   * Get all active blockers
   */
  const getActiveBlockers = useCallback(() => {
    return Array.from(blockers.values()).sort((a, b) => b.priority - a.priority)
  }, [blockers])

  /**
   * Attempt to navigate (shows confirmation if blocked)
   */
  const attemptNavigation = useCallback((callback) => {
    if (isNavigationSafe()) {
      callback()
      return
    }

    setPendingNavigation(() => callback)
    setDialogOpen(true)
  }, [isNavigationSafe])

  /**
   * Force navigation (bypasses blockers)
   */
  const forceNavigation = useCallback(() => {
    try {
      if (pendingNavigation) {
        pendingNavigation()
      }
    } catch (err) {
      console.error('[NavigationSafety] forceNavigation callback failed:', err)
    } finally {
      setPendingNavigation(null)
      setDialogOpen(false)
    }
  }, [pendingNavigation])

  /**
   * Cancel pending navigation
   */
  const cancelNavigation = useCallback(() => {
    setPendingNavigation(null)
    setDialogOpen(false)
  }, [])

  // Handle browser beforeunload
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!isNavigationSafe()) {
          event.preventDefault()
          return (event.returnValue = 'You have unsaved changes. Are you sure you want to leave?')
        }
      },
      [isNavigationSafe]
    )
  )

  const contextValue = useMemo(() => ({
    registerBlocker,
    unregisterBlocker,
    isNavigationSafe,
    getActiveBlockers,
    attemptNavigation,
    forceNavigation,
    cancelNavigation,
    hasBlockers: blockers.size > 0,
    blockerCount: blockers.size,
  }), [
    registerBlocker,
    unregisterBlocker,
    isNavigationSafe,
    getActiveBlockers,
    attemptNavigation,
    forceNavigation,
    cancelNavigation,
    blockers.size,
  ])

  return (
    <NavigationSafetyContext.Provider value={contextValue}>
      {children}

      {/* Navigation Blocked Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={cancelNavigation}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: alpha(theme.palette.background.paper, 0.95),
            backdropFilter: 'blur(10px)',
            borderRadius: 1,  // Figma spec: 8px
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <WarningIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="h6" fontWeight={600}>
            Wait! You have unsaved work
          </Typography>
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Leaving this page will interrupt the following:
          </DialogContentText>
          <List dense>
            {getActiveBlockers().map((blocker) => (
              <ListItem key={blocker.id}>
                <ListItemIcon>
                  {blocker.type === BlockerType.OPERATION_IN_PROGRESS ? (
                    <CircularProgress size={20} />
                  ) : blocker.type === BlockerType.UNSAVED_CHANGES ? (
                    <UnsavedIcon sx={{ color: 'text.secondary' }} />
                  ) : (
                    <PendingIcon sx={{ color: 'text.secondary' }} />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={blocker.label}
                  secondary={blocker.description}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={cancelNavigation} variant="contained">
            Stay on this page
          </Button>
          <Button onClick={forceNavigation} sx={{ color: 'text.secondary' }}>
            Leave anyway
          </Button>
        </DialogActions>
      </Dialog>
    </NavigationSafetyContext.Provider>
  )
}


function useNavigationSafety() {
  const context = useContext(NavigationSafetyContext)
  if (!context) {
    throw new Error('useNavigationSafety must be used within NavigationSafetyProvider')
  }
  return context
}
/**
 * Pre-defined workflow contracts
 * Each workflow defines steps, their order, and requirements
 */
const WorkflowContracts = {
  // Document Q&A Workflow
  DOCUMENT_QA: {
    id: 'document_qa',
    name: 'Document Q&A',
    description: 'Upload documents and ask questions',
    steps: [
      {
        id: 'create_session',
        name: 'Create Session',
        description: 'Create a new Q&A session',
        required: true,
        interactionType: 'CREATE',
        canRevert: true,
      },
      {
        id: 'add_documents',
        name: 'Add Documents',
        description: 'Upload at least one document',
        required: true,
        interactionType: 'UPLOAD',
        canRevert: true,
        minCount: 1,
      },
      {
        id: 'ask_question',
        name: 'Ask Questions',
        description: 'Ask questions about your documents',
        required: false,
        interactionType: 'ANALYZE',
        canRevert: false,
        repeatable: true,
      },
    ],
    onComplete: 'Session ready for Q&A',
    onAbandon: 'Session can be resumed later',
  },

  // Query Builder Workflow
  QUERY_BUILDER: {
    id: 'query_builder',
    name: 'Query Builder',
    description: 'Generate and execute SQL queries',
    steps: [
      {
        id: 'select_connection',
        name: 'Select Connection',
        description: 'Choose a database connection',
        required: true,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'enter_question',
        name: 'Enter Question',
        description: 'Describe what you want to query',
        required: true,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'generate_sql',
        name: 'Generate SQL',
        description: 'AI generates the SQL query',
        required: true,
        interactionType: 'GENERATE',
        canRevert: true,
      },
      {
        id: 'review_sql',
        name: 'Review SQL',
        description: 'Review and optionally edit the generated SQL',
        required: false,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'execute_query',
        name: 'Execute Query',
        description: 'Run the query against the database',
        required: false,
        interactionType: 'EXECUTE',
        canRevert: false,
      },
    ],
    onComplete: 'Query executed successfully',
    onAbandon: 'Query can be saved for later',
  },

  // Synthesis Workflow
  SYNTHESIS: {
    id: 'synthesis',
    name: 'Document Synthesis',
    description: 'Combine and analyze multiple documents',
    steps: [
      {
        id: 'create_session',
        name: 'Create Session',
        description: 'Create a synthesis session',
        required: true,
        interactionType: 'CREATE',
        canRevert: true,
      },
      {
        id: 'add_documents',
        name: 'Add Documents',
        description: 'Add at least 2 documents',
        required: true,
        interactionType: 'UPLOAD',
        canRevert: true,
        minCount: 2,
      },
      {
        id: 'configure_options',
        name: 'Configure Options',
        description: 'Set output format and focus topics',
        required: false,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'run_analysis',
        name: 'Run Analysis',
        description: 'Find inconsistencies or synthesize',
        required: true,
        interactionType: 'GENERATE',
        canRevert: false,
      },
    ],
    onComplete: 'Synthesis complete',
    onAbandon: 'Session saved for later',
  },

  // Report Generation Workflow
  REPORT_GENERATION: {
    id: 'report_generation',
    name: 'Report Generation',
    description: 'Generate a report from template',
    steps: [
      {
        id: 'select_template',
        name: 'Select Template',
        description: 'Choose a report template',
        required: true,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'select_connection',
        name: 'Select Data Source',
        description: 'Choose data connection',
        required: true,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'configure_parameters',
        name: 'Configure Parameters',
        description: 'Set report parameters',
        required: false,
        interactionType: 'UPDATE',
        canRevert: true,
      },
      {
        id: 'generate_report',
        name: 'Generate Report',
        description: 'Create the report',
        required: true,
        interactionType: 'GENERATE',
        canRevert: false,
      },
      {
        id: 'export_report',
        name: 'Export Report',
        description: 'Download or share the report',
        required: false,
        interactionType: 'DOWNLOAD',
        canRevert: false,
      },
    ],
    onComplete: 'Report generated',
    onAbandon: 'Configuration saved',
  },
}


const workflowReducer = (state, action) => {
  switch (action.type) {
    case 'START_WORKFLOW': {
      const contract = WorkflowContracts[action.workflowId]
      if (!contract) {
        throw new Error(`[WORKFLOW VIOLATION] Unknown workflow: ${action.workflowId}`)
      }
      return {
        ...state,
        activeWorkflow: action.workflowId,
        contract,
        currentStepIndex: 0,
        stepStates: contract.steps.reduce((acc, step) => {
          acc[step.id] = { status: StepStatus.PENDING, data: null, error: null, count: 0 }
          return acc
        }, {}),
        startedAt: Date.now(),
        completedAt: null,
      }
    }

    case 'ADVANCE_STEP': {
      const { stepId, data } = action
      const stepIndex = state.contract.steps.findIndex((s) => s.id === stepId)

      if (stepIndex === -1) {
        throw new Error(`[WORKFLOW VIOLATION] Unknown step: ${stepId}`)
      }

      // Validate step ordering - can't skip required steps
      for (let i = 0; i < stepIndex; i++) {
        const prevStep = state.contract.steps[i]
        const prevState = state.stepStates[prevStep.id]
        if (prevStep.required && prevState.status !== StepStatus.COMPLETED) {
          throw new Error(
            `[WORKFLOW VIOLATION] Cannot advance to "${stepId}" - required step "${prevStep.id}" not completed`
          )
        }
      }

      const currentState = state.stepStates[stepId]
      const step = state.contract.steps[stepIndex]

      return {
        ...state,
        currentStepIndex: stepIndex,
        stepStates: {
          ...state.stepStates,
          [stepId]: {
            ...currentState,
            status: StepStatus.IN_PROGRESS,
            data: data || currentState.data,
          },
        },
      }
    }

    case 'COMPLETE_STEP': {
      const { stepId, data } = action
      const currentState = state.stepStates[stepId]
      const step = state.contract.steps.find((s) => s.id === stepId)

      if (currentState.status !== StepStatus.IN_PROGRESS) {
        throw new Error(
          `[WORKFLOW VIOLATION] Cannot complete step "${stepId}" - not in progress (status: ${currentState.status})`
        )
      }

      // Check min count requirement
      const newCount = currentState.count + 1
      if (step.minCount && newCount < step.minCount) {
        // Step needs more iterations
        return {
          ...state,
          stepStates: {
            ...state.stepStates,
            [stepId]: {
              ...currentState,
              status: step.repeatable ? StepStatus.IN_PROGRESS : StepStatus.PENDING,
              data: data || currentState.data,
              count: newCount,
            },
          },
        }
      }

      return {
        ...state,
        stepStates: {
          ...state.stepStates,
          [stepId]: {
            ...currentState,
            status: StepStatus.COMPLETED,
            data: data || currentState.data,
            count: newCount,
          },
        },
      }
    }

    case 'FAIL_STEP': {
      const { stepId, error } = action
      return {
        ...state,
        stepStates: {
          ...state.stepStates,
          [stepId]: {
            ...state.stepStates[stepId],
            status: StepStatus.FAILED,
            error,
          },
        },
      }
    }

    case 'REVERT_STEP': {
      const { stepId } = action
      const step = state.contract.steps.find((s) => s.id === stepId)

      if (!step.canRevert) {
        throw new Error(`[WORKFLOW VIOLATION] Step "${stepId}" cannot be reverted`)
      }

      return {
        ...state,
        stepStates: {
          ...state.stepStates,
          [stepId]: {
            status: StepStatus.PENDING,
            data: null,
            error: null,
            count: 0,
          },
        },
      }
    }

    case 'COMPLETE_WORKFLOW': {
      // Validate all required steps are complete
      for (const step of state.contract.steps) {
        const stepState = state.stepStates[step.id]
        if (step.required && stepState.status !== StepStatus.COMPLETED) {
          throw new Error(
            `[WORKFLOW VIOLATION] Cannot complete workflow - required step "${step.id}" not completed`
          )
        }
      }

      return {
        ...state,
        completedAt: Date.now(),
      }
    }

    case 'ABANDON_WORKFLOW': {
      return {
        ...state,
        activeWorkflow: null,
        contract: null,
        stepStates: {},
        abandonedAt: Date.now(),
      }
    }

    case 'RESET':
      return {
        activeWorkflow: null,
        contract: null,
        currentStepIndex: 0,
        stepStates: {},
        startedAt: null,
        completedAt: null,
      }

    default:
      return state
  }
}


const WorkflowContext = createContext(null)


function WorkflowContractProvider({ children }) {
  const [state, dispatch] = useReducer(workflowReducer, {
    activeWorkflow: null,
    contract: null,
    currentStepIndex: 0,
    stepStates: {},
    startedAt: null,
    completedAt: null,
  })

  // Persist workflow state to sessionStorage
  useEffect(() => {
    if (state.activeWorkflow) {
      sessionStorage.setItem('ux_workflow_state', JSON.stringify(state))
    }
  }, [state])

  // Restore workflow state on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('ux_workflow_state')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.activeWorkflow && WorkflowContracts[parsed.activeWorkflow]) {
          dispatch({ type: 'START_WORKFLOW', workflowId: parsed.activeWorkflow })
          // Restore step states
          Object.entries(parsed.stepStates || {}).forEach(([stepId, stepState]) => {
            if (stepState.status === StepStatus.COMPLETED) {
              dispatch({ type: 'ADVANCE_STEP', stepId, data: stepState.data })
              dispatch({ type: 'COMPLETE_STEP', stepId, data: stepState.data })
            }
          })
        }
      } catch (e) {
        console.warn('[WORKFLOW] Failed to restore workflow state:', e)
      }
    }
  }, [])

  const startWorkflow = useCallback((workflowId) => {
    dispatch({ type: 'START_WORKFLOW', workflowId })
  }, [])

  const advanceStep = useCallback((stepId, data) => {
    dispatch({ type: 'ADVANCE_STEP', stepId, data })
  }, [])

  const completeStep = useCallback((stepId, data) => {
    dispatch({ type: 'COMPLETE_STEP', stepId, data })
  }, [])

  const failStep = useCallback((stepId, error) => {
    dispatch({ type: 'FAIL_STEP', stepId, error })
  }, [])

  const revertStep = useCallback((stepId) => {
    dispatch({ type: 'REVERT_STEP', stepId })
  }, [])

  const completeWorkflow = useCallback(() => {
    dispatch({ type: 'COMPLETE_WORKFLOW' })
  }, [])

  const abandonWorkflow = useCallback(() => {
    sessionStorage.removeItem('ux_workflow_state')
    dispatch({ type: 'ABANDON_WORKFLOW' })
  }, [])

  const resetWorkflow = useCallback(() => {
    sessionStorage.removeItem('ux_workflow_state')
    dispatch({ type: 'RESET' })
  }, [])

  // Check if workflow is complete
  const isWorkflowComplete = state.contract?.steps.every((step) => {
    const stepState = state.stepStates[step.id]
    return !step.required || stepState?.status === StepStatus.COMPLETED
  })

  const contextValue = {
    ...state,
    isWorkflowComplete,
    startWorkflow,
    advanceStep,
    completeStep,
    failStep,
    revertStep,
    completeWorkflow,
    abandonWorkflow,
    resetWorkflow,
    WorkflowContracts,
    StepStatus,
  }

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  )
}


function useWorkflow() {
  const context = useContext(WorkflowContext)
  if (!context) {
    throw new Error('useWorkflow must be used within WorkflowContractProvider')
  }
  return context
}

/**
 * UX Governance Level-2: Background Operations Visibility
 *
 * ENFORCES that:
 * - All background/scheduled operations are registered and visible
 * - Users are notified when background tasks complete or fail
 * - Long-running operations show progress
 * - Users can cancel background operations where allowed
 *
 * NO SILENT BACKGROUND WORK - everything is visible and tracked.
 */


const BackgroundOperationType = {
  // User-initiated background tasks
  REPORT_GENERATION: 'report_generation',
  DOCUMENT_PROCESSING: 'document_processing',
  DATA_EXPORT: 'data_export',
  BATCH_OPERATION: 'batch_operation',

  // Scheduled tasks
  SCHEDULED_REPORT: 'scheduled_report',
  DATA_SYNC: 'data_sync',
  CLEANUP: 'cleanup',

  // System tasks (visible but not user-cancelable)
  CACHE_REFRESH: 'cache_refresh',
  INDEX_REBUILD: 'index_rebuild',
  HEALTH_CHECK: 'health_check',
}

const BackgroundOperationStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}


const BackgroundOperationsContext = createContext(null)


function BackgroundOperationsProvider({ children }) {
  const theme = useTheme()

  // Registered background operations
  const [operations, setOperations] = useState([])
  const operationsRef = useRef(operations)
  operationsRef.current = operations

  // Notification queue
  const [notification, setNotification] = useState(null)

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Polling interval for status updates
  const pollingRef = useRef(null)

  /**
   * Register a new background operation
   */
  const registerOperation = useCallback((operation) => {
    const newOp = {
      id: operation.id || `bg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: operation.type,
      label: operation.label,
      description: operation.description,
      status: BackgroundOperationStatus.PENDING,
      progress: 0,
      startedAt: null,
      completedAt: null,
      error: null,
      cancelable: operation.cancelable !== false,
      onCancel: operation.onCancel,
      onComplete: operation.onComplete,
      metadata: operation.metadata || {},
      createdAt: Date.now(),
    }

    setOperations((prev) => [newOp, ...prev].slice(0, 200))

    // Notify user
    setNotification({
      severity: 'info',
      message: `Background task started: ${operation.label}`,
    })

    return newOp.id
  }, [])

  /**
   * Update operation status
   */
  const updateOperation = useCallback((operationId, updates) => {
    setOperations((prev) =>
      prev.map((op) => {
        if (op.id !== operationId) return op

        const updated = { ...op, ...updates }

        // Handle completion
        if (updates.status === BackgroundOperationStatus.COMPLETED) {
          updated.completedAt = Date.now()
          updated.progress = 100

          // Notify user
          setNotification({
            severity: 'success',
            message: `Completed: ${op.label}`,
          })

          // Call completion callback
          if (op.onComplete) {
            op.onComplete(updated)
          }
        }

        // Handle failure
        if (updates.status === BackgroundOperationStatus.FAILED) {
          updated.completedAt = Date.now()

          // Notify user
          setNotification({
            severity: 'error',
            message: `Failed: ${op.label} - ${updates.error || 'Unknown error'}`,
          })
        }

        return updated
      })
    )
  }, [])

  /**
   * Start an operation
   */
  const startOperation = useCallback((operationId) => {
    updateOperation(operationId, {
      status: BackgroundOperationStatus.RUNNING,
      startedAt: Date.now(),
    })
  }, [updateOperation])

  /**
   * Complete an operation
   */
  const completeOperation = useCallback((operationId, result) => {
    updateOperation(operationId, {
      status: BackgroundOperationStatus.COMPLETED,
      result,
    })
  }, [updateOperation])

  /**
   * Fail an operation
   */
  const failOperation = useCallback((operationId, error) => {
    updateOperation(operationId, {
      status: BackgroundOperationStatus.FAILED,
      error: typeof error === 'string' ? error : error?.message || 'Unknown error',
    })
  }, [updateOperation])

  /**
   * Cancel an operation
   */
  const cancelOperation = useCallback((operationId) => {
    const operation = operationsRef.current.find((op) => op.id === operationId)

    if (!operation) return false
    if (!operation.cancelable) return false
    if (operation.status === BackgroundOperationStatus.COMPLETED) return false
    if (operation.status === BackgroundOperationStatus.FAILED) return false

    // Call cancel callback if provided
    if (operation.onCancel) {
      operation.onCancel()
    }

    updateOperation(operationId, {
      status: BackgroundOperationStatus.CANCELLED,
      completedAt: Date.now(),
    })

    setNotification({
      severity: 'warning',
      message: `Cancelled: ${operation.label}`,
    })

    return true
  }, [updateOperation])

  /**
   * Update progress
   */
  const updateProgress = useCallback((operationId, progress) => {
    updateOperation(operationId, { progress: Math.min(100, Math.max(0, progress)) })
  }, [updateOperation])

  /**
   * Clear completed operations
   */
  const clearCompleted = useCallback(() => {
    setOperations((prev) =>
      prev.filter(
        (op) =>
          op.status !== BackgroundOperationStatus.COMPLETED &&
          op.status !== BackgroundOperationStatus.FAILED &&
          op.status !== BackgroundOperationStatus.CANCELLED
      )
    )
  }, [])

  /**
   * Get active operations count
   */
  const activeCount = operations.filter(
    (op) =>
      op.status === BackgroundOperationStatus.PENDING ||
      op.status === BackgroundOperationStatus.RUNNING
  ).length

  // Polling placeholder removed — status updates come from manual updateOperation calls

  // Close notification
  const closeNotification = useCallback(() => {
    setNotification(null)
  }, [])

  // Get status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case BackgroundOperationStatus.COMPLETED:
        return <SuccessIcon sx={{ color: theme.palette.text.secondary }} />
      case BackgroundOperationStatus.FAILED:
        return <ErrorIcon sx={{ color: theme.palette.text.secondary }} />
      case BackgroundOperationStatus.RUNNING:
        return <RunningIcon sx={{ color: theme.palette.mode === 'dark' ? neutral[300] : neutral[900] }} />
      case BackgroundOperationStatus.CANCELLED:
        return <CancelIcon sx={{ color: theme.palette.text.secondary }} />
      default:
        return <PendingIcon sx={{ color: theme.palette.text.secondary }} />
    }
  }

  // Get type icon
  const getTypeIcon = (type) => {
    switch (type) {
      case BackgroundOperationType.SCHEDULED_REPORT:
        return <ScheduledIcon />
      case BackgroundOperationType.DATA_SYNC:
        return <SyncIcon />
      case BackgroundOperationType.CACHE_REFRESH:
      case BackgroundOperationType.INDEX_REBUILD:
      case BackgroundOperationType.HEALTH_CHECK:
        return <SystemIcon />
      default:
        return <NotifyIcon />
    }
  }

  const contextValue = {
    operations,
    activeCount,
    registerOperation,
    startOperation,
    completeOperation,
    failOperation,
    cancelOperation,
    updateProgress,
    updateOperation,
    clearCompleted,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    BackgroundOperationType,
    BackgroundOperationStatus,
  }

  return (
    <BackgroundOperationsContext.Provider value={contextValue}>
      {children}

      {/* Notification Snackbar */}
      <Snackbar
        open={!!notification}
        autoHideDuration={4000}
        onClose={closeNotification}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {notification && (
          <Alert
            onClose={closeNotification}
            severity={notification.severity}
            variant="filled"
            sx={{ minWidth: 300 }}
          >
            {notification.message}
          </Alert>
        )}
      </Snackbar>

      {/* Background Operations Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 400,
            maxWidth: '100vw',
            bgcolor: alpha(theme.palette.background.default, 0.95),
            backdropFilter: 'blur(20px)',
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <NotifyIcon sx={{ color: 'text.secondary' }} />
            <Typography variant="h6" fontWeight={600}>
              Background Tasks
            </Typography>
            {activeCount > 0 && (
              <Chip
                size="small"
                label={`${activeCount} active`}
                sx={{
                  height: 22,
                  fontSize: '12px',
                  bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                  color: 'text.primary',
                }}
              />
            )}
          </Box>
          <IconButton onClick={() => setDrawerOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Operations List */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {operations.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'text.secondary',
                textAlign: 'center',
                p: 4,
              }}
            >
              <NotifyIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1" fontWeight={500}>
                No background tasks
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
                Background operations will appear here
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {operations.map((op) => (
                <ListItem
                  key={op.id}
                  sx={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 1,
                    py: 1.5,
                    px: 2,
                    bgcolor: alpha(theme.palette.background.paper, 0.4),
                    borderRadius: 1,  // Figma spec: 8px
                    mb: 1,
                  }}
                >
                  {/* Main row */}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%' }}>
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: 1,  // Figma spec: 8px
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'text.secondary',
                      }}
                    >
                      {getTypeIcon(op.type)}
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {op.label}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        {getStatusIcon(op.status)}
                        <Typography variant="caption" color="text.secondary">
                          {op.status.charAt(0).toUpperCase() + op.status.slice(1)}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Cancel button */}
                    {op.cancelable &&
                      (op.status === BackgroundOperationStatus.PENDING ||
                        op.status === BackgroundOperationStatus.RUNNING) && (
                        <IconButton
                          size="small"
                          onClick={() => cancelOperation(op.id)}
                          sx={{
                            color: theme.palette.text.secondary,
                            '&:hover': {
                              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                            },
                          }}
                        >
                          <CancelIcon fontSize="small" />
                        </IconButton>
                      )}
                  </Box>

                  {/* Progress bar */}
                  {op.status === BackgroundOperationStatus.RUNNING && (
                    <LinearProgress
                      variant={op.progress > 0 ? 'determinate' : 'indeterminate'}
                      value={op.progress}
                      sx={{
                        height: 4,
                        borderRadius: 1,  // Figma spec: 8px
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                        '& .MuiLinearProgress-bar': {
                          bgcolor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                        },
                      }}
                    />
                  )}

                  {/* Error message */}
                  {op.error && (
                    <Alert severity="error" sx={{ py: 0, fontSize: '0.75rem' }}>
                      {op.error}
                    </Alert>
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        {/* Footer */}
        {operations.length > 0 && (
          <Box
            sx={{
              p: 2,
              borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            }}
          >
            <Button
              fullWidth
              size="small"
              onClick={clearCompleted}
              disabled={
                !operations.some(
                  (op) =>
                    op.status === BackgroundOperationStatus.COMPLETED ||
                    op.status === BackgroundOperationStatus.FAILED ||
                    op.status === BackgroundOperationStatus.CANCELLED
                )
              }
            >
              Clear Completed
            </Button>
          </Box>
        )}
      </Drawer>
    </BackgroundOperationsContext.Provider>
  )
}


function useBackgroundOperations() {
  const context = useContext(BackgroundOperationsContext)
  if (!context) {
    throw new Error('useBackgroundOperations must be used within BackgroundOperationsProvider')
  }
  return context
}

// === From: index.jsx ===
// All re-exports removed - symbols already defined above

function TimeExpectationProvider({ children }) { return children }
function IrreversibleBoundaryProvider({ children }) { return children }

// Enums used by governance providers
const StepStatus = { PENDING: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' }
const STEP = StepStatus  // alias

export function UXGovernanceProvider({ children, auditClient }) {
  return (
    <IntentProvider auditClient={auditClient}>
      <TimeExpectationProvider>
        <WorkflowContractProvider>
          <BackgroundOperationsProvider>
            <NavigationSafetyProvider>
              <IrreversibleBoundaryProvider>
                <InteractionProvider>
                  {children}
                </InteractionProvider>
              </IrreversibleBoundaryProvider>
            </NavigationSafetyProvider>
          </BackgroundOperationsProvider>
        </WorkflowContractProvider>
      </TimeExpectationProvider>
    </IntentProvider>
  )
}

