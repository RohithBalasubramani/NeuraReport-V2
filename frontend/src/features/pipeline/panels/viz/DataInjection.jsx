/**
 * DataInjection (#4) — Mini template with fields filling progressively.
 * Empty placeholders → data fades in field by field → rows populate.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'
import { fadeIn } from '@/styles/styles'
import { confidenceSx } from './useConfidenceStyle'

export default function DataInjection() {
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)

  const [gridRef] = useAutoAnimate({ duration: 200 })
  const tokens = template?.tokens || []
  const samples = mapping?.token_samples || mapping?.candidates || {}
  const confidence = mapping?.confidence || {}

  // Progressive reveal: track which fields are "filled"
  const [filledCount, setFilledCount] = useState(0)

  useEffect(() => {
    if (tokens.length === 0) return
    setFilledCount(0)
    let i = 0
    const interval = setInterval(() => {
      i++
      setFilledCount(i)
      if (i >= tokens.length) clearInterval(interval)
    }, 200)
    return () => clearInterval(interval)
  }, [tokens.length])

  if (tokens.length === 0 || Object.keys(mapping?.mapping || {}).length === 0) return null

  // Get sample value for a token
  const getSample = (token) => {
    // token_samples might be { token: "sample_value" } or { token: ["val1", "val2"] }
    const s = samples[token]
    if (Array.isArray(s)) return s[0] || ''
    if (typeof s === 'string') return s
    return ''
  }

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" fontWeight={600}>
          Data filling your report
        </Typography>
      </Box>

      <Box sx={{ p: 1.5 }}>
        <Box
          ref={gridRef}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 0.5,
            alignItems: 'center',
          }}
        >
          {tokens.slice(0, 10).map((token, i) => {
            const isFilled = i < filledCount
            const sample = getSample(token)
            const conf = confidence[token]
            const color = getTokenColor(token)

            return (
              <React.Fragment key={token}>
                {/* Label */}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: '0.7rem', pr: 1 }}
                >
                  {humanizeToken(token)}
                </Typography>

                {/* Value box */}
                <Tooltip
                  title={isFilled && sample ? `${humanizeToken(token)}: ${sample}` : 'Waiting...'}
                  arrow
                >
                  <Box
                    onClick={(e) => {
                      e.stopPropagation()
                      setHighlightedField(token)
                    }}
                    sx={{
                      height: 22,
                      borderRadius: 0.5,
                      border: '1px solid',
                      borderColor: isFilled ? `${color}66` : 'divider',
                      bgcolor: isFilled ? `${color}10` : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      px: 1,
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      overflow: 'hidden',
                      '&:hover': {
                        borderColor: color,
                        bgcolor: `${color}20`,
                      },
                      ...confidenceSx(conf),
                    }}
                  >
                    {isFilled && sample ? (
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.7rem',
                          fontWeight: 500,
                          animation: `${fadeIn} 0.3s ease-out`,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sample}
                      </Typography>
                    ) : isFilled ? (
                      <Box
                        sx={{
                          width: '60%',
                          height: 8,
                          borderRadius: 4,
                          bgcolor: 'action.disabled',
                          animation: `${fadeIn} 0.3s ease-out`,
                        }}
                      />
                    ) : (
                      <Box
                        sx={{
                          width: '40%',
                          height: 8,
                          borderRadius: 4,
                          bgcolor: 'action.disabledBackground',
                        }}
                      />
                    )}
                  </Box>
                </Tooltip>
              </React.Fragment>
            )
          })}
        </Box>

        {tokens.length > 10 && (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ mt: 0.5, display: 'block', textAlign: 'center', cursor: 'pointer' }}
            onClick={() => setActivePanel('template')}
          >
            +{tokens.length - 10} more fields
          </Typography>
        )}
      </Box>
    </Box>
  )
}
