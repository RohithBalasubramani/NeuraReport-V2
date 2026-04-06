import { listReportRuns } from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { ConnectionSelector, ContentSkeleton, ImportFromMenu, useToast } from '@/components/core'
import {
  InteractionType,
  Reversibility,
  useConfirmedAction,
  useInteraction,
} from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { AiUsageNotice, CharacterCounter, DisabledReasons, DisabledTooltip, OperationType, ValidatedTextField, ValidationRules, useOperationHistory } from '@/components/ux'
import { useCrossPageActions, useIncomingTransfer, useSharedData } from '@/hooks/hooks'
import { useDocQAStore } from '@/stores/content'
import { float, pulse, slideInLeft, slideInRight, typing } from '@/styles/styles'
import { FeatureKey, TransferAction } from '@/utils/helpers'
import {
  Add as AddIcon,
  Article as ArticleIcon,
  AttachFile as AttachIcon,
  AutoAwesome as AIIcon,
  Circle as CircleIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  CloudUpload as UploadIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Description as DocIcon,
  Folder as FolderIcon,
  FormatQuote as QuoteIcon,
  InsertDriveFile as FileIcon,
  KeyboardArrowDown as ArrowDownIcon,
  Mic as MicIcon,
  MoreVert as MoreIcon,
  Person as UserIcon,
  Psychology as ThinkIcon,
  QuestionAnswer as QAIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Send as SendIcon,
  Stop as StopIcon,
  ThumbDown as ThumbDownIcon,
  ThumbUp as ThumbUpIcon,
} from '@mui/icons-material'
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Fade,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
  Zoom,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import React, { useCallback, useEffect, useRef, useState } from 'react'
const PageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  height: 'calc(100vh - 64px)',
  backgroundColor: 'transparent',
  position: 'relative',
  overflow: 'hidden',
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 300,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  background: alpha(theme.palette.background.paper, 0.6),
  backdropFilter: 'blur(20px)',
  borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  position: 'relative',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    background: `linear-gradient(180deg, ${alpha(theme.palette.text.primary, 0.03)} 0%, transparent 100%)`,
    pointerEvents: 'none',
  },
}))

const SidebarHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  position: 'relative',
  zIndex: 1,
}))

const SessionList = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(0, 2, 2),
  '&::-webkit-scrollbar': {
    width: 6,
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    borderRadius: 1,  // Figma spec: 8px
    '&:hover': {
      backgroundColor: alpha(theme.palette.text.primary, 0.2),
    },
  },
}))

const SessionCard = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'selected',
})(({ theme, selected }) => ({
  padding: theme.spacing(1.5),
  borderRadius: 8,  // Figma spec: 8px
  cursor: 'pointer',
  marginBottom: theme.spacing(1),
  backgroundColor: selected
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100])
    : alpha(theme.palette.background.paper, 0.4),
  border: `1px solid ${selected ? alpha(theme.palette.divider, 0.3) : 'transparent'}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  position: 'relative',
  overflow: 'hidden',
  '&:hover': {
    backgroundColor: selected
      ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200])
      : (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50]),
    transform: 'translateX(4px)',
  },
  '&::before': selected
    ? {
        content: '""',
        position: 'absolute',
        left: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 3,
        height: '60%',
        background: theme.palette.mode === 'dark' ? neutral[500] : neutral[900],
        borderRadius: '0 4px 4px 0',
      }
    : {},
}))

const DocumentChip = styled(Chip)(({ theme }) => ({
  height: 24,
  fontSize: 12,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  color: theme.palette.text.secondary,
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '& .MuiChip-icon': {
    fontSize: 14,
  },
}))

const ChatArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'transparent',
  position: 'relative',
}))

const ChatHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: alpha(theme.palette.background.paper, 0.4),
  backdropFilter: 'blur(10px)',
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const MessagesContainer = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(3),
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
  '&::-webkit-scrollbar': {
    width: 8,
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    borderRadius: 4,
    '&:hover': {
      backgroundColor: alpha(theme.palette.text.primary, 0.2),
    },
  },
}))

const MessageBubble = styled(Box, {
  shouldForwardProp: (prop) => !['isUser', 'index'].includes(prop),
})(({ theme, isUser, index }) => ({
  maxWidth: '75%',
  alignSelf: isUser ? 'flex-end' : 'flex-start',
  animation: `${isUser ? slideInRight : slideInLeft} 0.4s ease-out`,
  animationDelay: `${index * 0.05}s`,
  animationFillMode: 'both',
}))

const BubbleContent = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isUser',
})(({ theme, isUser }) => ({
  padding: theme.spacing(2, 2.5),
  borderRadius: isUser ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
  backgroundColor: isUser
    ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
    : alpha(theme.palette.background.paper, 0.8),
  color: isUser ? theme.palette.common.white : theme.palette.text.primary,
  backdropFilter: isUser ? 'none' : 'blur(10px)',
  border: isUser ? 'none' : `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  position: 'relative',
  boxShadow: isUser
    ? `0 4px 20px ${alpha(theme.palette.common.black, 0.2)}`
    : `0 4px 20px ${alpha(theme.palette.common.black, 0.05)}`,
}))

