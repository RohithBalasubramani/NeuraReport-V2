import { neutral, palette } from '@/app/theme'
import { ActionButton, FullHeightPageContainer as PageContainer } from '@/styles/styles'
import { ConnectionSelector, TemplateSelector, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useSharedData } from '@/hooks/hooks'
import { useWorkflowStore } from '@/stores/workspace'
import {
  AccountTree as WorkflowIcon,
  Add as AddIcon,
  BugReport as DebugIcon,
  CallSplit as ConditionIcon,
  CheckCircle as ApprovalIcon,
  Code as CodeIcon,
  Delete as DeleteIcon,
  Email as EmailIcon,
  History as HistoryIcon,
  Loop as LoopIcon,
  Notifications as NotifyIcon,
  PlayArrow as RunIcon,
  Refresh as RetryIcon,
  Save as SaveIcon,
  Schedule as ScheduleIcon,
  Stop as StopIcon,
  Storage as DataIcon,
  Webhook as WebhookIcon,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import React, { useCallback, useEffect, useState } from 'react'

const Toolbar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const WorkflowArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
}))

const NodePalette = styled(Box)(({ theme }) => ({
  width: 260,
  flexShrink: 0,
  borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  padding: theme.spacing(2),
  overflow: 'auto',
}))

const Canvas = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  overflow: 'auto',
  backgroundColor: theme.palette.background.default,
  backgroundImage: `radial-gradient(${alpha(theme.palette.divider, 0.15)} 1px, transparent 1px)`,
  backgroundSize: '20px 20px',
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 300,
  flexShrink: 0,
  borderLeft: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  display: 'flex',
  flexDirection: 'column',
}))

const NodeCard = styled(Card)(({ theme }) => ({
  cursor: 'grab',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  marginBottom: theme.spacing(1),
  '&:hover': {
    transform: 'translateX(4px)',
    boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.1)}`,
  },
}))

const WorkflowNode = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  minWidth: 200,
  borderRadius: 8,  // Figma spec: 8px
  border: `2px solid ${alpha(theme.palette.divider, 0.3)}`,
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.1)}`,
  },
}))

const ExecutionCard = styled(Paper)(({ theme, status }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(1),
  borderLeft: `4px solid ${
    status === 'completed'
      ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
      : status === 'running'
      ? (theme.palette.mode === 'dark' ? neutral[300] : neutral[500])
      : status === 'failed'
      ? theme.palette.text.secondary
      : neutral[400]
  }`,
}))

const EmptyState = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(4),
  textAlign: 'center',
}))


const NODE_TYPES = [
  { type: 'trigger', label: 'Trigger', icon: ScheduleIcon, color: 'warning', category: 'Triggers' },
  { type: 'webhook', label: 'Webhook', icon: WebhookIcon, color: 'info', category: 'Triggers' },
  { type: 'action', label: 'Action', icon: CodeIcon, color: 'primary', category: 'Actions' },
  { type: 'email', label: 'Send Email', icon: EmailIcon, color: 'secondary', category: 'Actions' },
  { type: 'notify', label: 'Notification', icon: NotifyIcon, color: 'success', category: 'Actions' },
  { type: 'condition', label: 'Condition', icon: ConditionIcon, color: 'info', category: 'Logic' },
  { type: 'loop', label: 'Loop', icon: LoopIcon, color: 'warning', category: 'Logic' },
  { type: 'approval', label: 'Approval', icon: ApprovalIcon, color: 'success', category: 'Logic' },
  { type: 'data', label: 'Data Transform', icon: DataIcon, color: 'primary', category: 'Data' },
]


