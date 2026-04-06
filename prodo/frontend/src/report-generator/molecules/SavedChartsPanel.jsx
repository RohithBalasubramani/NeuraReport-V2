import { secondary } from '@/app/theme'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import {
  Alert,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
  alpha,
} from '@mui/material'

export function SavedChartsPanel({
  activeTemplate,
  savedCharts,
  savedChartsLoading,
  savedChartsError,
  selectedChartSource,
  selectedSavedChartId,
  onRetry,
  onSelectSavedChart,
  onRenameSavedChart,
  onDeleteSavedChart,
}) {
  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      {savedChartsLoading && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading saved charts...</Typography>
        </Stack>
      )}
      {savedChartsError && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
          {savedChartsError}
        </Alert>
      )}
      {!savedChartsLoading && !savedChartsError && savedCharts.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No saved charts yet. Use &quot;Save this chart&quot; after asking AI to pin a favorite configuration.
        </Typography>
      )}
      {!savedChartsLoading && !savedChartsError && savedCharts.length > 0 && (
        <Stack spacing={1}>
          {savedCharts.map((chart) => {
            const spec = chart.spec || {}
            const isSelected = selectedChartSource === 'saved' && selectedSavedChartId === chart.id
            return (
              <Card
                data-testid={`saved-chart-card-${chart.id}`}
                key={chart.id}
                variant={isSelected ? 'outlined' : 'elevation'}
                sx={{
                  borderColor: isSelected ? 'text.secondary' : 'divider',
                  bgcolor: isSelected ? alpha(secondary.violet[500], 0.04) : 'background.paper',
                }}
              >
                <CardActionArea component="div" onClick={() => onSelectSavedChart(chart.id)}>
                  <CardContent>
                    <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ pr: 1 }}>{chart.name || 'Saved chart'}</Typography>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton size="small" aria-label="Rename saved chart" onClick={(event) => onRenameSavedChart(event, chart)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label="Delete saved chart" onClick={(event) => onDeleteSavedChart(event, chart)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                      <Chip size="small" label={spec.type || 'chart'} variant="outlined" sx={{ textTransform: 'capitalize' }} />
                      {spec.chartTemplateId && <Chip size="small" label={`From template: ${spec.chartTemplateId}`} variant="outlined" />}
                      {!spec.chartTemplateId && <Chip size="small" label="Custom" variant="outlined" />}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
