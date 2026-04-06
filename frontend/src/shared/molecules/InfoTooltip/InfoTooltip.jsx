import { neutral } from '@/app/theme'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { cloneElement, isValidElement } from 'react'

export const InfoTooltip = ({
  content,
  children = null,
  placement = 'bottom-start',
  maxWidth = 480,
  enterDelay = 200,
  enterTouchDelay = 0,
  leaveTouchDelay = 4000,
  ariaLabel = 'Show additional information',
  iconColor = 'info',
  iconProps = {},
  tooltipSx = [],
  disableInteractive = false,
  ...tooltipProps
}) => {
  if (content == null) {
    return null
  }

  const resolvedContent =
    typeof content === 'string' ? (
      <Typography variant="body2" component="div">
        {content}
      </Typography>
    ) : (
      content
    )

  const { sx: iconSx = [], ...iconRest } = iconProps
  const iconSxArray = Array.isArray(iconSx) ? iconSx.filter(Boolean) : [iconSx].filter(Boolean)

  const baseTrigger = isValidElement(children)
    ? cloneElement(children, {
        'aria-label': children.props['aria-label'] ?? ariaLabel,
        tabIndex: children.props.tabIndex ?? 0,
      })
    : (
      <IconButton
        size="small"
        color={iconColor}
        aria-label={ariaLabel}
        sx={[
          {
            fontSize: 18,
            width: 28,
            height: 28,
            p: 0.25,
            borderRadius: '50%',
          },
          ...iconSxArray,
        ]}
        {...iconRest}
      >
        <InfoOutlinedIcon fontSize="inherit" />
      </IconButton>
    )

  const tooltipStyles = Array.isArray(tooltipSx) ? tooltipSx : [tooltipSx]

  return (
    <Tooltip
      arrow
      placement={placement}
      enterDelay={enterDelay}
      enterTouchDelay={enterTouchDelay}
      leaveTouchDelay={leaveTouchDelay}
      disableInteractive={disableInteractive}
      slotProps={{
        tooltip: {
          sx: [
            (theme) => ({
              maxWidth,
              typography: 'body2',
              lineHeight: 1.6,
              px: 2,
              py: 1.5,
              color: theme.palette.mode === 'dark' ? neutral[50] : neutral[900],
              backgroundColor: theme.palette.mode === 'dark'
                ? alpha(neutral[900], 0.9)
                : alpha(theme.palette.background.paper, 0.98),
              boxShadow: theme.shadows[6],
              borderRadius: 1,
              border: `1px solid ${alpha(theme.palette.text.secondary, 0.35)}`,
            }),
            ...tooltipStyles,
          ],
        },
        popper: {
          modifiers: [
            {
              name: 'offset',
              options: { offset: [0, 12] },
            },
            {
              name: 'preventOverflow',
              options: { padding: 16 },
            },
            {
              name: 'flip',
              options: {
                fallbackPlacements: ['top-start', 'top', 'right', 'left'],
              },
            },
          ],
        },
      }}
      title={<Box sx={{ maxWidth }}>{resolvedContent}</Box>}
      {...tooltipProps}
    >
      {baseTrigger}
    </Tooltip>
  )
}
