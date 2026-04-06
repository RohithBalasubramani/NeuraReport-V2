import { neutral, palette } from '@/app/theme'
import { FullHeightPageContainer as PageContainer } from '@/styles/styles'
import { ImportFromMenu, TemplateSelector, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useIncomingTransfer, useSharedData } from '@/hooks/hooks'
import { useDocumentStore } from '@/stores/content'
import { FeatureKey, TransferAction } from '@/utils/helpers'
import {
  Add as AddIcon,
  AutoAwesome as AIIcon,
  Check as ResolveIcon,
  CheckBox,
  Close as CloseIcon,
  Code,
  Comment as CommentIcon,
  Compare as CompareIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Description as DocIcon,
  Download as DownloadIcon,
  Edit as RewriteIcon,
  Expand as ExpandIcon,
  ExpandLess as CollapseIcon,
  ExpandMore as ExpandMoreIcon,
  FolderOpen as OpenIcon,
  FormatAlignCenter,
  FormatAlignJustify,
  FormatAlignLeft,
  FormatAlignRight,
  FormatBold,
  FormatClear,
  FormatColorFill as ToneIcon,
  FormatItalic,
  FormatListBulleted,
  FormatListNumbered,
  FormatQuote,
  FormatStrikethrough,
  FormatUnderlined,
  Highlight as HighlightIcon,
  History as HistoryIcon,
  HorizontalRule,
  Image as ImageIcon,
  Link as LinkIcon,
  MoreVert as MoreIcon,
  NoteAdd as NewIcon,
  People as CollabIcon,
  Person as PersonIcon,
  Redo,
  Reply as ReplyIcon,
  Restore as RestoreIcon,
  Save as SaveIcon,
  Send as SendIcon,
  Spellcheck as GrammarIcon,
  Summarize as SummarizeIcon,
  TableChart,
  Translate as TranslateIcon,
  Undo,
} from '@mui/icons-material'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
const PanelContainer = styled(Box)(({ theme }) => ({
  width: 320,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: alpha(theme.palette.background.paper, 0.95),
  backdropFilter: 'blur(10px)',
  borderLeft: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const PanelHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const PanelContent = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(2),
}))

const CommentComposer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.default, 0.5),
}))

const CommentCard = styled(Paper, {
  shouldForwardProp: (prop) => !['isResolved', 'isHighlighted'].includes(prop),
})(({ theme, isResolved, isHighlighted }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(1.5),
  border: `1px solid ${
    isHighlighted
      ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
      : isResolved
      ? alpha(theme.palette.divider, 0.3)
      : alpha(theme.palette.divider, 0.1)
  }`,
  backgroundColor: isResolved
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.02) : neutral[50])
    : isHighlighted
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50])
    : 'transparent',
  opacity: isResolved ? 0.7 : 1,
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const ReplyCard = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(1.5),
  paddingTop: theme.spacing(1.5),
  paddingLeft: theme.spacing(2),
  borderLeft: `2px solid ${alpha(theme.palette.divider, 0.3)}`,
}))

const QuotedText = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1),
  marginBottom: theme.spacing(1),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  borderLeft: `3px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[300]}`,
  borderRadius: '0 4px 4px 0',
  fontSize: '0.75rem',
  fontStyle: 'italic',
  color: theme.palette.text.secondary,
}))

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.75rem',
}))

const CompactTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 8,
    fontSize: '0.875rem',
  },
}))


const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

const formatDate = (dateString) => {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}


function CommentItem({
  comment,
  onResolve,
  onReply,
  onDelete,
  onHighlight,
  isHighlighted,
}) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(true)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')

  const handleReply = () => {
    if (replyText.trim()) {
      onReply?.(comment.id, replyText.trim())
      setReplyText('')
      setReplyOpen(false)
    }
  }

  const replies = comment.replies || []

  return (
    <CommentCard
      elevation={0}
      isResolved={comment.resolved}
      isHighlighted={isHighlighted}
      onClick={() => onHighlight?.(comment)}
      data-testid={`comment-card-${comment.id}`}
    >
      {/* Comment Header */}
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <Avatar
          sx={{
            width: 28,
            height: 28,
            fontSize: '0.75rem',
            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
            color: theme.palette.text.secondary,
          }}
        >
          {getInitials(comment.author_name)}
        </Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '14px' }}>
            {comment.author_name || 'Anonymous'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(comment.created_at)}
          </Typography>
        </Box>
        {comment.resolved && (
          <Chip
            label="Resolved"
            size="small"
            sx={{
              borderRadius: 1,
              fontSize: '10px',
              height: 20,
              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
              color: 'text.secondary',
            }}
          />
        )}
      </Stack>

      {/* Quoted Text */}
      {comment.quoted_text && (
        <QuotedText>"{comment.quoted_text}"</QuotedText>
      )}

      {/* Comment Text */}
      <Typography variant="body2" sx={{ mb: 1.5, fontSize: '14px' }}>
        {comment.text}
      </Typography>

      {/* Actions */}
      <Stack direction="row" spacing={1} alignItems="center">
        {!comment.resolved && (
          <>
            <Tooltip title="Reply">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  setReplyOpen(!replyOpen)
                }}
                data-testid="comment-reply-button"
                aria-label="Reply"
              >
                <ReplyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Resolve">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  onResolve?.(comment.id)
                }}
                data-testid="comment-resolve-button"
                aria-label="Resolve comment"
              >
                <ResolveIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip title="Delete">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(comment.id)
            }}
            data-testid="comment-delete-button"
            aria-label="Delete comment"
          >
            <DeleteIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          </IconButton>
        </Tooltip>

        {replies.length > 0 && (
          <Box sx={{ flex: 1, textAlign: 'right' }}>
            <Button
              size="small"
              endIcon={expanded ? <CollapseIcon /> : <ExpandIcon />}
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(!expanded)
              }}
              sx={{ fontSize: '12px', textTransform: 'none' }}
            >
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </Button>
          </Box>
        )}
      </Stack>

      {/* Reply Input */}
      <Collapse in={replyOpen}>
        <Box sx={{ mt: 2 }}>
          <CompactTextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            placeholder="Write a reply..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <Stack direction="row" spacing={1} mt={1} justifyContent="flex-end">
            <ActionButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                setReplyOpen(false)
                setReplyText('')
              }}
            >
              Cancel
            </ActionButton>
            <ActionButton
              size="small"
              variant="contained"
              disabled={!replyText.trim()}
              onClick={(e) => {
                e.stopPropagation()
                handleReply()
              }}
            >
              Reply
            </ActionButton>
          </Stack>
        </Box>
      </Collapse>

      {/* Replies */}
      <Collapse in={expanded && replies.length > 0}>
        {replies.map((reply) => (
          <ReplyCard key={reply.id}>
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
              <Avatar
                sx={{
                  width: 22,
                  height: 22,
                  fontSize: '10px',
                  bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[200],
                  color: theme.palette.text.secondary,
                }}
              >
                {getInitials(reply.author_name)}
              </Avatar>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {reply.author_name || 'Anonymous'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDate(reply.created_at)}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ fontSize: '14px', pl: 3.75 }}>
              {reply.text}
            </Typography>
          </ReplyCard>
        ))}
      </Collapse>
    </CommentCard>
  )
}


