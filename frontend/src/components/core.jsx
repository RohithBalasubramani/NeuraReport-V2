// components/core.jsx -- HYBRID BRIDGE
// Extracted components re-exported from shared/ hierarchy.
// Non-extracted components remain inline below.

// === Re-exports from shared/ ===
export { ErrorBoundary } from '@/shared/organisms/ErrorBoundary'
export { ToastProvider, useToast } from '@/shared/organisms/ToastProvider'
export { LoadingState, Skeleton, ContentSkeleton } from '@/shared/molecules/LoadingState'
export { EmptyState } from '@/shared/molecules/EmptyState'
export { PageHeader } from '@/shared/molecules/PageHeader'
export { SectionHeader } from '@/shared/molecules/SectionHeader'
export { InfoTooltip } from '@/shared/molecules/InfoTooltip'
export { ConnectionSelector } from '@/shared/molecules/ConnectionSelector'
export { TemplateSelector } from '@/shared/molecules/TemplateSelector'
export { SendToMenu } from '@/shared/molecules/SendToMenu'
export { ImportFromMenu } from '@/shared/molecules/ImportFromMenu'
export { Surface } from '@/shared/atoms/Surface'

// === Non-extracted components (remain inline) ===

import * as Sentry from '@sentry/react'
import { useNetworkStatus } from '../hooks/hooks'
import { DEFAULT_PAGE_DIMENSIONS } from '../utils/helpers'
import { neutral, palette, secondary } from '@/app/theme'
import { useCrossPageActions } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { shimmer, slideDown, spin } from '@/styles/styles'
import { FEATURE_ACTIONS, FEATURE_LABELS, TransferAction } from '@/utils/helpers'
import {
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  SignalWifiOff as OfflineIcon,
  WifiTethering as OnlineIcon,
} from '@mui/icons-material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import HomeIcon from '@mui/icons-material/Home'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { Alert, Box, Breadcrumbs, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Fade, FormControl, IconButton, InputLabel, LinearProgress, Link, ListItemIcon, ListItemText, Menu, MenuItem, Select, Snackbar, Stack, Tooltip, Typography, alpha, keyframes, styled, useTheme } from '@mui/material'
import Paper from '@mui/material/Paper'
import React, { Component, cloneElement, createContext, forwardRef, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '@/api/client'
import { useInteraction, InteractionType, Reversibility } from '@/components/governance'

// === From: OfflineBanner.jsx ===

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
`


const BannerBase = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: theme.spacing(2),
  padding: theme.spacing(1, 3),
  animation: `${slideDown} 0.3s ease-out`,
  position: 'relative',
  overflow: 'hidden',
}))

const OfflineBannerContainer = styled(BannerBase)(({ theme }) => ({
  background: theme.palette.mode === 'dark'
    ? `linear-gradient(135deg, ${neutral[700]}, ${neutral[900]})`
    : `linear-gradient(135deg, ${neutral[500]}, ${neutral[700]})`,
  color: theme.palette.common.white,
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: `linear-gradient(
      90deg,
      transparent 0%,
      ${alpha(theme.palette.common.white, 0.1)} 50%,
      transparent 100%
    )`,
    backgroundSize: '200% 100%',
    animation: `${shimmer} 3s infinite linear`,
    pointerEvents: 'none',
  },
}))

const ReconnectedBannerContainer = styled(BannerBase)(({ theme }) => ({
  background: theme.palette.mode === 'dark'
    ? `linear-gradient(135deg, ${neutral[500]}, ${neutral[700]})`
    : `linear-gradient(135deg, ${neutral[700]}, ${neutral[900]})`,
  color: theme.palette.common.white,
  justifyContent: 'center',
}))

const OBIconContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  backgroundColor: alpha(theme.palette.common.white, 0.2),
  flexShrink: 0,
}))

const PulsingIcon = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  animation: `${pulse} 2s infinite ease-in-out`,
}))

const StatusText = styled(Typography)(() => ({
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
}))

const DescriptionText = styled(Typography)(() => ({
  fontSize: '0.75rem',
  opacity: 0.9,
}))

const RetryButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 600,
  fontSize: '0.75rem',
  padding: theme.spacing(0.5, 2),
  minWidth: 90,
  borderColor: alpha(theme.palette.common.white, 0.4),
  color: theme.palette.common.white,
  backdropFilter: 'blur(4px)',
  backgroundColor: alpha(theme.palette.common.white, 0.1),
  transition: 'all 0.2s ease',
  '&:hover': {
    borderColor: theme.palette.common.white,
    backgroundColor: alpha(theme.palette.common.white, 0.2),
    transform: 'translateY(-1px)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
  '&:disabled': {
    borderColor: alpha(theme.palette.common.white, 0.2),
    color: alpha(theme.palette.common.white, 0.7),
  },
}))

const SpinningLoader = styled(CircularProgress)(() => ({
  color: 'inherit',
}))


export function OfflineBanner() {
  const theme = useTheme()
  const { isOnline, checkConnectivity } = useNetworkStatus()
  const [isRetrying, setIsRetrying] = useState(false)
  const [showReconnected, setShowReconnected] = useState(false)
  const wasOfflineRef = useRef(false)
  const reconnectTimeoutRef = useRef(null)

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true
    } else if (wasOfflineRef.current) {
      setShowReconnected(true)
      clearReconnectTimer()
      reconnectTimeoutRef.current = setTimeout(() => setShowReconnected(false), 3000)
      wasOfflineRef.current = false
    }
    return () => clearReconnectTimer()
  }, [isOnline, clearReconnectTimer])

  const handleRetry = useCallback(async () => {
    setIsRetrying(true)
    try {
      const online = await checkConnectivity()
      if (online) {
        setShowReconnected(true)
        clearReconnectTimer()
        reconnectTimeoutRef.current = setTimeout(() => setShowReconnected(false), 3000)
      }
    } finally {
      setIsRetrying(false)
    }
  }, [checkConnectivity, clearReconnectTimer])

  if (showReconnected && isOnline) {
    return (
      <Collapse in={showReconnected}>
        <ReconnectedBannerContainer>
          <PulsingIcon>
            <OBIconContainer>
              <CheckCircleIcon sx={{ fontSize: 16 }} />
            </OBIconContainer>
          </PulsingIcon>
          <StatusText sx={{ ml: 1 }}>Connection restored</StatusText>
        </ReconnectedBannerContainer>
      </Collapse>
    )
  }

  if (isOnline) return null

  return (
    <Collapse in={!isOnline}>
      <OfflineBannerContainer>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PulsingIcon>
            <OBIconContainer>
              <OfflineIcon sx={{ fontSize: 16 }} />
            </OBIconContainer>
          </PulsingIcon>
          <Box>
            <StatusText>You&apos;re offline</StatusText>
            <DescriptionText>
              Some features may not work until connection is restored.
            </DescriptionText>
          </Box>
        </Box>
        <RetryButton
          variant="outlined"
          onClick={handleRetry}
          disabled={isRetrying}
          startIcon={
            isRetrying ? (
              <SpinningLoader size={14} />
            ) : (
              <RefreshIcon sx={{ fontSize: 16 }} />
            )
          }
        >
          {isRetrying ? 'Checking...' : 'Retry'}
        </RetryButton>
      </OfflineBannerContainer>
    </Collapse>
  )
}

// === From: HeartbeatBadge.jsx ===

const feedbackPulse = keyframes`
  0% { transform: scale(1); opacity: .8; }
  50% { transform: scale(1.35); opacity: 0; }
  100% { transform: scale(1); opacity: .8; }
`

function HeartbeatBadge({
  status = 'unknown',
  latencyMs,
  label,
  size = 'small',
  withText = true,
  tooltip,
}) {
  const color = useMemo(() => {
    switch (status) {
      case 'testing':
        return 'text.secondary'
      case 'healthy':
        return 'text.secondary'
      case 'unreachable':
        return 'text.secondary'
      default:
        return 'text.disabled'
    }
  }, [status])

  const text = label || (
    status === 'testing' ? 'Pinging...' :
    status === 'healthy' ? (latencyMs != null ? `Healthy (${Math.round(latencyMs)} ms)` : 'Healthy') :
    status === 'unreachable' ? 'Unreachable' : 'Unknown'
  )

  const Dot = (
    <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: 4, bgcolor: color }} />
      {status === 'testing' && (
        <Box sx={{
          position: 'absolute',
          width: 8,
          height: 8,
          borderRadius: 4,
          border: '2px solid',
          borderColor: color,
          animation: `${pulse} 1.2s ease-out infinite`,
        }} />
      )}
    </Box>
  )

  const Content = withText ? (
    <Chip size={size} icon={Dot} label={text} variant="outlined" sx={{ '& .MuiChip-icon': { mr: 0.5 } }} />
  ) : (
    Dot
  )

  return tooltip ? (
    <Tooltip title={tooltip} arrow>{Content}</Tooltip>
  ) : Content
}

// === From: ScaledIframePreview.jsx ===

const MIN_SCALE = 0.01

const getDevicePixelRatio = () =>
  (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1

const parseCssLength = (value) => {
  if (!value || value === 'none' || value === 'auto' || typeof value !== 'string') return null
  const lower = value.toLowerCase()
  const numeric = Number.parseFloat(lower)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  if (lower.endsWith('px')) return numeric
  if (typeof window !== 'undefined') {
    if (lower.endsWith('vh')) {
      return window.innerHeight * (numeric / 100)
    }
    if (lower.endsWith('vw')) {
      return window.innerWidth * (numeric / 100)
    }
  }
  return null
}

const roundScaleForDpr = (scale) => {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  const dpr = getDevicePixelRatio()
  const factor = Math.max(100, Math.round(dpr * 100))
  return Math.max(MIN_SCALE, Math.round(scale * factor) / factor)
}

const parseAspectRatio = (value) => {
  if (value == null) return null

  const fromNumbers = (wRaw, hRaw) => {
    const w = Number(wRaw)
    const h = Number(hRaw)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
    return {
      css: `${w} / ${h}`,
      ratio: w / h,
    }
  }

  if (Array.isArray(value) && value.length === 2) {
    return fromNumbers(value[0], value[1])
  }

  if (typeof value === 'number') {
    return value > 0 ? fromNumbers(value, 1) : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const slashMatch = trimmed.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/)
    if (slashMatch) {
      return fromNumbers(slashMatch[1], slashMatch[2])
    }
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && numeric > 0) {
      return fromNumbers(numeric, 1)
    }
    return {
      css: trimmed,
      ratio: null,
    }
  }

  return null
}

export function ScaledIframePreview({
  src,
  title,
  pageWidth = DEFAULT_PAGE_DIMENSIONS.width,
  pageHeight = DEFAULT_PAGE_DIMENSIONS.height,
  sx,
  loading = 'lazy',
  background = 'white',
  frameAspectRatio = null,
  fit = 'contain',
  contentAlign = 'center',
  pageShadow = false,
  pageBorderColor = alpha(neutral[900], 0.12),
  pageRadius = 0,
  marginGuides = false,
  clampToParentHeight = false,
  pageChrome = true,
}) {
  const containerRef = useRef(null)
  const iframeRef = useRef(null)
  const rafRef = useRef(null)
  const timeoutRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [contentSize, setContentSize] = useState({
    width: pageWidth,
    height: pageHeight,
  })
  const contentSizeRef = useRef(contentSize)
  const aspect = useMemo(() => parseAspectRatio(frameAspectRatio), [frameAspectRatio])
  const marginGuideConfig = useMemo(() => {
    if (!marginGuides) return null
    if (typeof marginGuides === 'object') {
      const inset = Math.max(0, Number(marginGuides.inset ?? marginGuides.offset ?? 36))
      return {
        inset,
        color: marginGuides.color || alpha(secondary.violet[500], 0.28),
      }
    }
    return {
      inset: 36,
      color: alpha(secondary.violet[500], 0.28),
    }
  }, [marginGuides])

  const schedule = useCallback((cb) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      cb()
    })
  }, [])

  const updateScale = useCallback(
    (dims) => {
      const target = dims || contentSizeRef.current
      const container = containerRef.current
      if (!container || !target.width || !target.height) return

      const rect = container.getBoundingClientRect()
      const availableWidth = rect.width || container.clientWidth || target.width
      let availableHeightRaw = rect.height || container.clientHeight || 0
      if (!availableHeightRaw && aspect?.ratio) {
        availableHeightRaw = availableWidth / aspect.ratio
      }
      if (!availableHeightRaw) {
        availableHeightRaw = target.height
      }
      if (clampToParentHeight) {
        let ancestor = container.parentElement
        while (ancestor) {
          const ancestorRect = ancestor.getBoundingClientRect?.()
          const ancestorHeight = ancestorRect?.height || ancestor.clientHeight || 0
          const computedStyle = typeof window !== 'undefined' ? window.getComputedStyle?.(ancestor) : null
          if (computedStyle) {
            const maxHeightPx = parseCssLength(computedStyle.maxHeight)
            if (maxHeightPx) {
              availableHeightRaw = Math.min(availableHeightRaw, maxHeightPx)
            }
            const heightPx = parseCssLength(computedStyle.height)
            if (heightPx) {
              availableHeightRaw = Math.min(availableHeightRaw, heightPx)
            }
          }
          if (ancestorHeight > 0) {
            availableHeightRaw = Math.min(availableHeightRaw, ancestorHeight)
            break
          }
          ancestor = ancestor.parentElement
        }
      }
      const widthRatio = availableWidth / target.width
      const heightRatio = availableHeightRaw > 0 ? availableHeightRaw / target.height : widthRatio
      let rawScale
      if (fit === 'width') {
        rawScale = widthRatio
        if (heightRatio > 0 && heightRatio < rawScale) {
          rawScale = heightRatio
        }
      } else if (fit === 'height') {
        rawScale = heightRatio
      } else {
        rawScale = Math.min(widthRatio, heightRatio)
      }
      if (!Number.isFinite(rawScale) || rawScale <= 0) {
        rawScale = 1
      }
      const nextScale = roundScaleForDpr(rawScale)

      setScale((prev) => (Math.abs(prev - nextScale) < 0.002 ? prev : nextScale))
    },
    [aspect?.ratio, fit, clampToParentHeight],
  )

  const applyContentSize = useCallback(
    (dims) => {
      const safe = {
        width: Math.max(1, Math.ceil(dims?.width || pageWidth)),
        height: Math.max(1, Math.ceil(dims?.height || pageHeight)),
      }
      contentSizeRef.current = safe
      setContentSize(safe)
      schedule(() => updateScale(safe))
    },
    [pageHeight, pageWidth, schedule, updateScale],
  )

  const measureIframeContent = useCallback(() => {
    const fallback = { width: pageWidth, height: pageHeight }
    const iframe = iframeRef.current
    if (!iframe) return fallback

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) return fallback
      const body = doc.body
      const html = doc.documentElement
      if (body) {
        body.style.overflow = 'hidden'
      }
      if (html) {
        html.style.overflow = 'hidden'
      }
      const measuredWidth = Math.max(
        body?.scrollWidth || 0,
        body?.offsetWidth || 0,
        html?.scrollWidth || 0,
        html?.offsetWidth || 0,
        fallback.width,
      )
      const measuredHeight = Math.max(
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        html?.scrollHeight || 0,
        html?.offsetHeight || 0,
        fallback.height,
      )
      return {
        width: Math.ceil(measuredWidth),
        height: Math.ceil(measuredHeight),
      }
    } catch {
      return fallback
    }
  }, [pageHeight, pageWidth])

  const refreshContentSize = useCallback(() => {
    const dims = measureIframeContent()
    applyContentSize(dims)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      const postDims = measureIframeContent()
      applyContentSize(postDims)
    }, 150)
  }, [applyContentSize, measureIframeContent])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return undefined
    const handleLoad = () => refreshContentSize()
    iframe.addEventListener('load', handleLoad)
    return () => {
      iframe.removeEventListener('load', handleLoad)
    }
  }, [refreshContentSize, src])

  useEffect(() => {
    applyContentSize({ width: pageWidth, height: pageHeight })
  }, [applyContentSize, pageHeight, pageWidth, src])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const container = containerRef.current
    if (!container) return undefined
    const observer = new ResizeObserver(() => schedule(() => updateScale()))
    observer.observe(container)
    return () => observer.disconnect()
  }, [schedule, updateScale])

  useEffect(() => {
    const handleWindowResize = () => schedule(() => updateScale())
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [schedule, updateScale])

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  const scaledHeight = contentSize.height * scale
  const scaledWidth = contentSize.width * scale
  const alignTop = contentAlign === 'top'
  const containerStyles = {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    ...sx,
  }
  if (aspect?.css) {
    containerStyles.aspectRatio = aspect.css
    containerStyles.height = 'auto'
  }
  const positioned = Boolean(aspect?.css)
  const resolvedPageRadius = pageChrome && Number.isFinite(Number(pageRadius))
    ? Math.max(Number(pageRadius), 0)
    : 0
  const resolvedPageShadow = pageChrome && pageShadow
    ? (typeof pageShadow === 'string' ? pageShadow : `0 32px 48px ${alpha(neutral[900], 0.18)}`)
    : 'none'
  const resolvedBorderColor = pageChrome && typeof pageBorderColor === 'string' && pageBorderColor.trim()
    ? pageBorderColor
    : null
  const resolvedBackground = pageChrome ? background : 'transparent'
  const marginInset = marginGuideConfig
    ? Math.max(0, Math.min(marginGuideConfig.inset, Math.min(contentSize.width, contentSize.height) / 2))
    : 0

  return (
    <Box ref={containerRef} sx={containerStyles}>
      <Box
        sx={{
          position: positioned ? 'absolute' : 'relative',
          top: positioned ? (alignTop ? 0 : '50%') : 0,
          left: positioned ? '50%' : 0,
          width: contentSize.width,
          height: contentSize.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'auto',
        }}
        style={
          positioned
            ? {
                marginLeft: `${-scaledWidth / 2}px`,
                ...(alignTop ? {} : { marginTop: `${-scaledHeight / 2}px` }),
              }
            : undefined
        }
      >
        <Box
          sx={{
            width: contentSize.width,
            height: contentSize.height,
            borderRadius: resolvedPageRadius,
            overflow: 'hidden',
            bgcolor: resolvedBackground,
            boxShadow: resolvedPageShadow,
            border: resolvedBorderColor ? `1px solid ${resolvedBorderColor}` : 'none',
            position: 'relative',
          }}
        >
          <iframe
            ref={iframeRef}
            src={src}
            title={title}
            loading={loading}
            style={{
              width: contentSize.width,
              height: contentSize.height,
              border: 0,
              display: 'block',
              background: pageChrome ? background : undefined,
            }}
          />
          {marginGuideConfig && marginInset > 0 && (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: marginInset,
                border: '1px dashed',
                borderColor: marginGuideConfig.color,
                borderRadius: Math.max(resolvedPageRadius - 6, 0),
                pointerEvents: 'none',
              }}
              style={{
                borderStyle: 'dashed',
              }}
            />
          )}
        </Box>
      </Box>
      {!positioned && (
        <Box sx={{ width: '100%', height: scaledHeight, visibility: 'hidden', pointerEvents: 'none' }} />
      )}
    </Box>
  )
}

// === From: dialogs.jsx ===

function ConfirmDialog({ open, title = 'Confirm', message, confirmText = 'Confirm', cancelText = 'Cancel', onClose, onConfirm }) {
  return (
    <Dialog open={open} onClose={() => onClose?.()}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.()}>{cancelText}</Button>
        <Button variant="contained" onClick={() => { onConfirm?.(); onClose?.() }}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// === From: SuccessCelebration ===

const favPulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
`

export function SuccessCelebration({ trigger, onComplete }) {
  const [active, setActive] = useState(false)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete })

  useEffect(() => {
    if (!trigger) {
      setActive(false)
      return
    }

    setActive(true)

    const timer = setTimeout(() => {
      setActive(false)
      onCompleteRef.current?.()
    }, 1500)

    return () => clearTimeout(timer)
  }, [trigger])

  if (!active) return null

  return (
    <Box
      sx={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 80,
        height: 80,
        borderRadius: '50%',
        bgcolor: neutral[900],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: `${pulse} 1.5s ease-out forwards`,
        zIndex: 9999,
        pointerEvents: 'none',
        boxShadow: `0 0 40px ${alpha(neutral[900], 0.4)}`,
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 24 24"
        sx={{ width: 40, height: 40, color: 'white' }}
      >
        <path
          fill="currentColor"
          d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
        />
      </Box>
    </Box>
  )
}