export default function WorkflowBuilderPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const {
    workflows,
    currentWorkflow,
    executions,
    currentExecution,
    pendingApprovals,
    loading,
    executing,
    error,
    fetchWorkflows,
    createWorkflow,
    getWorkflow,
    updateWorkflow,
    deleteWorkflow,
    executeWorkflow,
    fetchExecutions,
    cancelExecution,
    retryExecution,
    fetchPendingApprovals,
    approveStep,
    rejectStep,
    reset,
  } = useWorkflowStore()

  const { connections, templates, activeConnectionId } = useSharedData()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [workflowNodes, setWorkflowNodes] = useState([])
  const [selectedNode, setSelectedNode] = useState(null)
  const [showExecutions, setShowExecutions] = useState(false)

  useEffect(() => {
    fetchWorkflows()
    fetchPendingApprovals()
    return () => reset()
  }, [fetchWorkflows, fetchPendingApprovals, reset])

  useEffect(() => {
    if (currentWorkflow?.nodes) {
      setWorkflowNodes(currentWorkflow.nodes)
    }
  }, [currentWorkflow])

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'workflows', ...intent },
      action,
    })
  }, [execute])

  const handleOpenCreateDialog = useCallback(() => {
    return executeUI('Open create workflow', () => setCreateDialogOpen(true))
  }, [executeUI])

  const handleCloseCreateDialog = useCallback(() => {
    return executeUI('Close create workflow', () => setCreateDialogOpen(false))
  }, [executeUI])

  const handleCreateWorkflow = useCallback(() => {
    if (!newWorkflowName) return undefined
    return execute({
      type: InteractionType.CREATE,
      label: 'Create workflow',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', name: newWorkflowName },
      action: async () => {
        const workflow = await createWorkflow({
          name: newWorkflowName,
          connectionId: selectedConnectionId || undefined,
          templateId: selectedTemplateId || undefined,
          nodes: [],
          edges: [],
          triggers: [],
        })
        if (workflow) {
          setCreateDialogOpen(false)
          setNewWorkflowName('')
          setSelectedConnectionId(activeConnectionId || '')
          setSelectedTemplateId('')
          toast.show('Workflow created', 'success')
        }
        return workflow
      },
    })
  }, [activeConnectionId, createWorkflow, execute, newWorkflowName, selectedConnectionId, selectedTemplateId, toast])

  const handleAddNode = useCallback((nodeType) => {
    if (!currentWorkflow) return undefined
    return executeUI('Add workflow node', () => {
      const newNode = {
        id: `node_${Date.now()}`,
        type: nodeType.type,
        label: nodeType.label,
        config: {},
        position: { x: 100 + workflowNodes.length * 50, y: 100 + workflowNodes.length * 50 },
      }
      setWorkflowNodes([...workflowNodes, newNode])
      toast.show(`${nodeType.label} node added`, 'success')
    }, { workflowId: currentWorkflow.id, nodeType: nodeType.type })
  }, [currentWorkflow, executeUI, toast, workflowNodes])

  const handleDeleteNode = useCallback((nodeId) => {
    return execute({
      type: InteractionType.DELETE,
      label: 'Remove workflow node',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', nodeId },
      action: async () => {
        setWorkflowNodes(workflowNodes.filter((n) => n.id !== nodeId))
        if (selectedNode?.id === nodeId) {
          setSelectedNode(null)
        }
        toast.show('Node removed', 'success')
      },
    })
  }, [execute, selectedNode?.id, toast, workflowNodes])

  const handleSelectNode = useCallback((node) => {
    return executeUI('Select workflow node', () => setSelectedNode(node), { nodeId: node?.id })
  }, [executeUI])

  const handleSaveWorkflow = useCallback(() => {
    if (!currentWorkflow) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Save workflow',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', workflowId: currentWorkflow.id },
      action: async () => {
        await updateWorkflow(currentWorkflow.id, {
          nodes: workflowNodes,
        })
        toast.show('Workflow saved', 'success')
      },
    })
  }, [currentWorkflow, execute, toast, updateWorkflow, workflowNodes])

  const handleExecute = useCallback(() => {
    if (!currentWorkflow) return undefined
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Run workflow',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'workflows', workflowId: currentWorkflow.id },
      action: async () => {
        const execution = await executeWorkflow(currentWorkflow.id)
        if (execution) {
          toast.show('Workflow execution started', 'success')
          setShowExecutions(true)
          fetchExecutions(currentWorkflow.id)
        }
        return execution
      },
    })
  }, [currentWorkflow, execute, executeWorkflow, fetchExecutions, toast])

  const handleCancelExecution = useCallback((executionId) => {
    if (!currentWorkflow) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Cancel execution',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', workflowId: currentWorkflow.id, executionId },
      action: async () => {
        await cancelExecution(currentWorkflow.id, executionId)
        toast.show('Execution cancelled', 'info')
      },
    })
  }, [cancelExecution, currentWorkflow, execute, toast])

  const handleRetryExecution = useCallback((executionId) => {
    if (!currentWorkflow) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Retry execution',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', workflowId: currentWorkflow.id, executionId },
      action: async () => {
        await retryExecution(currentWorkflow.id, executionId)
        toast.show('Retry started', 'success')
      },
    })
  }, [currentWorkflow, execute, retryExecution, toast])

  const handleToggleExecutions = useCallback(() => {
    if (!currentWorkflow) return undefined
    return executeUI('Toggle executions', () => {
      const next = !showExecutions
      setShowExecutions(next)
      if (next) fetchExecutions(currentWorkflow.id)
    }, { workflowId: currentWorkflow.id, open: !showExecutions })
  }, [currentWorkflow, executeUI, fetchExecutions, showExecutions])

  const handleApproveStep = useCallback((executionId, stepId) => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Approve step',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', executionId, stepId },
      action: async () => {
        await approveStep(executionId, stepId)
      },
    })
  }, [approveStep, execute])

  const handleRejectStep = useCallback((executionId, stepId) => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Reject step',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'workflows', executionId, stepId },
      action: async () => {
        await rejectStep(executionId, stepId, 'Rejected')
      },
    })
  }, [execute, rejectStep])

  const handleSelectWorkflow = useCallback((workflowId) => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Open workflow',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'workflows', workflowId },
      action: async () => {
        await getWorkflow(workflowId)
      },
    })
  }, [execute, getWorkflow])

  const handleDismissError = useCallback(() => {
    return executeUI('Dismiss workflow error', () => reset())
  }, [executeUI, reset])

  const groupedNodeTypes = NODE_TYPES.reduce((acc, node) => {
    if (!acc[node.category]) acc[node.category] = []
    acc[node.category].push(node)
    return acc
  }, {})

  return (
    <PageContainer>
      {/* Toolbar */}
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <WorkflowIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {currentWorkflow?.name || 'Workflows'}
          </Typography>
          {currentWorkflow && (
            <Chip
              size="small"
              label={`${workflowNodes.length} ${workflowNodes.length === 1 ? 'node' : 'nodes'}`}
              sx={{ borderRadius: 1 }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          {currentWorkflow ? (
            <>
              <ActionButton
                size="small"
                startIcon={<HistoryIcon />}
                onClick={handleToggleExecutions}
              >
                Executions
              </ActionButton>
              <ActionButton
                size="small"
                variant="outlined"
                sx={{ color: 'text.secondary' }}
                startIcon={executing ? <StopIcon /> : <RunIcon />}
                onClick={handleExecute}
                disabled={executing || workflowNodes.length === 0}
              >
                {executing ? 'Running...' : 'Run'}
              </ActionButton>
              <ActionButton
                variant="contained"
                size="small"
                startIcon={<SaveIcon />}
                onClick={handleSaveWorkflow}
              >
                Save
              </ActionButton>
            </>
          ) : (
            <ActionButton
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateDialog}
            >
              New Workflow
            </ActionButton>
          )}
        </Box>
      </Toolbar>

      <WorkflowArea>
        {currentWorkflow ? (
          <>
            {/* Node Palette */}
            <NodePalette>
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                Add Node
              </Typography>
              {Object.entries(groupedNodeTypes).map(([category, nodes]) => (
                <Box key={category} sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    {category}
                  </Typography>
                  {nodes.map((node) => (
                    <NodeCard
                      key={node.type}
                      variant="outlined"
                      onClick={() => handleAddNode(node)}
                    >
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <node.icon color={node.color} fontSize="small" />
                          <Typography variant="body2">{node.label}</Typography>
                        </Box>
                      </CardContent>
                    </NodeCard>
                  ))}
                </Box>
              ))}

              {pendingApprovals.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Pending Approvals ({pendingApprovals.length})
                  </Typography>
                  {pendingApprovals.map((approval) => (
                    <Paper key={approval.id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 500 }}>
                        {approval.workflow_name}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleApproveStep(approval.execution_id, approval.step_id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          sx={{ color: 'text.secondary' }}
                          onClick={() => handleRejectStep(approval.execution_id, approval.step_id)}
                        >
                          Reject
                        </Button>
                      </Box>
                    </Paper>
                  ))}
                </>
              )}
            </NodePalette>

            {/* Canvas */}
            <Canvas>
              {workflowNodes.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                  {workflowNodes.map((node, index) => {
                    const nodeType = NODE_TYPES.find((t) => t.type === node.type)
                    const NodeIcon = nodeType?.icon || CodeIcon
                    return (
                      <React.Fragment key={node.id}>
                        <WorkflowNode
                          onClick={() => handleSelectNode(node)}
                          sx={{
                            borderColor: selectedNode?.id === node.id
                              ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
                              : undefined,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box
                              sx={{
                                width: 36,
                                height: 36,
                                borderRadius: 1,  // Figma spec: 8px
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: alpha(theme.palette[nodeType?.color || 'primary'].main, 0.1),
                              }}
                            >
                              <NodeIcon color={nodeType?.color || 'primary'} />
                            </Box>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                {node.label}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {node.type}
                              </Typography>
                            </Box>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteNode(node.id)
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </WorkflowNode>
                        {index < workflowNodes.length - 1 && (
                          <Box
                            sx={{
                              width: 2,
                              height: 40,
                              bgcolor: alpha(theme.palette.divider, 0.5),
                              borderRadius: 1,
                            }}
                          />
                        )}
                      </React.Fragment>
                    )
                  })}
                </Box>
              ) : (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography color="text.secondary">
                    Add nodes from the palette to build your workflow
                  </Typography>
                </Box>
              )}
            </Canvas>

            {/* Executions Sidebar */}
            {showExecutions && (
              <Sidebar>
                <Box sx={{ p: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Executions
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                  {executions.length > 0 ? (
                    executions.map((exec) => (
                      <ExecutionCard key={exec.id} status={exec.status} variant="outlined">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {exec.status}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(exec.started_at).toLocaleString()}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {exec.status === 'running' && (
                              <IconButton
                                size="small"
                                onClick={() => handleCancelExecution(exec.id)}
                              >
                                <StopIcon fontSize="small" />
                              </IconButton>
                            )}
                            {exec.status === 'failed' && (
                              <IconButton
                                size="small"
                                onClick={() => handleRetryExecution(exec.id)}
                              >
                                <RetryIcon fontSize="small" />
                              </IconButton>
                            )}
                          </Box>
                        </Box>
                      </ExecutionCard>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                      No executions yet
                    </Typography>
                  )}
                </Box>
              </Sidebar>
            )}
          </>
        ) : (
          <EmptyState sx={{ width: '100%' }}>
            <WorkflowIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
              No Workflow Selected
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Create a new workflow to automate your processes.
            </Typography>
            <ActionButton
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateDialog}
            >
              Create Workflow
            </ActionButton>

            {workflows.length > 0 && (
              <Box sx={{ mt: 4, width: '100%', maxWidth: 400 }}>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  Recent Workflows
                </Typography>
                {workflows.slice(0, 5).map((wf) => (
                  <Paper
                    key={wf.id}
                    sx={{
                      p: 2,
                      mb: 1,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      '&:hover': { bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50] },
                    }}
                    variant="outlined"
                    onClick={() => handleSelectWorkflow(wf.id)}
                  >
                    <WorkflowIcon sx={{ color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {wf.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {wf.nodes?.length || 0} {(wf.nodes?.length || 0) === 1 ? 'node' : 'nodes'}
                      </Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}
          </EmptyState>
        )}
      </WorkflowArea>

      {/* Create Workflow Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create New Workflow</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Workflow Name"
            value={newWorkflowName}
            onChange={(e) => setNewWorkflowName(e.target.value)}
            sx={{ mt: 2 }}
          />
          <ConnectionSelector
            value={selectedConnectionId}
            onChange={setSelectedConnectionId}
            label="Database Connection"
            size="small"
            sx={{ mt: 2 }}
          />
          <TemplateSelector
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            label="Report Template"
            size="small"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateWorkflow}
            disabled={!newWorkflowName || loading}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Alert
          severity="error"
          onClose={handleDismissError}
          sx={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 400 }}
        >
          {error}
        </Alert>
      )}
    </PageContainer>
  )
}
