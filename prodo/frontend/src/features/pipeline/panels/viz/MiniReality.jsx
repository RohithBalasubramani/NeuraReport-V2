/**
 * MiniReality — Real data rendered like final report cards.
 *
 * References:
 *   - Stripe Dashboard: compact preview cards mirroring final output
 *   - Notion Gallery: card-per-row with key-value fields
 *   - MUI DataGrid: dense layout with overflow handling
 *
 * Covers: V10 (mini reality snapshot), S6 (live example with 2-3 rows)
 *
 * Shows 2-3 real data rows as report-style cards with:
 * - Auto-animate entrance
 * - Confidence-based opacity per field
 * - Click card → navigate to preview
 * - Hover field → highlight across panels
 */
import React, { useCallback } from 'react'
import { Box, Card, CardContent, Stack, Tooltip, Typography, Chip } from '@mui/material'
import { motion } from 'motion/react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import usePipelineStore from '@/stores/pipeline'

// Confidence → opacity
function confOpacity(conf) {
  if (conf == null) return 1
  if (conf >= 0.8) return 1
  if (conf >= 0.5) return 0.65
  return 0.35
}

// Format value for display
function formatValue(val) {
  if (val == null || val === '') return '—'
  if (typeof val === 'number') return val.toLocaleString()
  return String(val)
}

function ReportCard({ row, index, confidence, onFieldHover, onFieldLeave, onClick }) {
  const entries = Object.entries(row).slice(0, 8) // Max 8 fields per card

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.3 }}
    >
      <Card
        variant="outlined"
        onClick={onClick}
        sx={{
          cursor: 'pointer',
          position: 'relative',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: 'primary.light',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            transform: 'translateY(-1px)',
          },
        }}
      >
        {/* Row number badge */}
        <Chip
          label={`Row ${index + 1}`}
          size="small"
          sx={{
            position: 'absolute',
            top: 6,
            right: 8,
            height: 18,
            fontSize: '0.58rem',
            bgcolor: 'action.hover',
            color: 'text.disabled',
          }}
        />

        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
          {entries.map(([key, value]) => {
            const conf = confidence?.[key]
            return (
              <Tooltip key={key} title={`${key}: ${formatValue(value)}`} arrow placement="left">
                <Box
                  onMouseEnter={() => onFieldHover?.(key)}
                  onMouseLeave={onFieldLeave}
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1,
                    py: 0.3,
                    opacity: confOpacity(conf),
                    borderRadius: 0.5,
                    px: 0.5,
                    mx: -0.5,
                    transition: 'background-color 0.15s',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      minWidth: 80,
                      maxWidth: 100,
                      fontSize: '0.68rem',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {key}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {formatValue(value)}
                  </Typography>
                </Box>
              </Tooltip>
            )
          })}
          {Object.keys(row).length > 8 && (
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem', mt: 0.5, display: 'block' }}>
              +{Object.keys(row).length - 8} more fields
            </Typography>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function MiniReality({ example }) {
  const confidence = usePipelineStore(s => s.pipelineState.data.mapping?.confidence)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const [stackRef] = useAutoAnimate({ duration: 300 })

  const handleFieldHover = useCallback((field) => {
    setHighlightedField(field)
  }, [setHighlightedField])

  const handleFieldLeave = useCallback(() => {
    setHighlightedField(null)
  }, [setHighlightedField])

  const handleCardClick = useCallback(() => {
    setActivePanel('preview')
  }, [setActivePanel])

  if (!example?.rows?.length) return null

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" fontWeight={600}>
          {example.label || "Here's what your report will look like"}
        </Typography>
      </Box>
      <Box sx={{ p: 1.5 }}>
        <Stack ref={stackRef} spacing={1}>
          {example.rows.slice(0, 3).map((row, i) => (
            <ReportCard
              key={i}
              row={row}
              index={i}
              confidence={confidence}
              onFieldHover={handleFieldHover}
              onFieldLeave={handleFieldLeave}
              onClick={handleCardClick}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