function CommentsPanel({
  comments = [],
  loading = false,
  highlightedCommentId = null,
  selectedText = '',
  onAddComment,
  onResolveComment,
  onReplyComment,
  onDeleteComment,
  onHighlightComment,
  onClose,
}) {
  const theme = useTheme()
  const [newCommentText, setNewCommentText] = useState('')
  const [filter, setFilter] = useState('all') // 'all', 'open', 'resolved'

  const handleAddComment = useCallback(() => {
    if (newCommentText.trim()) {
      onAddComment?.({
        text: newCommentText.trim(),
        quoted_text: selectedText || undefined,
      })
      setNewCommentText('')
    }
  }, [newCommentText, selectedText, onAddComment])

  const filteredComments = comments.filter((c) => {
    if (filter === 'open') return !c.resolved
    if (filter === 'resolved') return c.resolved
    return true
  })

  const openCount = comments.filter((c) => !c.resolved).length
  const resolvedCount = comments.filter((c) => c.resolved).length

  return (
    <PanelContainer>
      <PanelHeader>
        <Stack direction="row" alignItems="center" spacing={1}>
          <CommentIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Comments
          </Typography>
          <Chip
            label={comments.length}
            size="small"
            sx={{ borderRadius: 1, fontSize: '12px', height: 20 }}
          />
        </Stack>
        <IconButton size="small" onClick={onClose} data-testid="comments-panel-close" aria-label="Close comments">
          <CloseIcon fontSize="small" />
        </IconButton>
      </PanelHeader>

      {/* Filter Tabs */}
      <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Stack direction="row" spacing={1}>
          <Chip
            label={`All (${comments.length})`}
            size="small"
            onClick={() => setFilter('all')}
            variant={filter === 'all' ? 'filled' : 'outlined'}
            data-testid="comments-filter-all"
            sx={{
              borderRadius: 1,
              fontSize: '12px',
              bgcolor: filter === 'all' ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900]) : 'transparent',
              color: filter === 'all' ? 'common.white' : 'text.secondary',
              borderColor: filter === 'all' ? 'transparent' : alpha(theme.palette.divider, 0.3),
            }}
          />
          <Chip
            label={`Open (${openCount})`}
            size="small"
            onClick={() => setFilter('open')}
            variant={filter === 'open' ? 'filled' : 'outlined'}
            data-testid="comments-filter-open"
            sx={{
              borderRadius: 1,
              fontSize: '12px',
              bgcolor: filter === 'open' ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900]) : 'transparent',
              color: filter === 'open' ? 'common.white' : 'text.secondary',
              borderColor: filter === 'open' ? 'transparent' : alpha(theme.palette.divider, 0.3),
            }}
          />
          <Chip
            label={`Resolved (${resolvedCount})`}
            size="small"
            onClick={() => setFilter('resolved')}
            variant={filter === 'resolved' ? 'filled' : 'outlined'}
            data-testid="comments-filter-resolved"
            sx={{
              borderRadius: 1,
              fontSize: '12px',
              bgcolor: filter === 'resolved' ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900]) : 'transparent',
              color: filter === 'resolved' ? 'common.white' : 'text.secondary',
              borderColor: filter === 'resolved' ? 'transparent' : alpha(theme.palette.divider, 0.3),
            }}
          />
        </Stack>
      </Box>

      <PanelContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : filteredComments.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CommentIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              {filter === 'all'
                ? 'No comments yet'
                : filter === 'open'
                ? 'No open comments'
                : 'No resolved comments'}
            </Typography>
            {filter === 'all' && (
              <Typography variant="caption" color="text.disabled">
                Select text and add a comment
              </Typography>
            )}
          </Box>
        ) : (
          filteredComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isHighlighted={highlightedCommentId === comment.id}
              onResolve={onResolveComment}
              onReply={onReplyComment}
              onDelete={onDeleteComment}
              onHighlight={onHighlightComment}
            />
          ))
        )}
      </PanelContent>

      {/* Comment Composer */}
      <CommentComposer>
        {selectedText && (
          <QuotedText sx={{ mb: 1.5 }}>
            Selected: "{selectedText.slice(0, 100)}
            {selectedText.length > 100 ? '...' : ''}"
          </QuotedText>
        )}
        <CompactTextField
          fullWidth
          size="small"
          multiline
          minRows={2}
          placeholder={selectedText ? 'Add a comment about this selection...' : 'Add a comment...'}
          value={newCommentText}
          onChange={(e) => setNewCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              handleAddComment()
            }
          }}
        />
        <Stack direction="row" justifyContent="space-between" alignItems="center" mt={1}>
          <Typography variant="caption" color="text.secondary">
            Ctrl+Enter to submit
          </Typography>
          <ActionButton
            variant="contained"
            size="small"
            endIcon={<SendIcon sx={{ fontSize: 14 }} />}
            disabled={!newCommentText.trim()}
            onClick={handleAddComment}
            data-testid="comment-submit-button"
          >
            Comment
          </ActionButton>
        </Stack>
      </CommentComposer>
    </PanelContainer>
  )
}

// TipTapEditor

/**
 * TipTap Rich Text Editor Component
 * Full-featured WYSIWYG editor with toolbar, formatting, and collaboration support.
 */


const EditorContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: theme.palette.background.paper,
  borderRadius: 8,  // Figma spec: 8px
  overflow: 'hidden',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const Toolbar = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  padding: theme.spacing(1, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.default, 0.5),
}))

