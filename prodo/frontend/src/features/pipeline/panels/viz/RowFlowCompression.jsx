/**
 * RowFlowCompression — Data filtering/grouping funnel visualization.
 *
 * References:
 *   - Recharts FunnelChart: interactive funnel with tooltips
 *   - Stripe Payment Funnel: stacked shrinking bars with staggered animation
 *   - Framer Motion orchestration: stagger children delays
 *
 * Covers: V7 (row flow compression with staggered shrinking bars + funnel)
 *         D4 (row explosion/collapse indicator with click popover)
 *
 * Two views: stacked bars (always) + Recharts funnel (expanded).
 * Click bar → popover showing stage detail (count, delta, retained %).
 */
import React, { useState, useEffect } from 'react'
import { Box, Popover, Stack, Tooltip, Typography } from '@mui/material'
import { FunnelChart, Funnel, Cell, LabelList, Tooltip as RTooltip, ResponsiveContainer } from 'recharts'
import { motion } from 'motion/react'

const STAGE_COLORS = ['#1976d2', '#2e7d32', '#ed6c02', '#7b1fa2', '#c62828']

// ── Funnel tooltip ──
function FunnelTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.75, boxShadow: 2 }}>
      <Typography variant="caption" fontWeight={600}>{d.name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        {d.value.toLocaleString()} row{d.value !== 1 ? 's' : ''}
      </Typography>
    </Box>
  )
}

// ── Funnel label ──
function FunnelLabel({ x, y, width, height, value, name }) {
  if (!width || width < 40) return null
  return (
    <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle"
      fontSize={10} fontWeight={600} fill="#fff">
      {value?.toLocaleString()} {name?.toLowerCase()}
    </text>
  )
}

// ── Stacked Bars with stagger animation + click popover ──
function StackedBars({ stages }) {
  const maxVal = stages[0]?.value || 1
  const [ready, setReady] = useState(false)
  const [anchorEl, setAnchorEl] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const handleBarClick = (e, stage, i) => {
    const prevValue = i > 0 ? stages[i - 1].value : stage.value
    const delta = stage.value - prevValue
    const retained = prevValue > 0 ? Math.round((stage.value / prevValue) * 100) : 100
    setAnchorEl(e.currentTarget)
    setDetail({ ...stage, index: i, delta, retained })
  }

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, py: 1 }}>
        {stages.map((stage, i) => {
          const pct = Math.max((stage.value / maxVal) * 100, 12)
          const color = STAGE_COLORS[i % STAGE_COLORS.length]

          return (
            <Tooltip key={i} title={`${stage.name}: ${stage.value.toLocaleString()} rows`} arrow>
              <motion.div
                initial={{ width: '100%', opacity: 0.3 }}
                animate={ready ? { width: `${pct}%`, opacity: 0.85 } : {}}
                transition={{ duration: 0.7, delay: i * 0.25, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ opacity: 1, scale: 1.01 }}
                onClick={(e) => handleBarClick(e, stage, i)}
                style={{
                  height: 26,
                  backgroundColor: color,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  minWidth: 40,
                  position: 'relative',
                }}
              >
                <Typography variant="caption" sx={{ color: '#fff', fontWeight: 600, fontSize: '0.62rem', whiteSpace: 'nowrap' }}>
                  {stage.name} ({stage.value.toLocaleString()})
                </Typography>
                {/* Connector arrow between bars */}
                {i < stages.length - 1 && (
                  <Box sx={{
                    position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
                    width: 0, height: 0,
                    borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                    borderTop: `4px solid ${color}`,
                  }} />
                )}
              </motion.div>
            </Tooltip>
          )
        })}
      </Box>

      {/* Stage detail popover */}
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => { setAnchorEl(null); setDetail(null) }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { mt: 0.5 } } }}
      >
        {detail && (
          <Box sx={{ p: 1.5, minWidth: 180 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{detail.name}</Typography>
            <Stack spacing={0.25}>
              <Typography variant="caption">
                {detail.value.toLocaleString()} row{detail.value !== 1 ? 's' : ''}
              </Typography>
              {detail.index > 0 && (
                <>
                  <Typography variant="caption" color={detail.delta <= 0 ? 'error.main' : 'success.main'}>
                    {detail.delta > 0 ? '+' : ''}{detail.delta.toLocaleString()} from previous
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {detail.retained}% retained
                  </Typography>
                </>
              )}
            </Stack>
          </Box>
        )}
      </Popover>
    </>
  )
}

// ── Main Component ──
export default function RowFlowCompression({ counts }) {
  if (!counts) return null

  const stages = [
    { name: 'Source', value: counts.source || 0 },
    { name: 'Filtered', value: counts.filtered || 0 },
    { name: 'Grouped', value: counts.grouped || 0 },
    { name: 'Final', value: counts.final || 0 },
  ].filter(s => s.value > 0)

  if (stages.length < 2) return null

  const funnelData = stages.map((s, i) => ({
    ...s,
    fill: STAGE_COLORS[i % STAGE_COLORS.length],
  }))

  // Compression ratio
  const ratio = stages.length >= 2
    ? Math.round((stages[stages.length - 1].value / stages[0].value) * 100)
    : 100

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          Row processing flow
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          {ratio}% retained
        </Typography>
      </Box>

      {/* Stacked bars */}
      <Box sx={{ px: 2 }}>
        <StackedBars stages={stages} />
      </Box>

      {/* Recharts funnel */}
      <Box sx={{ px: 1, pb: 1, width: '100%', height: 100 }}>
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <RTooltip content={<FunnelTooltip />} />
            <Funnel dataKey="value" data={funnelData} isAnimationActive animationDuration={800}>
              <LabelList position="center" content={<FunnelLabel />} />
              {funnelData.map((s, i) => (
                <Cell key={i} fill={s.fill} stroke={s.fill} />
              ))}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  )
}
