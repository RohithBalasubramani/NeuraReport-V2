/**
 * ValidationPanel — gate checklist + failure localization + 1-click fixes.
 * Primary: see what failed and fix it.
 * Severity: error (blocks), warning (allows), info (passive).
 */
import React from 'react'
import {
  Box, Button, Chip, List, ListItem, ListItemIcon, ListItemText,
  Paper, Typography, Stack, Tooltip,
} from '@mui/material'
import {
  CheckCircle as PassIcon,
  Cancel as FailIcon,
  Warning as WarnIcon,
  Info as InfoIcon,
  Refresh as RevalidateIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'

const SEVERITY_CONFIG = {
  error:   { Icon: FailIcon, color: 'error.main', chipColor: 'error' },
  warning: { Icon: WarnIcon, color: 'warning.main', chipColor: 'warning' },
  info:    { Icon: InfoIcon, color: 'info.main', chipColor: 'info' },
}

export default function ValidationPanel({ onAction }) {
  const validation = usePipelineStore(s => s.pipelineState.data.validation)
  const errors = usePipelineStore(s => s.pipelineState.errors)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)

  const passed = validation?.result === 'pass'
  const issues = errors.length > 0 ? errors : (validation?.issues || [])

  // Group by severity
  const errorIssues = issues.filter(i => i.severity === 'error')
  const warnIssues = issues.filter(i => i.severity === 'warning')
  const infoIssues = issues.filter(i => i.severity === 'info')

  if (!validation?.result && !issues.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">Validation runs after mapping approval.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Validation {passed ? 'Passed' : 'Failed'}
        </Typography>
        {passed ? (
          <Chip icon={<PassIcon />} label="All checks passed" size="small" color="success" />
        ) : (
          <Stack direction="row" spacing={0.5}>
            {errorIssues.length > 0 && <Chip label={`${errorIssues.length} errors`} size="small" color="error" />}
            {warnIssues.length > 0 && <Chip label={`${warnIssues.length} warnings`} size="small" color="warning" />}
          </Stack>
        )}
      </Box>

      {/* Issues list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <List dense>
          {[...errorIssues, ...warnIssues, ...infoIssues].map((issue, i) => {
            const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info
            const Icon = config.Icon

            return (
              <ListItem key={i} sx={{ alignItems: 'flex-start' }}>
                <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>
                  <Icon sx={{ fontSize: 20, color: config.color }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {issue.token_name && (
                        <Chip
                          label={`{${issue.token_name}}`}
                          size="small"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                            height: 20,
                            borderLeft: 3,
                            borderColor: getTokenColor(issue.token_signature || issue.token_name),
                          }}
                        />
                      )}
                      <Typography variant="body2">{issue.message}</Typography>
                    </Box>
                  }
                  secondary={
                    issue.fix_candidates?.length > 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">Candidates:</Typography>
                        {issue.fix_candidates.slice(0, 3).map(c => (
                          <Chip
                            key={c}
                            label={c}
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem', cursor: 'pointer' }}
                            onClick={() => onAction?.({
                              type: 'fix_mapping',
                              token: issue.token_name,
                              column: c,
                            })}
                          />
                        ))}
                      </Stack>
                    )
                  }
                />
              </ListItem>
            )
          })}
        </List>
      </Box>

      {/* Actions */}
      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<RevalidateIcon />}
          onClick={() => onAction?.({ type: 'revalidate' })}
        >
          Re-validate
        </Button>
      </Box>
    </Box>
  )
}
