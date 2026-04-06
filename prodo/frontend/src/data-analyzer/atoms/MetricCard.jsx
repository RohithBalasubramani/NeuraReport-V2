import { Box, Card, CardContent, Typography, alpha } from '@mui/material'

export function MetricCard({ metric }) {
  const formatValue = (value, unit) => {
    if (value === null || value === undefined) return 'N/A'
    if (typeof value === 'number') {
      const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      return unit ? `${formatted} ${unit}` : formatted
    }
    return String(value)
  }

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 1,
        transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: 2 },
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 11, letterSpacing: 0.5 }}>
          {metric.name || metric.label || 'Metric'}
        </Typography>
        <Typography variant="h6" fontWeight={600} sx={{ mt: 0.25 }}>
          {formatValue(metric.value ?? metric.raw_value, metric.unit)}
        </Typography>
        {metric.description && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {metric.description}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