const AvatarStyled = styled(Avatar, {
  shouldForwardProp: (prop) => prop !== 'isUser',
})(({ theme, isUser }) => ({
  width: 36,
  height: 36,
  background: isUser
    ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
    : (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]),
  border: `2px solid ${alpha(theme.palette.background.paper, 0.8)}`,
  boxShadow: `0 2px 10px ${alpha(theme.palette.common.black, 0.1)}`,
  '& svg': {
    fontSize: 18,
    color: isUser ? theme.palette.common.white : theme.palette.text.secondary,
  },
}))

const CitationBox = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(2),
  padding: theme.spacing(1.5),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  borderRadius: 8,  // Figma spec: 8px
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const CitationItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1),
  padding: theme.spacing(1),
  borderRadius: 8,
  backgroundColor: alpha(theme.palette.background.paper, 0.5),
  marginTop: theme.spacing(1),
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  },
}))

const FollowUpChip = styled(Chip)(({ theme }) => ({
  borderRadius: 20,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  color: theme.palette.text.primary,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200],
    transform: 'translateY(-2px)',
    boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.1)}`,
  },
}))

const InputArea = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3, 3),
  background: `linear-gradient(180deg, transparent 0%, ${alpha(theme.palette.background.paper, 0.6)} 30%)`,
  backdropFilter: 'blur(10px)',
}))

const InputContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-end',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5),
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
  borderRadius: 24,
  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
  boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.05)}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:focus-within': {
    borderColor: alpha(theme.palette.divider, 0.4),
    boxShadow: `0 4px 30px ${alpha(theme.palette.common.black, 0.08)}`,
  },
}))

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    backgroundColor: 'transparent',
    fontSize: 16,
    '& fieldset': {
      border: 'none',
    },
  },
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 0),
    '&::placeholder': {
      color: alpha(theme.palette.text.secondary, 0.6),
    },
  },
}))

const SendButton = styled(IconButton)(({ theme }) => ({
  width: 44,
  height: 44,
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    transform: 'scale(1.05)',
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.2)}`,
  },
  '&:disabled': {
    background: alpha(theme.palette.text.primary, 0.1),
    color: alpha(theme.palette.text.primary, 0.3),
  },
}))

const TypingIndicator = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: theme.spacing(2),
  '& span': {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: theme.palette.text.secondary,
    animation: `${typing} 1.4s infinite ease-in-out`,
    '&:nth-of-type(1)': { animationDelay: '0s' },
    '&:nth-of-type(2)': { animationDelay: '0.2s' },
    '&:nth-of-type(3)': { animationDelay: '0.4s' },
  },
}))

const ThinkingBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5, 2),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  borderRadius: 8,  // Figma spec: 8px
  marginBottom: theme.spacing(1),
  animation: `${pulse} 2s infinite ease-in-out`,
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

const EmptyIcon = styled(Box)(({ theme }) => ({
  width: 120,
  height: 120,
  borderRadius: '50%',
  background: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: theme.spacing(3),
  animation: `${float} 3s infinite ease-in-out`,
  '& svg': {
    fontSize: 56,
    color: theme.palette.text.secondary,
  },
}))

const SuggestionCard = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderRadius: 8,  // Figma spec: 8px
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
    borderColor: alpha(theme.palette.divider, 0.2),
    transform: 'translateY(-2px)',
  },
}))

