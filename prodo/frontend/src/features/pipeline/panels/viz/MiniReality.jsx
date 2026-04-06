/**
 * MiniReality (#10) — Shows 2-3 real entries rendered like the final report.
 * NOT a raw table. Final-form preview with staggered entrance.
 * Uses @formkit/auto-animate for card entrance animations.
 */
import React from 'react'
import { Box, Card, CardContent, Stack, Typography, Tooltip } from '@mui/material'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import usePipelineStore from '@/stores/pipeline'
import { confidenceSx } from './useConfidenceStyle'

function ReportCard({ row, index, confidence }) {
  const entries = Object.entries(row)

  return (
    <Card
      variant="outlined"
      onClick={() => usePipelineStore.getState().setActivePanel('preview')}
      sx={{
        cursor: 'pointer',
        '&:hover': {
          borderColor: 'primary.light',
          boxShadow: 1,
          transform: 'translateY(-1px)',
        },
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        {entries.map(([key, value]) => {
          const conf = confidence?.[key]
          return (
            <Tooltip key={key} title={`${key}: ${value}`} arrow placement="left">
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1,
                  py: 0.25,
                  ...confidenceSx(conf),
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ minWidth: 80, fontSize: '0.7rem', fontWeight: 500 }}
                >
                  {key}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontSize: '0.8rem', fontWeight: 600 }}
                >
                  {String(value ?? '')}
                </Typography>
              </Box>
            </Tooltip>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default function MiniReality({ example }) {
  const confidence = usePipelineStore((s) => s.pipelineState.data.mapping?.confidence)
  const [stackRef] = useAutoAnimate({ duration: 300 })

  if (!example?.rows?.length) return null

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
        {example.label || "Here's what your report will look like:"}
      </Typography>
      <Stack ref={stackRef} spacing={1}>
        {example.rows.slice(0, 3).map((row, i) => (
          <ReportCard key={i} row={row} index={i} confidence={confidence} />
        ))}
      </Stack>
    </Box>
  )
}
