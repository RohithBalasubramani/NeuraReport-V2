/**
 * DataInjection — Progressive field fill animation.
 *
 * References:
 *   - Typewriter.js: progressive text reveal
 *   - MUI Skeleton: placeholder shimmer → content transition
 *   - Framer Motion stagger: sequential child animations
 *
 * Covers: V4 (real data injection with progressive field fill + fadeIn)
 *
 * Fields appear empty → fill one-by-one with sample data → confidence opacity.
 * Click field → highlight across panels. Click overflow → navigate to template.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'

// Confidence → opacity mapping
function confOpacity(conf) {
  if (conf == null) return 1
  if (conf >= 0.8) return 1
  if (conf >= 0.5) return 0.65
  return 0.35
}

// Get sample value from various store shapes
function getSample(samples, token) {
  const s = samples?.[token]
  if (Array.isArray(s)) return s[0] || ''
  if (typeof s === 'string') return s
  return ''
}

const MAX_VISIBLE = 10

export default function DataInjection() {
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const highlightedField = usePipelineStore(s => s.highlightedField)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)

  const tokens = template?.tokens || []
  const mappingMap = mapping?.mapping || {}
  const samples = mapping?.token_samples || mapping?.candidates || {}
  const confidence = mapping?.confidence || {}

  // Progressive reveal: animate fields filling one-by-one
  const [filledCount, setFilledCount] = useState(0)

  useEffect(() => {
    if (!tokens.length) return
    setFilledCount(0)
    let i = 0
    const timer = setInterval(() => {
      i++
      setFilledCount(i)
      if (i >= Math.min(tokens.length, MAX_VISIBLE)) clearInterval(timer)
    }, 180)
    return () => clearInterval(timer)
  }, [tokens.length])

  const handleFieldClick = useCallback((token) => {
    setHighlightedField(highlightedField === token ? null : token)
  }, [setHighlightedField, highlightedField])

  if (!tokens.length || !Object.keys(mappingMap).length) return null

  const visibleTokens = tokens.slice(0, MAX_VISIBLE)
  const overflow = tokens.length - MAX_VISIBLE

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          Data filling your report
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
          {filledCount}/{visibleTokens.length} fields
        </Typography>
      </Box>

      {/* Field grid */}
      <Box sx={{ p: 1.5 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(80px, auto) 1fr',
            gap: '4px 8px',
            alignItems: 'center',
          }}
        >
          {visibleTokens.map((token, i) => {
            const isFilled = i < filledCount
            const sample = getSample(samples, token)
            const conf = confidence[token]
            const color = getTokenColor(token)
            const isHighlighted = highlightedField === token

            return (
              <React.Fragment key={token}>
                {/* Label */}
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.7rem',
                    color: isHighlighted ? 'primary.main' : 'text.secondary',
                    fontWeight: isHighlighted ? 600 : 400,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'color 0.2s',
                  }}
                >
                  {humanizeToken(token)}
                </Typography>

                {/* Value box */}
                <Tooltip
                  title={isFilled && sample ? `${humanizeToken(token)}: ${sample}` : 'Waiting for data...'}
                  arrow
                  placement="right"
                >
                  <Box
                    onClick={() => handleFieldClick(token)}
                    sx={{
                      height: 24,
                      borderRadius: 0.75,
                      border: '1px solid',
                      borderColor: isHighlighted ? color : isFilled ? `${color}55` : '#e0e0e0',
                      bgcolor: isHighlighted ? `${color}18` : isFilled ? `${color}08` : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      px: 1,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      opacity: confOpacity(conf),
                      overflow: 'hidden',
                      '&:hover': {
                        borderColor: color,
                        bgcolor: `${color}15`,
                      },
                      ...(isHighlighted && {
                        boxShadow: `0 0 8px ${color}33`,
                      }),
                    }}
                  >
                    <AnimatePresence mode="wait">
                      {isFilled && sample ? (
                        <motion.div
                          key="value"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25 }}
                          style={{ overflow: 'hidden', width: '100%' }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: '0.7rem',
                              fontWeight: 500,
                              color: 'text.primary',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: 'block',
                            }}
                          >
                            {sample}
                          </Typography>
                        </motion.div>
                      ) : isFilled ? (
                        <motion.div
                          key="skeleton"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          style={{ width: '60%' }}
                        >
                          <Box
                            sx={{
                              width: '100%',
                              height: 8,
                              borderRadius: 4,
                              bgcolor: '#e0e0e0',
                            }}
                          />
                        </motion.div>
                      ) : (
                        <Box
                          key="empty"
                          sx={{
                            width: '35%',
                            height: 8,
                            borderRadius: 4,
                            bgcolor: '#f0f0f0',
                            animation: 'shimmer 1.5s infinite',
                            '@keyframes shimmer': {
                              '0%': { opacity: 0.3 },
                              '50%': { opacity: 0.6 },
                              '100%': { opacity: 0.3 },
                            },
                          }}
                        />
                      )}
                    </AnimatePresence>
                  </Box>
                </Tooltip>
              </React.Fragment>
            )
          })}
        </Box>

        {/* Overflow link */}
        {overflow > 0 && (
          <Typography
            variant="caption"
            color="primary"
            sx={{
              mt: 1,
              display: 'block',
              textAlign: 'center',
              cursor: 'pointer',
              fontSize: '0.7rem',
              '&:hover': { textDecoration: 'underline' },
            }}
            onClick={() => setActivePanel('template')}
          >
            +{overflow} more fields →
          </Typography>
        )}
      </Box>
    </Box>
  )
}