export function useCelebration() {
  const [celebrating, setCelebrating] = useState(false)

  const celebrate = useCallback(() => {
    setCelebrating(true)
  }, [])

  const onComplete = useCallback(() => {
    setCelebrating(false)
  }, [])

  return {
    celebrating,
    celebrate,
    onComplete,
  }
}

// === From: FavoriteButton ===

export function FavoriteButton({
  entityType,
  entityId,
  initialFavorite,
  onToggle,
  size = 'small',
}) {
  const theme = useTheme()
  const { execute } = useInteraction()
  const [isFavorite, setIsFavorite] = useState(initialFavorite ?? false)
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState(initialFavorite !== undefined)

  useEffect(() => {
    if (checked || !entityId) return

    let cancelled = false
    api.checkFavorite(entityType, entityId)
      .then((result) => {
        if (!cancelled) {
          setIsFavorite(result.isFavorite)
          setChecked(true)
        }
      })
      .catch(() => {
        if (!cancelled) setChecked(true)
      })

    return () => { cancelled = true }
  }, [entityType, entityId, checked])

  useEffect(() => {
    if (initialFavorite !== undefined) {
      setIsFavorite(initialFavorite)
      setChecked(true)
    }
  }, [initialFavorite])

  const handleToggle = useCallback(async (e) => {
    e.stopPropagation()
    if (loading || !entityId) return

    setLoading(true)
    const nextFavorite = !isFavorite

    setIsFavorite(nextFavorite)

    try {
      await execute({
        type: nextFavorite ? InteractionType.CREATE : InteractionType.DELETE,
        label: nextFavorite ? 'Add favorite' : 'Remove favorite',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        blocksNavigation: false,
        intent: {
          entityType,
          entityId,
          action: nextFavorite ? 'favorite_add' : 'favorite_remove',
        },
        action: async () => {
          try {
            if (nextFavorite) {
              await api.addFavorite(entityType, entityId)
            } else {
              await api.removeFavorite(entityType, entityId)
            }
            onToggle?.(nextFavorite)
          } catch (err) {
            setIsFavorite(!nextFavorite)
            throw err
          }
        },
      })
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId, isFavorite, loading, onToggle, execute])

  const iconSize = size === 'small' ? 18 : 22

  return (
    <Tooltip title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
      <IconButton
        size={size}
        onClick={handleToggle}
        disabled={loading}
        data-testid="favorite-button"
        sx={{
          color: isFavorite ? (theme.palette.mode === 'dark' ? neutral[300] : neutral[900]) : theme.palette.text.secondary,
          transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
          '&:hover': {
            color: theme.palette.mode === 'dark' ? neutral[300] : neutral[900],
            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
            transform: 'scale(1.1)',
          },
        }}
      >
        {loading ? (
          <CircularProgress size={iconSize - 4} sx={{ color: theme.palette.text.secondary }} />
        ) : isFavorite ? (
          <StarIcon sx={{ fontSize: iconSize }} />
        ) : (
          <StarBorderIcon sx={{ fontSize: iconSize }} />
        )}
      </IconButton>
    </Tooltip>
  )
}