const ToolbarDivider = styled(Divider)(({ theme }) => ({
  height: 24,
  margin: theme.spacing(0, 0.5),
}))

const ToolbarButton = styled(IconButton)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  padding: 6,
  '&.active': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
    color: theme.palette.text.secondary,
  },
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  },
}))

const EditorWrapper = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(3),
  '& .ProseMirror': {
    minHeight: '500px',
    outline: 'none',
    fontFamily: theme.typography.fontFamily,
    fontSize: '1rem',
    lineHeight: 1.8,
    color: theme.palette.text.primary,
    '& p': {
      margin: '0.5em 0',
    },
    '& h1, & h2, & h3, & h4, & h5, & h6': {
      fontWeight: 600,
      marginTop: '1.5em',
      marginBottom: '0.5em',
    },
    '& h1': { fontSize: '2em' },
    '& h2': { fontSize: '1.5em' },
    '& h3': { fontSize: '1.25em' },
    '& ul, & ol': {
      paddingLeft: '1.5em',
    },
    '& blockquote': {
      borderLeft: `4px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}`,
      paddingLeft: '1em',
      marginLeft: 0,
      color: theme.palette.text.secondary,
      fontStyle: 'italic',
    },
    '& code': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
      borderRadius: 4,
      padding: '0.2em 0.4em',
      fontFamily: 'monospace',
    },
    '& pre': {
      backgroundColor: alpha(theme.palette.common.black, 0.05),
      borderRadius: 8,
      padding: '1em',
      overflow: 'auto',
      '& code': {
        backgroundColor: 'transparent',
        padding: 0,
      },
    },
    '& hr': {
      border: 'none',
      borderTop: `2px solid ${alpha(theme.palette.divider, 0.2)}`,
      margin: '2em 0',
    },
    '& a': {
      color: theme.palette.text.secondary,
      textDecoration: 'underline',
      cursor: 'pointer',
    },
    '& img': {
      maxWidth: '100%',
      borderRadius: 8,
    },
    '& mark': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
      borderRadius: 2,
      padding: '0.1em 0.2em',
    },
    '& ul[data-type="taskList"]': {
      listStyle: 'none',
      paddingLeft: 0,
      '& li': {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5em',
        '& input': {
          marginTop: '0.4em',
        },
      },
    },
    '& table': {
      borderCollapse: 'collapse',
      width: '100%',
      margin: '1em 0',
      '& th, & td': {
        border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
        padding: '0.5em',
        minWidth: 80,
      },
      '& th': {
        backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
        fontWeight: 600,
      },
    },
    '& p.is-empty::before': {
      content: 'attr(data-placeholder)',
      color: theme.palette.text.disabled,
      pointerEvents: 'none',
      float: 'left',
      height: 0,
    },
  },
}))

const HeadingSelect = styled(FormControl)(({ theme }) => ({
  minWidth: 120,
  '& .MuiSelect-select': {
    padding: '4px 8px',
    fontSize: '0.875rem',
  },
}))


function MenuBar({ editor }) {
  const theme = useTheme()
  const [linkAnchor, setLinkAnchor] = useState(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [imageAnchor, setImageAnchor] = useState(null)
  const [imageUrl, setImageUrl] = useState('')

  if (!editor) return null

  const handleHeadingChange = (event) => {
    const value = event.target.value
    if (value === 'paragraph') {
      editor.chain().focus().setParagraph().run()
    } else {
      editor.chain().focus().toggleHeading({ level: parseInt(value) }).run()
    }
  }

  const getCurrentHeading = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive('heading', { level: i })) return String(i)
    }
    return 'paragraph'
  }

  const handleLinkOpen = (event) => {
    const previousUrl = editor.getAttributes('link').href || ''
    setLinkUrl(previousUrl)
    setLinkAnchor(event.currentTarget)
  }

  const handleLinkClose = () => {
    setLinkAnchor(null)
    setLinkUrl('')
  }

  const handleLinkSubmit = () => {
    if (linkUrl) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    }
    handleLinkClose()
  }

  const handleImageOpen = (event) => {
    setImageAnchor(event.currentTarget)
  }

  const handleImageClose = () => {
    setImageAnchor(null)
    setImageUrl('')
  }

  const handleImageSubmit = () => {
    if (imageUrl) {
      editor.chain().focus().setImage({ src: imageUrl }).run()
    }
    handleImageClose()
  }

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  return (
    <Toolbar>
      {/* Undo/Redo */}
      <Tooltip title="Undo (Ctrl+Z)">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Redo (Ctrl+Y)">
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      <ToolbarDivider orientation="vertical" />

      {/* Heading Selector */}
      <HeadingSelect size="small" variant="outlined">
        <Select
          value={getCurrentHeading()}
          onChange={handleHeadingChange}
          displayEmpty
        >
          <MenuItem value="paragraph">Paragraph</MenuItem>
          <MenuItem value="1">Heading 1</MenuItem>
          <MenuItem value="2">Heading 2</MenuItem>
          <MenuItem value="3">Heading 3</MenuItem>
          <MenuItem value="4">Heading 4</MenuItem>
        </Select>
      </HeadingSelect>

      <ToolbarDivider orientation="vertical" />

      {/* Text Formatting */}
      <Tooltip title="Bold (Ctrl+B)">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'active' : ''}
        >
          <FormatBold fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Italic (Ctrl+I)">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'active' : ''}
        >
          <FormatItalic fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Underline (Ctrl+U)">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={editor.isActive('underline') ? 'active' : ''}
        >
          <FormatUnderlined fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Strikethrough">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'active' : ''}
        >
          <FormatStrikethrough fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Highlight">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className={editor.isActive('highlight') ? 'active' : ''}
        >
          <HighlightIcon fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Code">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={editor.isActive('code') ? 'active' : ''}
        >
          <Code fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      <ToolbarDivider orientation="vertical" />

      {/* Text Alignment */}
      <Tooltip title="Align Left">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={editor.isActive({ textAlign: 'left' }) ? 'active' : ''}
        >
          <FormatAlignLeft fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Align Center">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={editor.isActive({ textAlign: 'center' }) ? 'active' : ''}
        >
          <FormatAlignCenter fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Align Right">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={editor.isActive({ textAlign: 'right' }) ? 'active' : ''}
        >
          <FormatAlignRight fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Justify">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          className={editor.isActive({ textAlign: 'justify' }) ? 'active' : ''}
        >
          <FormatAlignJustify fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      <ToolbarDivider orientation="vertical" />

      {/* Lists */}
      <Tooltip title="Bullet List">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'active' : ''}
        >
          <FormatListBulleted fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Numbered List">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'active' : ''}
        >
          <FormatListNumbered fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Task List">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={editor.isActive('taskList') ? 'active' : ''}
        >
          <CheckBox fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      <ToolbarDivider orientation="vertical" />

      {/* Block Elements */}
      <Tooltip title="Quote">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive('blockquote') ? 'active' : ''}
        >
          <FormatQuote fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Horizontal Rule">
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <HorizontalRule fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Insert Table">
        <ToolbarButton onClick={addTable}>
          <TableChart fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      <ToolbarDivider orientation="vertical" />

      {/* Links & Images */}
      <Tooltip title="Insert Link">
        <ToolbarButton
          onClick={handleLinkOpen}
          className={editor.isActive('link') ? 'active' : ''}
        >
          <LinkIcon fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      <Tooltip title="Insert Image">
        <ToolbarButton onClick={handleImageOpen}>
          <ImageIcon fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      <ToolbarDivider orientation="vertical" />

      {/* Clear Formatting */}
      <Tooltip title="Clear Formatting">
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        >
          <FormatClear fontSize="small" />
        </ToolbarButton>
      </Tooltip>

      {/* Link Popover */}
      <Popover
        open={Boolean(linkAnchor)}
        anchorEl={linkAnchor}
        onClose={handleLinkClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            placeholder="Enter URL"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLinkSubmit()}
          />
          <Button variant="contained" size="small" onClick={handleLinkSubmit}>
            {linkUrl ? 'Update' : 'Remove'}
          </Button>
        </Box>
      </Popover>

      {/* Image Popover */}
      <Popover
        open={Boolean(imageAnchor)}
        anchorEl={imageAnchor}
        onClose={handleImageClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            placeholder="Enter image URL"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImageSubmit()}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleImageSubmit}
            disabled={!imageUrl}
          >
            Insert
          </Button>
        </Box>
      </Popover>
    </Toolbar>
  )
}


