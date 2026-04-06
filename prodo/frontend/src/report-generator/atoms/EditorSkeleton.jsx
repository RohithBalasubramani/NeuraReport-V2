import { Box, Skeleton, Stack } from '@mui/material'
import Grid from '@mui/material/Grid2'

export function EditorSkeleton({ mode = 'manual' }) {
  return (
    <Grid container spacing={2.5} sx={{ alignItems: 'stretch' }}>
      <Grid size={{ xs: 12, md: mode === 'chat' ? 5 : 6 }} sx={{ minWidth: 0 }}>
        <Stack spacing={1.5} sx={{ height: '100%' }}>
          <Skeleton variant="text" width={80} height={28} />
          <Box
            sx={{
              borderRadius: 1.5, border: '1px solid', borderColor: 'divider',
              bgcolor: 'background.paper', p: 1.5,
              minHeight: mode === 'chat' ? 400 : 200,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Skeleton variant="rectangular" width="80%" height={mode === 'chat' ? 350 : 180} sx={{ borderRadius: 1 }} />
          </Box>
          <Skeleton variant="text" width={150} height={20} />
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: mode === 'chat' ? 7 : 6 }} sx={{ minWidth: 0 }}>
        {mode === 'chat' ? (
          <Box
            sx={{
              height: 600, borderRadius: 1, border: '1px solid', borderColor: 'divider',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="text" width={180} height={28} />
              <Skeleton variant="text" width={250} height={18} />
            </Box>
            <Box sx={{ flex: 1, p: 2 }}>
              <Stack spacing={2}>
                {[1, 2, 3].map((i) => (
                  <Stack key={i} direction="row" spacing={1.5}>
                    <Skeleton variant="circular" width={32} height={32} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width={80} height={18} />
                      <Skeleton variant="rectangular" width="80%" height={60} sx={{ borderRadius: 1, mt: 0.5 }} />
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 1 }} />
            </Box>
          </Box>
        ) : (
          <Stack spacing={1.5} sx={{ height: '100%' }}>
            <Skeleton variant="text" width={150} height={28} />
            <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 1 }} />
            <Stack direction="row" spacing={1.5}>
              <Skeleton variant="rectangular" width={100} height={36} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" width={130} height={36} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" width={90} height={36} sx={{ borderRadius: 1 }} />
            </Stack>
            <Skeleton variant="text" width={350} height={18} />
            <Box>
              <Skeleton variant="text" width={80} height={24} />
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="text" width={`${90 - i * 10}%`} height={18} />
                ))}
              </Stack>
            </Box>
          </Stack>
        )}
      </Grid>
    </Grid>
  )
}
