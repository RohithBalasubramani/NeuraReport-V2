/**
 * RowFlowCompression (#7) — Recharts funnel showing data filtering/grouping.
 * 1000 rows -> 120 -> 12 -> Final Report. Interactive funnel visualization.
 */
import React from 'react'
import { Box, Typography } from '@mui/material'
import { FunnelChart, Funnel, Cell, LabelList, Tooltip, ResponsiveContainer } from 'recharts'

const STAGE_COLORS = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0']

function CustomLabel({ x, y, width, height, value, name }) {
  if (!width || width < 40) return null
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={11}
      fontWeight={600}
      fill="#fff"
    >
      {value?.toLocaleString()} {name?.toLowerCase()}
    </text>
  )
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.75, boxShadow: 2 }}>
      <Typography variant="caption" fontWeight={600}>{d.name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        {d.value.toLocaleString()} {d.value === 1 ? 'row' : 'rows'}
      </Typography>
    </Box>
  )
}

export default function RowFlowCompression({ counts, compact = false }) {
  if (!counts) return null

  const stages = [
    { name: 'Source', value: counts.source || 0, fill: STAGE_COLORS[0] },
    { name: 'Filtered', value: counts.filtered || 0, fill: STAGE_COLORS[1] },
    { name: 'Grouped', value: counts.grouped || 0, fill: STAGE_COLORS[2] },
    { name: 'Final', value: counts.final || 0, fill: STAGE_COLORS[3] },
  ].filter((s) => s.value > 0)

  if (stages.length < 2) return null

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
          How your data is processed
        </Typography>
      </Box>

      <Box sx={{ p: 1, width: '100%', height: compact ? 80 : 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip content={<CustomTooltip />} />
            <Funnel
              dataKey="value"
              data={stages}
              isAnimationActive
              animationDuration={800}
              animationEasing="ease-out"
            >
              <LabelList
                position="center"
                content={<CustomLabel />}
              />
              {stages.map((s, i) => (
                <Cell key={i} fill={s.fill} stroke={s.fill} strokeWidth={1} />
              ))}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  )
}