function TipTapEditor({
  content,
  onUpdate,
  onSelectionChange,
  placeholder = 'Start writing your document...',
  editable = true,
}) {
  const isInternalUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
      Highlight.configure({
        multicolor: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      isInternalUpdate.current = true
      onUpdate?.(editor.getJSON())
      isInternalUpdate.current = false
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection
      const selectedText = editor.state.doc.textBetween(from, to, ' ')
      onSelectionChange?.(selectedText)
    },
  })

  // Update content when it changes externally
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false
      return
    }
    if (editor && content && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editable, editor])

  return (
    <EditorContainer>
      <MenuBar editor={editor} />
      <EditorWrapper>
        <EditorContent editor={editor} />
      </EditorWrapper>
    </EditorContainer>
  )
}

// Export editor hook for external access
function useTipTapEditor() {
  return useEditor
}

// TrackChangesPanel

/**
 * Track Changes Panel
 * Version history sidebar with diff view and restore functionality.
 */

// Styled components PanelContainer, PanelHeader, PanelContent, ActionButton defined above (shared)

const VersionCard = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'isSelected',
})(({ theme, isSelected }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(1.5),
  cursor: 'pointer',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  border: `1px solid ${isSelected ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: isSelected ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50]) : 'transparent',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  },
}))

const DiffAddition = styled('span')(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
  color: theme.palette.text.primary,
  padding: '0 2px',
  borderRadius: 1,  // Figma spec: 8px
}))

const DiffDeletion = styled('span')(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[100],
  color: theme.palette.text.secondary,
  textDecoration: 'line-through',
  padding: '0 2px',
  borderRadius: 1,  // Figma spec: 8px
}))


function TrackChangesPanel({
  versions = [],
  loading = false,
  selectedVersion = null,
  onSelectVersion,
  onRestoreVersion,
  onCompareVersions,
  onClose,
}) {
  const theme = useTheme()
  const [compareMode, setCompareMode] = useState(false)
  const [compareVersions, setCompareVersions] = useState([])

  const handleVersionClick = useCallback((version) => {
    if (compareMode) {
      // In compare mode, select up to 2 versions
      if (compareVersions.includes(version.id)) {
        setCompareVersions(compareVersions.filter((v) => v !== version.id))
      } else if (compareVersions.length < 2) {
        setCompareVersions([...compareVersions, version.id])
      }
    } else {
      onSelectVersion?.(version)
    }
  }, [compareMode, compareVersions, onSelectVersion])

  const handleCompare = useCallback(() => {
    if (compareVersions.length === 2) {
      onCompareVersions?.(compareVersions[0], compareVersions[1])
    }
  }, [compareVersions, onCompareVersions])

  const handleRestore = useCallback((version, e) => {
    e.stopPropagation()
    onRestoreVersion?.(version)
  }, [onRestoreVersion])

  const toggleCompareMode = useCallback(() => {
    setCompareMode(!compareMode)
    setCompareVersions([])
  }, [compareMode])

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <PanelContainer>
      <PanelHeader>
        <Stack direction="row" alignItems="center" spacing={1}>
          <HistoryIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Version History
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={compareMode ? 'Exit compare mode' : 'Compare versions'}>
            <IconButton
              size="small"
              onClick={toggleCompareMode}
              data-testid="version-compare-toggle"
              aria-label="Compare versions"
              sx={{
                color: compareMode ? (theme.palette.mode === 'dark' ? neutral[300] : neutral[900]) : 'text.secondary',
                bgcolor: compareMode ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]) : 'transparent',
              }}
            >
              <CompareIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} data-testid="version-panel-close" aria-label="Close version history">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </PanelHeader>

      {compareMode && (
        <Box sx={{ p: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Select 2 versions to compare
          </Typography>
          <ActionButton
            variant="contained"
            size="small"
            disabled={compareVersions.length !== 2}
            onClick={handleCompare}
            fullWidth
            data-testid="version-compare-button"
          >
            Compare Selected ({compareVersions.length}/2)
          </ActionButton>
        </Box>
      )}

      <PanelContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : versions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <HistoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              No version history yet
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Changes will be tracked as you edit
            </Typography>
          </Box>
        ) : (
          versions.map((version, index) => (
            <VersionCard
              key={version.id}
              elevation={0}
              isSelected={
                compareMode
                  ? compareVersions.includes(version.id)
                  : selectedVersion?.id === version.id
              }
              onClick={() => handleVersionClick(version)}
              data-testid={`version-card-${version.id}`}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Chip
                    label={`v${version.version}`}
                    size="small"
                    sx={{
                      borderRadius: 1,
                      fontWeight: 600,
                      fontSize: '12px',
                      bgcolor: index === 0 ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900]) : (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100]),
                      color: index === 0 ? 'common.white' : 'text.secondary',
                    }}
                  />
                  {index === 0 && (
                    <Chip
                      label="Current"
                      size="small"
                      variant="outlined"
                      sx={{ borderRadius: 1, fontSize: '10px' }}
                    />
                  )}
                </Stack>
                {!compareMode && index !== 0 && (
                  <Tooltip title="Restore this version">
                    <IconButton
                      size="small"
                      onClick={(e) => handleRestore(version, e)}
                      data-testid={`version-restore-${version.id}`}
                      aria-label={`Restore version ${version.version}`}
                      sx={{ color: 'text.secondary' }}
                    >
                      <RestoreIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {formatDate(version.created_at)}
              </Typography>

              {version.author_name && (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <PersonIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.disabled">
                    {version.author_name}
                  </Typography>
                </Stack>
              )}

              {version.changes_summary && (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 1,
                    color: 'text.secondary',
                    fontStyle: 'italic',
                  }}
                >
                  {version.changes_summary}
                </Typography>
              )}
            </VersionCard>
          ))
        )}
      </PanelContent>
    </PanelContainer>
  )
}

// === From: DocumentEditorPageContainer.jsx ===
/**
 * Document Editor Page Container
 * Rich text editor with TipTap, collaboration, comments, and AI writing features.
 */


const DocToolbar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
  backdropFilter: 'blur(10px)',
  gap: theme.spacing(2),
}))

const EditorArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
}))

const EditorPane = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(3),
  backgroundColor: theme.palette.background.default,
}))

const DocumentsList = styled(Box)(({ theme }) => ({
  width: 300,
  borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.5),
  display: 'flex',
  flexDirection: 'column',
}))

const DocumentsHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}))

const DocumentsContent = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(1),
}))

const DocumentItem = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'isActive',
})(({ theme, isActive }) => ({
  padding: theme.spacing(1.5),
  marginBottom: theme.spacing(1),
  cursor: 'pointer',
  border: `1px solid ${isActive ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : 'transparent'}`,
  backgroundColor: isActive ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50]) : 'transparent',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    borderColor: alpha(theme.palette.divider, 0.3),
  },
}))

const DocActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '14px',
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

const AIResultCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  marginTop: theme.spacing(2),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  borderRadius: 8,  // Figma spec: 8px
}))


export default function DocumentEditorPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const { templates } = useSharedData()

  // Cross-page: accept content from other features (Agents, Synthesis, Summary)
  useIncomingTransfer(FeatureKey.DOCUMENTS, {
    [TransferAction.CREATE_FROM]: async (payload) => {
      const doc = await createDocument({
        title: payload.title || 'Imported Document',
        content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content),
      })
      if (doc) getDocument(doc.id)
    },
  })

  const {
    documents,
    currentDocument,
    versions,
    comments,
    loading,
    saving,
    error,
    aiResult,
    fetchDocuments,
    createDocument,
    getDocument,
    updateDocument,
    deleteDocument,
    fetchVersions,
    restoreVersion,
    fetchComments,
    addComment,
    resolveComment,
    replyToComment,
    deleteComment,
    checkGrammar,
    summarize,
    rewrite,
    expand,
    translate,
    adjustTone,
    clearAiResult,
    reset,
  } = useDocumentStore()

  // UI State
  const [showDocList, setShowDocList] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [editorContent, setEditorContent] = useState(null)
  const [aiMenuAnchor, setAiMenuAnchor] = useState(null)
  const [selectedText, setSelectedText] = useState('')
  const [showVersions, setShowVersions] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [highlightedCommentId, setHighlightedCommentId] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [docToDelete, setDocToDelete] = useState(null)

  // AI Tool Settings
  const [translateDialogOpen, setTranslateDialogOpen] = useState(false)
  const [toneDialogOpen, setToneDialogOpen] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState('Spanish')
  const [selectedTone, setSelectedTone] = useState('professional')

  // Auto-save
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  // Language and tone options
  const LANGUAGE_OPTIONS = [
    { value: 'Spanish', label: 'Spanish' },
    { value: 'French', label: 'French' },
    { value: 'German', label: 'German' },
    { value: 'Italian', label: 'Italian' },
    { value: 'Portuguese', label: 'Portuguese' },
    { value: 'Chinese', label: 'Chinese (Simplified)' },
    { value: 'Japanese', label: 'Japanese' },
    { value: 'Korean', label: 'Korean' },
    { value: 'Arabic', label: 'Arabic' },
    { value: 'Hindi', label: 'Hindi' },
  ]

  const TONE_OPTIONS = [
    { value: 'professional', label: 'Professional', description: 'Formal and business-appropriate' },
    { value: 'casual', label: 'Casual', description: 'Friendly and conversational' },
    { value: 'formal', label: 'Formal', description: 'Very formal and official' },
    { value: 'simplified', label: 'Simplified', description: 'Easy to understand, plain language' },
    { value: 'persuasive', label: 'Persuasive', description: 'Compelling and convincing' },
    { value: 'empathetic', label: 'Empathetic', description: 'Warm and understanding' },
  ]

  // Initialize
  useEffect(() => {
    fetchDocuments()
    return () => reset()
  }, [fetchDocuments, reset])

  // Load document content
  useEffect(() => {
    if (currentDocument?.content) {
      setEditorContent(currentDocument.content)
      setHasUnsavedChanges(false)
    }
  }, [currentDocument])

  // Auto-save effect
  useEffect(() => {
    if (!autoSaveEnabled || !currentDocument || !hasUnsavedChanges || saving) return

    const autoSaveTimer = setTimeout(async () => {
      try {
        await updateDocument(currentDocument.id, { content: editorContent })
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
      } catch (err) {
        console.error('Auto-save failed:', err)
      }
    }, 2000) // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(autoSaveTimer)
  }, [autoSaveEnabled, currentDocument, editorContent, hasUnsavedChanges, saving, updateDocument])

  // ==========================================================================
  // UX Governance helpers
  // ==========================================================================

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'documents', ...intent },
      action,
    })
  }, [execute])

  // ==========================================================================
  // Document handlers
  // ==========================================================================

  const handleOpenCreateDialog = useCallback(() => {
    return executeUI('Open create document', () => setCreateDialogOpen(true))
  }, [executeUI])

  const handleCloseCreateDialog = useCallback(() => {
    return executeUI('Close create document', () => {
      setCreateDialogOpen(false)
      setNewDocName('')
      setSelectedTemplateId('')
    })
  }, [executeUI])

  const handleCreateDocument = useCallback(async () => {
    if (!newDocName.trim()) return
    return execute({
      type: InteractionType.CREATE,
      label: 'Create document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      successMessage: 'Document created',
      intent: { source: 'documents', name: newDocName },
      action: async () => {
        const doc = await createDocument({
          name: newDocName.trim(),
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
          },
        })
        if (doc) {
          setCreateDialogOpen(false)
          setNewDocName('')
          setSelectedTemplateId('')
          await getDocument(doc.id)
        }
        return doc
      },
    })
  }, [createDocument, execute, getDocument, newDocName])

  const handleSelectDocument = useCallback((docId) => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Open document',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { source: 'documents', documentId: docId },
      action: async () => {
        await getDocument(docId)
        setShowVersions(false)
        setShowComments(false)
      },
    })
  }, [execute, getDocument])

  const handleDeleteDocument = useCallback(async () => {
    if (!docToDelete) return
    return execute({
      type: InteractionType.DELETE,
      label: `Delete document "${docToDelete.name}"`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      successMessage: 'Document deleted',
      intent: { source: 'documents', documentId: docToDelete.id },
      action: async () => {
        await deleteDocument(docToDelete.id)
        setDeleteConfirmOpen(false)
        setDocToDelete(null)
      },
    })
  }, [deleteDocument, docToDelete, execute])

  const handleSave = useCallback(async () => {
    if (!currentDocument || !editorContent) return
    return execute({
      type: InteractionType.UPDATE,
      label: 'Save document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      successMessage: 'Document saved',
      intent: { source: 'documents', documentId: currentDocument.id },
      action: async () => {
        await updateDocument(currentDocument.id, { content: editorContent })
      },
    })
  }, [currentDocument, editorContent, execute, updateDocument])

  const handleEditorUpdate = useCallback((content) => {
    setEditorContent(content)
    setHasUnsavedChanges(true)
  }, [])

  const handleSelectionChange = useCallback((text) => {
    setSelectedText(text)
  }, [])

  // ==========================================================================
  // Version handlers
  // ==========================================================================

  const handleToggleVersions = useCallback(() => {
    if (!currentDocument) return
    return executeUI('Toggle version history', () => {
      const next = !showVersions
      setShowVersions(next)
      setShowComments(false)
      if (next) fetchVersions(currentDocument.id)
    })
  }, [currentDocument, executeUI, fetchVersions, showVersions])

  const handleSelectVersion = useCallback((version) => {
    setSelectedVersion(version)
  }, [])

  const handleRestoreVersion = useCallback(async (version) => {
    if (!currentDocument || !restoreVersion) return
    return execute({
      type: InteractionType.UPDATE,
      label: `Restore version ${version.version}`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      successMessage: `Restored to version ${version.version}`,
      intent: { source: 'documents', documentId: currentDocument.id, version: version.version },
      action: async () => {
        await restoreVersion(currentDocument.id, version.id)
        await getDocument(currentDocument.id)
      },
    })
  }, [currentDocument, execute, getDocument, restoreVersion])

  // ==========================================================================
  // Comment handlers
  // ==========================================================================

  const handleToggleComments = useCallback(() => {
    if (!currentDocument) return
    return executeUI('Toggle comments', () => {
      const next = !showComments
      setShowComments(next)
      setShowVersions(false)
      if (next) fetchComments(currentDocument.id)
    })
  }, [currentDocument, executeUI, fetchComments, showComments])

  const handleAddComment = useCallback(async ({ text, quoted_text }) => {
    if (!currentDocument || !addComment) return
    return execute({
      type: InteractionType.CREATE,
      label: 'Add comment',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Comment added',
      intent: { source: 'documents', documentId: currentDocument.id },
      action: async () => {
        await addComment(currentDocument.id, { text, quoted_text })
        setSelectedText('')
      },
    })
  }, [addComment, currentDocument, execute])

  const handleResolveComment = useCallback(async (commentId) => {
    if (!currentDocument || !resolveComment) return
    return execute({
      type: InteractionType.UPDATE,
      label: 'Resolve comment',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Comment resolved',
      intent: { source: 'documents', documentId: currentDocument.id, commentId },
      action: async () => {
        await resolveComment(currentDocument.id, commentId)
      },
    })
  }, [currentDocument, execute, resolveComment])

  const handleReplyComment = useCallback(async (commentId, text) => {
    if (!currentDocument || !replyToComment) return
    return execute({
      type: InteractionType.CREATE,
      label: 'Reply to comment',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Reply added',
      intent: { source: 'documents', documentId: currentDocument.id, commentId },
      action: async () => {
        await replyToComment(currentDocument.id, commentId, { text })
      },
    })
  }, [currentDocument, execute, replyToComment])

  const handleDeleteComment = useCallback(async (commentId) => {
    if (!currentDocument || !deleteComment) return
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete comment',
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      successMessage: 'Comment deleted',
      intent: { source: 'documents', documentId: currentDocument.id, commentId },
      action: async () => {
        await deleteComment(currentDocument.id, commentId)
      },
    })
  }, [currentDocument, deleteComment, execute])

  const handleHighlightComment = useCallback((comment) => {
    setHighlightedCommentId(comment?.id || null)
  }, [])

  // ==========================================================================
  // AI handlers
  // ==========================================================================

  const handleOpenAiMenu = useCallback((event) => {
    const anchor = event.currentTarget
    return executeUI('Open AI tools', () => setAiMenuAnchor(anchor))
  }, [executeUI])

  const handleCloseAiMenu = useCallback(() => {
    return executeUI('Close AI tools', () => setAiMenuAnchor(null))
  }, [executeUI])

  const handleAIAction = useCallback(async (action) => {
    setAiMenuAnchor(null)
    const text = selectedText || ''
    if (!text || !currentDocument) {
      toast.show('Select some text to use AI tools', 'warning')
      return
    }

    // For translate and tone, show a dialog to select options first
    if (action === 'translate') {
      setTranslateDialogOpen(true)
      return
    }
    if (action === 'tone') {
      setToneDialogOpen(true)
      return
    }

    const actionLabels = {
      grammar: 'Check grammar',
      summarize: 'Summarize text',
      rewrite: 'Rewrite text',
      expand: 'Expand text',
    }

    return execute({
      type: InteractionType.ANALYZE,
      label: actionLabels[action] || 'Run AI action',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'documents', action, documentId: currentDocument.id },
      action: async () => {
        setAiLoading(true)
        try {
          switch (action) {
            case 'grammar':
              if (checkGrammar) await checkGrammar(currentDocument.id, text)
              break
            case 'summarize':
              if (summarize) await summarize(currentDocument.id, text)
              break
            case 'rewrite':
              if (rewrite) await rewrite(currentDocument.id, text)
              break
            case 'expand':
              if (expand) await expand(currentDocument.id, text)
              break
          }
          toast.show(`${actionLabels[action]} complete`, 'success')
        } finally {
          setAiLoading(false)
        }
      },
    })
  }, [checkGrammar, currentDocument, execute, expand, rewrite, selectedText, summarize, toast])

  const handleTranslate = useCallback(async () => {
    const text = selectedText || ''
    if (!text || !currentDocument) return

    setTranslateDialogOpen(false)

    return execute({
      type: InteractionType.ANALYZE,
      label: `Translate to ${selectedLanguage}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'documents', action: 'translate', documentId: currentDocument.id, language: selectedLanguage },
      action: async () => {
        setAiLoading(true)
        try {
          if (translate) await translate(currentDocument.id, text, selectedLanguage)
          toast.show(`Translated to ${selectedLanguage}`, 'success')
        } finally {
          setAiLoading(false)
        }
      },
    })
  }, [currentDocument, execute, selectedLanguage, selectedText, toast, translate])

  const handleAdjustTone = useCallback(async () => {
    const text = selectedText || ''
    if (!text || !currentDocument) return

    setToneDialogOpen(false)

    const toneLabel = TONE_OPTIONS.find(t => t.value === selectedTone)?.label || selectedTone

    return execute({
      type: InteractionType.ANALYZE,
      label: `Adjust tone to ${toneLabel}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'documents', action: 'tone', documentId: currentDocument.id, tone: selectedTone },
      action: async () => {
        setAiLoading(true)
        try {
          if (adjustTone) await adjustTone(currentDocument.id, text, selectedTone)
          toast.show(`Tone adjusted to ${toneLabel}`, 'success')
        } finally {
          setAiLoading(false)
        }
      },
    })
  }, [adjustTone, currentDocument, execute, selectedText, selectedTone, toast])

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <PageContainer>
      {/* Toolbar */}
      <DocToolbar>
        <Stack direction="row" alignItems="center" spacing={2}>
          <IconButton
            size="small"
            onClick={() => setShowDocList(!showDocList)}
            data-testid="toggle-doc-list"
            aria-label="Toggle documents list"
            sx={{ color: showDocList ? 'text.primary' : 'text.secondary' }}
          >
            <OpenIcon />
          </IconButton>
          <DocIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {currentDocument?.name || 'Documents'}
          </Typography>
          {currentDocument && (
            <>
              <Chip
                size="small"
                label={`v${currentDocument.version || 1}`}
                sx={{ borderRadius: 1 }}
              />
              {saving && (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                    Saving...
                  </Typography>
                </Stack>
              )}
            </>
          )}
        </Stack>

        <Stack direction="row" spacing={1}>
          {currentDocument ? (
            <>
              <DocActionButton
                variant="outlined"
                size="small"
                startIcon={<HistoryIcon />}
                onClick={handleToggleVersions}
                data-testid="doc-history-button"
                sx={{
                  bgcolor: showVersions ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100]) : 'transparent',
                }}
              >
                History
              </DocActionButton>
              <DocActionButton
                variant="outlined"
                size="small"
                startIcon={<CommentIcon />}
                onClick={handleToggleComments}
                data-testid="doc-comments-button"
                sx={{
                  bgcolor: showComments ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100]) : 'transparent',
                }}
              >
                Comments {comments.length > 0 && `(${comments.length})`}
              </DocActionButton>
              <DocActionButton
                variant="outlined"
                size="small"
                startIcon={aiLoading ? <CircularProgress size={16} /> : <AIIcon />}
                onClick={handleOpenAiMenu}
                disabled={aiLoading}
                data-testid="doc-ai-tools-button"
              >
                AI Tools
              </DocActionButton>
              <DocActionButton
                variant="contained"
                size="small"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={saving}
                data-testid="doc-save-button"
              >
                Save
              </DocActionButton>
            </>
          ) : (
            <>
              <ImportFromMenu
                currentFeature={FeatureKey.DOCUMENTS}
                onImport={async (output) => {
                  const doc = await createDocument({
                    title: output.title || 'Imported',
                    content: typeof output.data === 'string' ? output.data : JSON.stringify(output.data),
                  })
                  if (doc) getDocument(doc.id)
                }}
                size="small"
              />
              <DocActionButton
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleOpenCreateDialog}
                data-testid="doc-new-button"
              >
                New Document
              </DocActionButton>
            </>
          )}
        </Stack>
      </DocToolbar>

      {/* Editor Area */}
      <EditorArea>
        {/* Documents List Sidebar */}
        {showDocList && (
          <DocumentsList>
            <DocumentsHeader>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Documents
              </Typography>
              <Tooltip title="New Document">
                <IconButton size="small" onClick={handleOpenCreateDialog} data-testid="doc-sidebar-new-button" aria-label="New Document">
                  <NewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </DocumentsHeader>
            <DocumentsContent>
              {loading && documents.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : documents.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No documents yet
                  </Typography>
                </Box>
              ) : (
                documents.map((doc) => (
                  <DocumentItem
                    key={doc.id}
                    elevation={0}
                    isActive={currentDocument?.id === doc.id}
                    onClick={() => handleSelectDocument(doc.id)}
                    data-testid={`doc-item-${doc.id}`}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <DocIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {doc.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(doc.updated_at).toLocaleDateString()}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDocToDelete(doc)
                          setDeleteConfirmOpen(true)
                        }}
                        data-testid={`doc-delete-${doc.id}`}
                        aria-label={`Delete ${doc.name}`}
                        sx={{ opacity: 0, transition: 'opacity 0.15s ease', '.MuiPaper-root:hover &': { opacity: 0.5 }, '&:hover': { opacity: '1 !important' } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </DocumentItem>
                ))
              )}
            </DocumentsContent>
          </DocumentsList>
        )}

        {/* Main Editor */}
        {currentDocument ? (
          <EditorPane>
            <TipTapEditor
              content={editorContent}
              onUpdate={handleEditorUpdate}
              onSelectionChange={handleSelectionChange}
              placeholder="Start writing your document..."
            />

            {/* AI Result */}
            {aiResult && (
              <AIResultCard elevation={0}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <AIIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      AI Result
                    </Typography>
                  </Stack>
                  <IconButton size="small" onClick={() => clearAiResult && clearAiResult()}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {aiResult.result_text}
                </Typography>
                {aiResult.suggestions?.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Suggestions:
                    </Typography>
                    {aiResult.suggestions.map((s, i) => (
                      <Typography key={i} variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                        • {s}
                      </Typography>
                    ))}
                  </Box>
                )}
                <Stack direction="row" spacing={1} mt={2}>
                  <DocActionButton
                    size="small"
                    variant="outlined"
                    startIcon={<CopyIcon />}
                    onClick={() => {
                      navigator.clipboard.writeText(aiResult.result_text)
                        .then(() => toast.show('Copied to clipboard', 'success'))
                        .catch(() => toast.show('Failed to copy to clipboard', 'error'))
                    }}
                  >
                    Copy
                  </DocActionButton>
                </Stack>
              </AIResultCard>
            )}
          </EditorPane>
        ) : (
          <EmptyState>
            <DocIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
              No Document Selected
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Create a new document or select one from the list.
            </Typography>
            <DocActionButton
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateDialog}
            >
              Create Document
            </DocActionButton>
          </EmptyState>
        )}

        {/* Sidebars */}
        {showVersions && currentDocument && (
          <TrackChangesPanel
            versions={versions}
            loading={loading}
            selectedVersion={selectedVersion}
            onSelectVersion={handleSelectVersion}
            onRestoreVersion={handleRestoreVersion}
            onClose={() => setShowVersions(false)}
          />
        )}

        {showComments && currentDocument && (
          <CommentsPanel
            comments={comments}
            loading={loading}
            highlightedCommentId={highlightedCommentId}
            selectedText={selectedText}
            onAddComment={handleAddComment}
            onResolveComment={handleResolveComment}
            onReplyComment={handleReplyComment}
            onDeleteComment={handleDeleteComment}
            onHighlightComment={handleHighlightComment}
            onClose={() => setShowComments(false)}
          />
        )}
      </EditorArea>

      {/* AI Tools Menu */}
      <Menu
        anchorEl={aiMenuAnchor}
        open={Boolean(aiMenuAnchor)}
        onClose={handleCloseAiMenu}
        PaperProps={{
          sx: {
            borderRadius: 1,  // Figma spec: 8px
            minWidth: 200,
          },
        }}
      >
        <MenuItem onClick={() => handleAIAction('grammar')} data-testid="ai-grammar">
          <ListItemIcon><GrammarIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Check Grammar</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('summarize')} data-testid="ai-summarize">
          <ListItemIcon><SummarizeIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Summarize</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('rewrite')} data-testid="ai-rewrite">
          <ListItemIcon><RewriteIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Rewrite</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('expand')} data-testid="ai-expand">
          <ListItemIcon><ExpandIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Expand</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('translate')} data-testid="ai-translate">
          <ListItemIcon><TranslateIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Translate</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('tone')} data-testid="ai-tone">
          <ListItemIcon><ToneIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Adjust Tone</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create Document Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 1 } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Create New Document</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Document Name"
            value={newDocName}
            onChange={(e) => setNewDocName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateDocument()}
            sx={{ mt: 2 }}
          />
          <TemplateSelector
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            label="From Template (Optional)"
            size="small"
            showAll
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCloseCreateDialog} data-testid="doc-create-cancel">Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateDocument}
            disabled={!newDocName.trim() || loading}
            data-testid="doc-create-submit"
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 1 } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Delete Document</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{docToDelete?.name}"? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} data-testid="doc-delete-cancel">Cancel</Button>
          <Button
            variant="contained"
            sx={{ color: 'text.secondary' }}
            onClick={handleDeleteDocument}
            data-testid="doc-delete-confirm"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Translate Dialog */}
      <Dialog
        open={translateDialogOpen}
        onClose={() => setTranslateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 1 } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Translate Text</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the language you want to translate the selected text into.
          </Typography>
          <TextField
            select
            fullWidth
            label="Target Language"
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setTranslateDialogOpen(false)} data-testid="translate-cancel">Cancel</Button>
          <Button
            variant="contained"
            onClick={handleTranslate}
            startIcon={<TranslateIcon />}
            data-testid="translate-submit"
          >
            Translate
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tone Dialog */}
      <Dialog
        open={toneDialogOpen}
        onClose={() => setToneDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 1 } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Adjust Tone</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the tone you want to apply to the selected text.
          </Typography>
          <TextField
            select
            fullWidth
            label="Tone"
            value={selectedTone}
            onChange={(e) => setSelectedTone(e.target.value)}
          >
            {TONE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                <Box>
                  <Typography variant="body2">{option.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.description}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setToneDialogOpen(false)} data-testid="tone-cancel">Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAdjustTone}
            startIcon={<ToneIcon />}
            data-testid="tone-submit"
          >
            Apply Tone
          </Button>
        </DialogActions>
      </Dialog>

      {/* Error Alert */}
      {error && (
        <Alert
          severity="error"
          onClose={() => reset()}
          sx={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 400, borderRadius: 1 }}
        >
          {error}
        </Alert>
      )}

      {/* Auto-save indicator */}
      {autoSaveEnabled && lastSaved && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            position: 'fixed',
            bottom: 16,
            left: 16,
            opacity: 0.7,
          }}
        >
          Auto-saved {lastSaved.toLocaleTimeString()}
        </Typography>
      )}
    </PageContainer>
  )
}