const ActionButton = styled(IconButton)(({ theme }) => ({
  width: 28,
  height: 28,
  color: alpha(theme.palette.text.secondary, 0.6),
  '&:hover': {
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const NewSessionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  padding: theme.spacing(1.5, 2),
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  fontWeight: 600,
  textTransform: 'none',
  boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.15)}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    transform: 'translateY(-2px)',
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 6px 28px ${alpha(theme.palette.common.black, 0.2)}`,
  },
}))

const DocumentsSection = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.3),
}))

const LoadingOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: alpha(theme.palette.background.default, 0.8),
  backdropFilter: 'blur(8px)',
  zIndex: 10,
}))

const LoadingSpinner = styled(Box)(({ theme }) => ({
  width: 48,
  height: 48,
  borderRadius: '50%',
  background: `conic-gradient(from 0deg, transparent, ${theme.palette.text.secondary})`,
  animation: 'spin 1s linear infinite',
  '@keyframes spin': {
    to: { transform: 'rotate(360deg)' },
  },
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 4,
    borderRadius: '50%',
    backgroundColor: theme.palette.background.paper,
  },
}))

const GlassDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    backdropFilter: 'blur(20px)',
    borderRadius: 8,  // Figma spec: 8px
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  },
}))


const MAX_DOC_SIZE = 5 * 1024 * 1024
const MIN_DOC_LENGTH = 10
const MAX_NAME_LENGTH = 200
const MIN_QUESTION_LENGTH = 3
const MAX_QUESTION_LENGTH = 2000

export default function DocumentQAPage() {
  const theme = useTheme()
  const {
    sessions,
    currentSession,
    messages,
    loading,
    asking,
    error,
    fetchSessions,
    createSession,
    getSession,
    deleteSession,
    addDocument,
    removeDocument,
    askQuestion,
    clearHistory,
    submitFeedback,
    regenerateResponse,
    reset,
  } = useDocQAStore()

  const { connections, templates } = useSharedData()

  // Cross-page: accept incoming documents from other features
  useIncomingTransfer(FeatureKey.DOCQA, {
    [TransferAction.CHAT_WITH]: async (payload) => {
      const session = await createSession(payload.title ? `Q&A: ${payload.title}` : 'Q&A: Imported')
      if (session) {
        await addDocument(session.id, {
          name: payload.title || 'Imported Document',
          content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content),
        })
      }
    },
    [TransferAction.ADD_TO]: async (payload) => {
      if (currentSession) {
        await addDocument(currentSession.id, {
          name: payload.title || 'Imported Document',
          content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content),
        })
      }
    },
  })

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [addDocDialogOpen, setAddDocDialogOpen] = useState(false)
  const [reportPickerOpen, setReportPickerOpen] = useState(false)
  const [availableRuns, setAvailableRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const [docName, setDocName] = useState('')
  const [docContent, setDocContent] = useState('')
  const [question, setQuestion] = useState('')
  const messagesEndRef = useRef(null)
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState({
    open: false,
    sessionId: null,
    sessionName: '',
  })
  const [removeDocConfirm, setRemoveDocConfirm] = useState({
    open: false,
    docId: null,
    docName: '',
  })
  const [clearChatConfirm, setClearChatConfirm] = useState({
    open: false,
    sessionId: null,
    sessionName: '',
    messageCount: 0,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const toast = useToast()
  const [initialLoading, setInitialLoading] = useState(true)
  const inputRef = useRef(null)
  const docCount = currentSession?.documents?.length || 0
  // UX Governance: Enforced interaction API - ALL user actions flow through this
  const { execute } = useInteraction()
  // UX: Confirmed action for irreversible delete operations
  const confirmDeleteSession = useConfirmedAction('DELETE_SESSION')

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true)
      await fetchSessions()
      setInitialLoading(false)
    }
    init()
    return () => reset()
  }, [fetchSessions, reset])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleCreateSession = () => {
    if (!newSessionName) return
    if (newSessionName.length > MAX_NAME_LENGTH) {
      toast.show(`Session name must be ${MAX_NAME_LENGTH} characters or less`, 'error')
      return
    }
    // UX Governance: All actions flow through enforced interaction API
    execute({
      type: InteractionType.CREATE,
      label: `Create session "${newSessionName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Session created successfully',
      action: async () => {
        await createSession(newSessionName)
        setCreateDialogOpen(false)
        setNewSessionName('')
      },
    })
  }

  const handleAddDocument = () => {
    if (!currentSession || !docName || !docContent) return
    if (docName.length > MAX_NAME_LENGTH) {
      toast.show(`Document name must be ${MAX_NAME_LENGTH} characters or less`, 'error')
      return
    }
    if (docContent.trim().length < MIN_DOC_LENGTH) {
      toast.show(`Document content must be at least ${MIN_DOC_LENGTH} characters`, 'error')
      return
    }
    if (docContent.length > MAX_DOC_SIZE) {
      toast.show('Document content exceeds 5MB limit', 'error')
      return
    }
    // UX Governance: Upload action with tracking
    execute({
      type: InteractionType.UPLOAD,
      label: `Add document "${docName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Document added successfully',
      action: async () => {
        await addDocument(currentSession.id, {
          name: docName,
          content: docContent,
        })
        setAddDocDialogOpen(false)
        setDocName('')
        setDocContent('')
      },
    })
  }

  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (!file) return
    if (file.name.length > MAX_NAME_LENGTH) {
      toast.show(`File name must be ${MAX_NAME_LENGTH} characters or less`, 'error')
      event.target.value = ''
      return
    }

    const allowedExtensions = ['.txt', '.md', '.json', '.csv']
    const fileName = file.name.toLowerCase()
    const hasValidExtension = allowedExtensions.some((ext) =>
      fileName.endsWith(ext)
    )

    if (!hasValidExtension) {
      toast.show(
        `Invalid file type. Supported formats: ${allowedExtensions.join(', ')}`,
        'error'
      )
      event.target.value = ''
      return
    }

    if (file.size > MAX_DOC_SIZE) {
      toast.show('File size exceeds 5MB limit', 'error')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target.result
      if (content.includes('\0')) {
        toast.show('File appears to be binary. Please upload a text file.', 'error')
        event.target.value = ''
        return
      }
      setDocName(file.name)
      setDocContent(content)
    }
    reader.onerror = () => {
      toast.show('Failed to read file', 'error')
      event.target.value = ''
    }
    reader.readAsText(file)
  }

  const handleOpenReportPicker = async () => {
    setReportPickerOpen(true)
    setRunsLoading(true)
    try {
      const runs = await listReportRuns({ limit: 50 })
      setAvailableRuns(runs.filter((r) => r.status === 'succeeded'))
    } catch {
      toast.show('Failed to load reports', 'error')
    } finally {
      setRunsLoading(false)
    }
  }

  const handleSelectReport = (run) => {
    if (!currentSession) return
    execute({
      type: InteractionType.UPLOAD,
      label: `Add report "${run.templateName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: `Report "${run.templateName}" added`,
      action: async () => {
        await addDocument(currentSession.id, {
          name: `${run.templateName} (${run.startDate} – ${run.endDate})`,
          content: [
            `Report: ${run.templateName}`,
            `Period: ${run.startDate} to ${run.endDate}`,
            `Connection: ${run.connectionName}`,
            `Generated: ${new Date(run.createdAt).toLocaleString()}`,
            `Status: ${run.status}`,
            run.artifacts?.html_url ? `HTML: ${run.artifacts.html_url}` : '',
            run.artifacts?.pdf_url ? `PDF: ${run.artifacts.pdf_url}` : '',
          ].filter(Boolean).join('\n'),
        })
        setReportPickerOpen(false)
      },
    })
  }

  const handleAskQuestion = () => {
    if (!currentSession || !question.trim()) return
    const trimmedQuestion = question.trim()
    if (trimmedQuestion.length < MIN_QUESTION_LENGTH) {
      toast.show(`Question must be at least ${MIN_QUESTION_LENGTH} characters`, 'error')
      return
    }
    if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
      toast.show(`Question must be ${MAX_QUESTION_LENGTH} characters or less`, 'error')
      return
    }
    const q = trimmedQuestion
    // UX Governance: Analyze action with navigation safety
    execute({
      type: InteractionType.ANALYZE,
      label: 'Analyzing documents...',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      action: async () => {
        setQuestion('')
        await askQuestion(currentSession.id, q)
      },
    })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAskQuestion()
    }
  }

  const handleCopyMessage = (content) => {
    navigator.clipboard.writeText(content)
    toast.show('Copied to clipboard', 'success')
  }

  const handleCitationClick = useCallback(async (citation) => {
    const text = citation?.quote || citation?.document_name
    if (!text) return
    if (!navigator?.clipboard?.writeText) {
      toast.show('Clipboard not available', 'warning')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.show('Citation copied', 'success')
    } catch (err) {
      toast.show(err.message || 'Failed to copy citation', 'error')
    }
  }, [toast])

  const handleFeedback = async (messageId, feedbackType) => {
    if (!currentSession) return
    const result = await submitFeedback(currentSession.id, messageId, feedbackType)
    if (result) {
      toast.show(feedbackType === 'helpful' ? 'Thanks for the feedback!' : 'Thanks for letting us know', 'success')
    }
  }

  const handleRegenerate = (messageId) => {
    if (!currentSession) return
    // UX Governance: Regenerate action with tracking
    execute({
      type: InteractionType.GENERATE,
      label: 'Regenerating response...',
      reversibility: Reversibility.SYSTEM_MANAGED,
      successMessage: 'Response regenerated',
      errorMessage: 'Failed to regenerate response',
      blocksNavigation: true,
      action: async () => {
        const result = await regenerateResponse(currentSession.id, messageId)
        if (!result) throw new Error('Regenerate failed')
      },
    })
  }

  const filteredSessions = sessions.filter((session) =>
    session.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const suggestedQuestions = [
    'What are the main topics covered in these documents?',
    'Can you summarize the key findings?',
    'What are the most important insights?',
    'Are there any conflicting information?',
  ]

  // Loading state
  if (initialLoading) {
    return (
      <PageContainer>
        <LoadingOverlay>
          <Box sx={{ textAlign: 'center' }}>
            <Box sx={{ position: 'relative', width: 48, height: 48, mx: 'auto', mb: 2 }}>
              <LoadingSpinner />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Loading your sessions...
            </Typography>
          </Box>
        </LoadingOverlay>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {/* Sidebar */}
      <Sidebar>
        <SidebarHeader>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1,  // Figma spec: 8px
                background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <QAIcon sx={{ color: 'common.white', fontSize: 24 }} />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                Document Q&A
              </Typography>
              <Typography variant="caption" color="text.secondary">
                AI-powered analysis
              </Typography>
            </Box>
          </Box>

          <NewSessionButton
            fullWidth
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            New Session
          </NewSessionButton>

          <TextField
            fullWidth
            size="small"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ mt: 2 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                </InputAdornment>
              ),
              sx: {
                borderRadius: 1,  // Figma spec: 8px
                backgroundColor: alpha(theme.palette.background.paper, 0.5),
                '& fieldset': {
                  borderColor: alpha(theme.palette.divider, 0.1),
                },
              },
            }}
          />
        </SidebarHeader>

        <SessionList>
          <Typography
            variant="overline"
            sx={{ color: 'text.secondary', px: 1, display: 'block', mb: 1 }}
          >
            Sessions ({filteredSessions.length})
          </Typography>

          {filteredSessions.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <FolderIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                {searchQuery ? 'No matching sessions' : 'No sessions yet'}
              </Typography>
            </Box>
          ) : (
            filteredSessions.map((session, index) => (
              <Fade in key={session.id} style={{ transitionDelay: `${index * 50}ms` }}>
                <SessionCard
                  selected={currentSession?.id === session.id}
                  onClick={() => getSession(session.id)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <Box sx={{ flex: 1, minWidth: 0, pl: 1 }}>
                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontWeight: currentSession?.id === session.id ? 600 : 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {session.name}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        <DocumentChip
                          size="small"
                          icon={<FileIcon />}
                          label={`${session.documents?.length || 0} docs`}
                        />
                      </Box>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteSessionConfirm({
                          open: true,
                          sessionId: session.id,
                          sessionName: session.name,
                        })
                      }}
                      sx={{
                        opacity: 0.5,
                        '&:hover': { opacity: 1, color: 'text.primary' },
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </SessionCard>
              </Fade>
            ))
          )}
        </SessionList>

        {/* Documents section for current session */}
        {currentSession && (
          <DocumentsSection>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                Documents
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <ImportFromMenu
                  currentFeature={FeatureKey.DOCQA}
                  onImport={(output) => {
                    if (currentSession) {
                      addDocument(currentSession.id, {
                        name: output.title || 'Imported',
                        content: typeof output.data === 'string' ? output.data : JSON.stringify(output.data),
                      })
                    }
                  }}
                  size="small"
                />
                <Tooltip title="Add document">
                  <IconButton
                    size="small"
                    onClick={() => setAddDocDialogOpen(true)}
                    aria-label="Add document"
                    sx={{
                      bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                      '&:hover': { bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200] },
                    }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {currentSession.documents?.map((doc) => (
                <Box
                  key={doc.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1,
                    borderRadius: 1.5,
                    bgcolor: alpha(theme.palette.background.paper, 0.5),
                    '&:hover': { bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50] },
                  }}
                >
                  <DocIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography
                    variant="caption"
                    sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {doc.name}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => setRemoveDocConfirm({ open: true, docId: doc.id, docName: doc.name })}
                    sx={{ opacity: 0.5, '&:hover': { opacity: 1, color: 'text.primary' } }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
              {(!currentSession.documents || currentSession.documents.length === 0) && (
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                  No documents added yet
                </Typography>
              )}
            </Box>
          </DocumentsSection>
        )}

        {/* Database connection for enriched Q&A */}
        <Box sx={{ p: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <ConnectionSelector
            value={selectedConnectionId}
            onChange={setSelectedConnectionId}
            label="Enrich with Database (Optional)"
            size="small"
            showStatus
            fullWidth
          />
        </Box>
      </Sidebar>

      {/* Chat Area */}
      <ChatArea>
        {currentSession ? (
          <>
            {/* Chat Header */}
            <ChatHeader>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 1,  // Figma spec: 8px
                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <QAIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {currentSession.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {currentSession.documents?.length || 0} documents •{' '}
                    {messages.length} messages •{' '}
                    {connections.length} connections available
                  </Typography>
                </Box>
              </Box>
              {messages.length > 0 && (
                <Button
                  size="small"
                  startIcon={<ClearIcon />}
                  onClick={() => setClearChatConfirm({
                    open: true,
                    sessionId: currentSession.id,
                    sessionName: currentSession.name,
                    messageCount: messages.length,
                  })}
                  sx={{
                    borderRadius: 1,  // Figma spec: 8px
                    textTransform: 'none',
                    color: 'text.secondary',
                  }}
                >
                  Clear Chat
                </Button>
              )}
            </ChatHeader>

            <Box sx={{ px: 3, pt: 2 }}>
              <AiUsageNotice
                title="AI answers"
                description="Responses are generated from documents in this session. Review citations before sharing."
                chips={[
                  { label: `Source: ${docCount} document${docCount === 1 ? '' : 's'}`, color: 'info', variant: 'outlined' },
                  { label: 'Confidence: Verify citations', color: 'warning', variant: 'outlined' },
                  { label: 'Reversible: No source changes', color: 'success', variant: 'outlined' },
                ]}
                dense
              />
            </Box>

            {/* Messages */}
            <MessagesContainer>
              {messages.length === 0 ? (
                <EmptyState>
                  <EmptyIcon>
                    <AIIcon />
                  </EmptyIcon>
                  <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
                    {currentSession.documents?.length > 0
                      ? 'Ready to answer your questions'
                      : 'Add documents to get started'}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mb: 4, maxWidth: 400 }}>
                    {currentSession.documents?.length > 0
                      ? 'Ask anything about your documents. I\'ll analyze them and provide accurate answers with citations.'
                      : 'Upload documents to this session, then ask questions about their content.'}
                  </Typography>

                  {currentSession.documents?.length > 0 && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, maxWidth: 600 }}>
                      {suggestedQuestions.map((q, idx) => (
                        <SuggestionCard key={idx} onClick={() => setQuestion(q)}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {q}
                          </Typography>
                        </SuggestionCard>
                      ))}
                    </Box>
                  )}

                  {!currentSession.documents?.length && (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Button
                        variant="outlined"
                        startIcon={<UploadIcon />}
                        onClick={() => setAddDocDialogOpen(true)}
                        sx={{
                          borderRadius: 1,
                          textTransform: 'none',
                          px: 4,
                          py: 1.5,
                        }}
                      >
                        Upload Document
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={<ArticleIcon />}
                        onClick={handleOpenReportPicker}
                        sx={{
                          borderRadius: 1,
                          textTransform: 'none',
                          px: 4,
                          py: 1.5,
                          background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                        }}
                      >
                        Select Existing Report
                      </Button>
                    </Box>
                  )}

                  {connections.length > 0 && (
                    <Box sx={{ mt: 3, textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        {connections.length} database connection{connections.length !== 1 ? 's' : ''} and {templates.length} template{templates.length !== 1 ? 's' : ''} available
                      </Typography>
                    </Box>
                  )}
                </EmptyState>
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <MessageBubble key={idx} isUser={msg.role === 'user'} index={idx}>
                      <Box
                        sx={{
                          display: 'flex',
                          gap: 1.5,
                          flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                          alignItems: 'flex-start',
                        }}
                      >
                        <AvatarStyled isUser={msg.role === 'user'}>
                          {msg.role === 'user' ? <UserIcon /> : <AIIcon />}
                        </AvatarStyled>

                        <Box sx={{ flex: 1 }}>
                          <BubbleContent isUser={msg.role === 'user'}>
                            <Typography
                              variant="body2"
                              sx={{
                                whiteSpace: 'pre-wrap',
                                lineHeight: 1.6,
                              }}
                            >
                              {msg.content}
                            </Typography>
                          </BubbleContent>

                          {/* Citations */}
                          {msg.citations?.length > 0 && (
                            <CitationBox>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <QuoteIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                  Sources ({msg.citations.length})
                                </Typography>
                              </Box>
                              {msg.citations.map((cit, cidx) => (
                                <CitationItem key={cidx} onClick={() => handleCitationClick(cit)}>
                                  <FileIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.25 }} />
                                  <Box>
                                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                                      {cit.document_name}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{ fontStyle: 'italic' }}
                                    >
                                      "{cit.quote?.substring(0, 120)}..."
                                    </Typography>
                                  </Box>
                                </CitationItem>
                              ))}
                            </CitationBox>
                          )}

                          {/* Follow-up questions */}
                          {msg.metadata?.follow_up_questions?.length > 0 && (
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                Related questions
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {msg.metadata.follow_up_questions.map((fq, fqidx) => (
                                  <FollowUpChip
                                    key={fqidx}
                                    label={fq}
                                    size="small"
                                    clickable
                                    onClick={() => setQuestion(fq)}
                                  />
                                ))}
                              </Box>
                            </Box>
                          )}

                          {/* Message actions */}
                          {msg.role === 'assistant' && (
                            <Box sx={{ display: 'flex', gap: 0.5, mt: 1.5 }}>
                              <Tooltip title="Copy">
                                <ActionButton size="small" onClick={() => handleCopyMessage(msg.content)}>
                                  <CopyIcon sx={{ fontSize: 16 }} />
                                </ActionButton>
                              </Tooltip>
                              <Tooltip title={msg.feedback?.feedback_type === 'helpful' ? 'Marked as helpful' : 'Helpful'}>
                                <ActionButton
                                  size="small"
                                  onClick={() => handleFeedback(msg.id, 'helpful')}
                                  sx={{
                                    color: msg.feedback?.feedback_type === 'helpful'
                                      ? 'text.primary'
                                      : undefined,
                                    bgcolor: msg.feedback?.feedback_type === 'helpful'
                                      ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100])
                                      : undefined,
                                  }}
                                >
                                  <ThumbUpIcon sx={{ fontSize: 16 }} />
                                </ActionButton>
                              </Tooltip>
                              <Tooltip title={msg.feedback?.feedback_type === 'not_helpful' ? 'Marked as not helpful' : 'Not helpful'}>
                                <ActionButton
                                  size="small"
                                  onClick={() => handleFeedback(msg.id, 'not_helpful')}
                                  sx={{
                                    color: msg.feedback?.feedback_type === 'not_helpful'
                                      ? 'text.primary'
                                      : undefined,
                                    bgcolor: msg.feedback?.feedback_type === 'not_helpful'
                                      ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100])
                                      : undefined,
                                  }}
                                >
                                  <ThumbDownIcon sx={{ fontSize: 16 }} />
                                </ActionButton>
                              </Tooltip>
                              <Tooltip title="Regenerate response">
                                <ActionButton
                                  size="small"
                                  onClick={() => handleRegenerate(msg.id)}
                                  disabled={asking}
                                >
                                  <RefreshIcon sx={{ fontSize: 16 }} />
                                </ActionButton>
                              </Tooltip>
                            </Box>
                          )}
                        </Box>
                      </Box>
                    </MessageBubble>
                  ))}

                  {/* Typing indicator */}
                  {asking && (
                    <MessageBubble isUser={false} index={messages.length}>
                      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        <AvatarStyled isUser={false}>
                          <AIIcon />
                        </AvatarStyled>
                        <Box>
                          <ThinkingBox>
                            <ThinkIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ fontWeight: 500 }}>
                              Analyzing documents...
                            </Typography>
                          </ThinkingBox>
                          <BubbleContent isUser={false}>
                            <TypingIndicator>
                              <span />
                              <span />
                              <span />
                            </TypingIndicator>
                          </BubbleContent>
                        </Box>
                      </Box>
                    </MessageBubble>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </MessagesContainer>

            {/* Input Area */}
            <InputArea>
              {error && (
                <Alert
                  severity="error"
                  onClose={() => reset()}
                  sx={{ mb: 2, borderRadius: 1 }}
                >
                  {error}
                </Alert>
              )}
              <InputContainer>
                <Tooltip title="Attach file">
                  <IconButton
                    size="small"
                    onClick={() => setAddDocDialogOpen(true)}
                    sx={{ color: 'text.secondary' }}
                  >
                    <AttachIcon />
                  </IconButton>
                </Tooltip>
                <StyledTextField
                  ref={inputRef}
                  fullWidth
                  placeholder={
                    currentSession.documents?.length
                      ? 'Ask a question about your documents...'
                      : 'Add documents to start asking questions...'
                  }
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={asking || !currentSession.documents?.length}
                  multiline
                  maxRows={4}
                  inputProps={{ maxLength: MAX_QUESTION_LENGTH }}
                />
                {/* UX: DisabledTooltip explains WHY the button is disabled */}
                <DisabledTooltip
                  disabled={
                    !question.trim()
                    || question.trim().length < MIN_QUESTION_LENGTH
                    || question.trim().length > MAX_QUESTION_LENGTH
                    || asking
                    || !currentSession.documents?.length
                  }
                  reason={
                    asking
                      ? 'Please wait for the current question to complete'
                      : !currentSession.documents?.length
                        ? 'Add at least one document first'
                        : !question.trim()
                          ? 'Enter a question to ask'
                          : question.trim().length < MIN_QUESTION_LENGTH
                            ? `Question must be at least ${MIN_QUESTION_LENGTH} characters`
                            : question.trim().length > MAX_QUESTION_LENGTH
                              ? `Question exceeds ${MAX_QUESTION_LENGTH} character limit`
                              : undefined
                  }
                  hint={
                    !currentSession.documents?.length
                      ? 'Click the attach button or drag a file'
                      : !question.trim()
                        ? 'Type your question in the field above'
                        : undefined
                  }
                >
                  <SendButton
                    onClick={handleAskQuestion}
                    disabled={
                      !question.trim()
                      || question.trim().length < MIN_QUESTION_LENGTH
                      || question.trim().length > MAX_QUESTION_LENGTH
                      || asking
                      || !currentSession.documents?.length
                    }
                  >
                    {asking ? (
                      <Box
                        sx={{
                          width: 20,
                          height: 20,
                          border: '2px solid',
                          borderColor: 'rgba(255,255,255,0.3)',
                          borderTopColor: 'common.white',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                    ) : (
                      <SendIcon />
                    )}
                  </SendButton>
                </DisabledTooltip>
              </InputContainer>
            </InputArea>
          </>
        ) : (
          <EmptyState>
            <EmptyIcon>
              <QAIcon />
            </EmptyIcon>
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
              Document Intelligence
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 4, maxWidth: 450 }}>
              Create a session, upload your documents, and start asking questions.
              Our AI will analyze and provide accurate answers with citations.
            </Typography>
            <NewSessionButton
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
              sx={{ px: 4, py: 1.5 }}
            >
              Create Your First Session
            </NewSessionButton>
          </EmptyState>
        )}
      </ChatArea>

      {/* Create Session Dialog */}
      <GlassDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Create Q&A Session
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Start a new document analysis workspace
          </Typography>
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Session Name"
            placeholder="e.g., Research Papers Analysis"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            sx={{ mt: 2 }}
            inputProps={{ maxLength: MAX_NAME_LENGTH }}
            InputProps={{
              sx: { borderRadius: 1 },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setCreateDialogOpen(false)}
            sx={{ borderRadius: 1, textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateSession}
            disabled={!newSessionName}
            sx={{
              borderRadius: 1,  // Figma spec: 8px
              textTransform: 'none',
              px: 3,
              background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
            }}
          >
            Create Session
          </Button>
        </DialogActions>
      </GlassDialog>

      {/* Add Document Dialog */}
      <GlassDialog
        open={addDocDialogOpen}
        onClose={() => setAddDocDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Add Document
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Upload or paste document content for analysis
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{
              mt: 2,
              p: 4,
              border: `2px dashed ${alpha(theme.palette.divider, 0.4)}`,
              borderRadius: 1,  // Figma spec: 8px
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.02) : neutral[50],
              '&:hover': {
                borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[100],
              },
            }}
            component="label"
          >
            <UploadIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body1" sx={{ fontWeight: 500, mb: 0.5 }}>
              Drop your file here or click to browse
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Supports TXT, MD, JSON, CSV (max 5MB)
            </Typography>
            <input
              type="file"
              hidden
              onChange={handleFileUpload}
              accept=".txt,.md,.json,.csv"
            />
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography variant="caption" color="text.secondary">
              OR
            </Typography>
          </Divider>

          <TextField
            fullWidth
            label="Document Name"
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            sx={{ mb: 2 }}
            inputProps={{ maxLength: MAX_NAME_LENGTH }}
            InputProps={{ sx: { borderRadius: 1 } }}
          />
          <TextField
            fullWidth
            multiline
            rows={10}
            label="Document Content"
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            placeholder="Paste your document content here..."
            inputProps={{ maxLength: MAX_DOC_SIZE }}
            InputProps={{ sx: { borderRadius: 1 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setAddDocDialogOpen(false)}
            sx={{ borderRadius: 1, textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddDocument}
            disabled={!docName || !docContent}
            sx={{
              borderRadius: 1,  // Figma spec: 8px
              textTransform: 'none',
              px: 3,
              background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
            }}
          >
            Add Document
          </Button>
        </DialogActions>
      </GlassDialog>

      {/* Select Existing Report Dialog */}
      <GlassDialog
        open={reportPickerOpen}
        onClose={() => setReportPickerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Select Existing Report
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose a generated report to add to this session
          </Typography>
        </DialogTitle>
        <DialogContent>
          {runsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <ContentSkeleton rows={3} />
            </Box>
          ) : availableRuns.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <ArticleIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary">
                No generated reports found
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Generate a report first, then come back to analyze it here.
              </Typography>
            </Box>
          ) : (
            <List sx={{ pt: 1 }}>
              {availableRuns.map((run) => (
                <ListItem
                  key={run.id}
                  button
                  onClick={() => handleSelectReport(run)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                    '&:hover': {
                      bgcolor: theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.primary, 0.06)
                        : neutral[50],
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <ArticleIcon sx={{ color: 'text.secondary' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={run.templateName || run.id}
                    secondary={`${run.startDate} – ${run.endDate} · ${run.connectionName || 'Unknown source'}`}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1 }}>
                    {new Date(run.createdAt).toLocaleDateString()}
                  </Typography>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setReportPickerOpen(false)}
            sx={{ borderRadius: 1, textTransform: 'none' }}
          >
            Cancel
          </Button>
        </DialogActions>
      </GlassDialog>

      {/* Confirm Modals */}
      <ConfirmModal
        open={deleteSessionConfirm.open}
        onClose={() =>
          setDeleteSessionConfirm({ open: false, sessionId: null, sessionName: '' })
        }
        onConfirm={() => {
          const sessionId = deleteSessionConfirm.sessionId
          const sessionName = deleteSessionConfirm.sessionName
          setDeleteSessionConfirm({ open: false, sessionId: null, sessionName: '' })

          // UX Governance: Irreversible delete action with full tracking
          execute({
            type: InteractionType.DELETE,
            label: `Delete session "${sessionName}"`,
            reversibility: Reversibility.IRREVERSIBLE,
            successMessage: `Session "${sessionName}" deleted`,
            errorMessage: 'Failed to delete session',
            action: async () => {
              const success = await deleteSession(sessionId)
              if (!success) throw new Error('Delete failed')
            },
          })
        }}
        title="Delete Session"
        message={`Are you sure you want to delete "${deleteSessionConfirm.sessionName}"? All documents and chat history will be permanently removed.`}
        confirmLabel="Delete"
        severity="error"
      />

      <ConfirmModal
        open={removeDocConfirm.open}
        onClose={() =>
          setRemoveDocConfirm({ open: false, docId: null, docName: '' })
        }
        onConfirm={() => {
          const docId = removeDocConfirm.docId
          const docName = removeDocConfirm.docName
          setRemoveDocConfirm({ open: false, docId: null, docName: '' })

          // UX Governance: Delete action with tracking
          execute({
            type: InteractionType.DELETE,
            label: `Remove document "${docName}"`,
            reversibility: Reversibility.PARTIALLY_REVERSIBLE,
            successMessage: `Document "${docName}" removed`,
            errorMessage: 'Failed to remove document',
            action: async () => {
              const success = await removeDocument(currentSession?.id, docId)
              if (!success) throw new Error('Remove failed')
            },
          })
        }}
        title="Remove Document"
        message={`Are you sure you want to remove "${removeDocConfirm.docName}" from this session?`}
        confirmLabel="Remove"
        severity="warning"
      />

      {/* Clear Chat Confirmation */}
      <ConfirmModal
        open={clearChatConfirm.open}
        onClose={() =>
          setClearChatConfirm({ open: false, sessionId: null, sessionName: '', messageCount: 0 })
        }
        onConfirm={() => {
          const sessionId = clearChatConfirm.sessionId
          const sessionName = clearChatConfirm.sessionName
          setClearChatConfirm({ open: false, sessionId: null, sessionName: '', messageCount: 0 })

          // UX Governance: Clear action with tracking
          execute({
            type: InteractionType.DELETE,
            label: `Clear chat history for "${sessionName}"`,
            reversibility: Reversibility.PARTIALLY_REVERSIBLE,
            successMessage: 'Chat history cleared',
            errorMessage: 'Failed to clear chat history',
            action: async () => {
              await clearHistory(sessionId)
            },
          })
        }}
        title="Clear Chat History"
        message={`Are you sure you want to clear all ${clearChatConfirm.messageCount} messages from "${clearChatConfirm.sessionName}"? This action cannot be undone.`}
        confirmLabel="Clear History"
        severity="warning"
      />
    </PageContainer>
  )
}
