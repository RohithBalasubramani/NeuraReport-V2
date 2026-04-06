import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'neura-step-timing:'

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const clamp = (value, min = 0) => (value < min ? min : value)

const MAX_SAMPLES_PER_STAGE = 12
const MAX_RAW_SAMPLES = 60
const MAX_VALID_DURATION_MS = 30 * 60 * 1000
const MIN_VALID_DURATION_MS = 1
const TRIM_RATIO = 0.2
const MIN_CONFIDENT_SAMPLES = 3
const IMPROVEMENT_WEIGHT = 0.9
const REGRESSION_WEIGHT = 0.35
const OUTLIER_CLAMP_MULTIPLIER = 2

const sanitizeDuration = (value) => {
  if (!Number.isFinite(value)) return null
  let sanitized = value
  if (sanitized <= 0) sanitized = MIN_VALID_DURATION_MS
  if (sanitized > MAX_VALID_DURATION_MS) sanitized = MAX_VALID_DURATION_MS
  if (sanitized < MIN_VALID_DURATION_MS) sanitized = MIN_VALID_DURATION_MS
  return sanitized
}

const computeAverageFromSamples = (samples) => {
  if (!Array.isArray(samples) || samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const maxTrim = Math.floor((sorted.length - 1) / 2)
  const trim = Math.min(Math.floor(sorted.length * TRIM_RATIO), maxTrim)
  const start = trim
  const end = sorted.length - trim
  const window = sorted.slice(start, end > start ? end : sorted.length)
  if (!window.length) return null
  if (window.length === 1) return window[0]
  if (window.length === 2) return (window[0] + window[1]) / 2
  if (window.length <= 4) {
    const mid = Math.floor(window.length / 2)
    if (window.length % 2 === 0) {
      return (window[mid - 1] + window[mid]) / 2
    }
    return window[mid]
  }
  const total = window.reduce((sum, value) => sum + value, 0)
  return total / window.length
}

const normalizeHistoryEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return { samples: [], rawSamples: [], avgMs: null, count: 0, lastMs: null }
  }

  const rawSamples = []
  if (Array.isArray(entry.rawSamples)) {
    entry.rawSamples.forEach((value) => {
      const sanitized = sanitizeDuration(value)
      if (sanitized != null) rawSamples.push(sanitized)
    })
  }

  if (!rawSamples.length && Array.isArray(entry.samples)) {
    entry.samples.forEach((value) => {
      const sanitized = sanitizeDuration(value)
      if (sanitized != null) rawSamples.push(sanitized)
    })
  }

  if (!rawSamples.length && typeof entry.lastMs === 'number') {
    const sanitized = sanitizeDuration(entry.lastMs)
    if (sanitized != null) rawSamples.push(sanitized)
  }

  if (!rawSamples.length && typeof entry.avgMs === 'number') {
    const sanitized = sanitizeDuration(entry.avgMs)
    if (sanitized != null) rawSamples.push(sanitized)
  }

  if (!rawSamples.length && typeof entry.totalMs === 'number' && typeof entry.count === 'number' && entry.count > 0) {
    const avg = sanitizeDuration(entry.totalMs / entry.count)
    if (avg != null) rawSamples.push(avg)
  }

  const trimmedRaw = rawSamples.slice(-MAX_RAW_SAMPLES)
  let samples = []
  if (Array.isArray(entry.samples) && entry.samples.length) {
    entry.samples.forEach((value) => {
      const sanitized = sanitizeDuration(value)
      if (sanitized != null) samples.push(sanitized)
    })
  }
  if (!samples.length && trimmedRaw.length) {
    samples = trimmedRaw.slice(-MAX_SAMPLES_PER_STAGE)
  } else if (samples.length > MAX_SAMPLES_PER_STAGE) {
    samples = samples.slice(-MAX_SAMPLES_PER_STAGE)
  }
  if (samples.length >= 2) {
    const latest = samples[samples.length - 1]
    const cap = latest * OUTLIER_CLAMP_MULTIPLIER
    const filtered = []
    samples.forEach((value, idx) => {
      if (idx === samples.length - 1 || value <= cap) filtered.push(value)
    })
    if (!filtered.includes(latest)) filtered.push(latest)
    samples = filtered
  }

  const avgMs = computeAverageFromSamples(samples)
  const lastMs = trimmedRaw.length ? trimmedRaw[trimmedRaw.length - 1] : samples.length ? samples[samples.length - 1] : null
  const count = Math.max(
    Number.isFinite(entry.count) ? entry.count : 0,
    trimmedRaw.length,
    samples.length,
  )

  return {
    samples,
    rawSamples: trimmedRaw,
    avgMs: avgMs ?? null,
    count,
    lastMs,
  }
}

const normalizeHistory = (history) => {
  if (!history || typeof history !== 'object') return {}
  return Object.entries(history).reduce((acc, [stage, entry]) => {
    acc[stage] = normalizeHistoryEntry(entry)
    return acc
  }, {})
}

const getSampleCount = (entry) => {
  if (!entry || typeof entry !== 'object') return 0
  if (Array.isArray(entry.rawSamples)) return entry.rawSamples.length
  if (Array.isArray(entry.samples)) return entry.samples.length
  if (typeof entry.count === 'number') return entry.count
  return 0
}

const resolveStageEstimate = (entry, fallback = null) => {
  let estimate = fallback
  if (entry && typeof entry === 'object') {
    const candidates = []
    if (Array.isArray(entry.samples) && entry.samples.length) {
      candidates.push(entry.samples[entry.samples.length - 1])
    }
    if (Array.isArray(entry.rawSamples) && entry.rawSamples.length) {
      candidates.push(entry.rawSamples[entry.rawSamples.length - 1])
    }
    if (typeof entry.lastMs === 'number') {
      candidates.push(entry.lastMs)
    }
    candidates.forEach((value) => {
      if (!Number.isFinite(value)) return
      estimate = estimate == null ? value : Math.min(estimate, value)
    })
  }
  return estimate
}

const loadFromStorage = (storageKey) => {
  if (typeof window === 'undefined') return { history: {}, order: [] }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { history: {}, order: [] }
    const parsed = JSON.parse(raw)
    return {
      history: normalizeHistory(parsed?.history),
      order: Array.isArray(parsed?.order) ? parsed.order : [],
    }
  } catch {
    return { history: {}, order: [] }
  }
}

const persistToStorage = (storageKey, history, order) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ history, order }))
  } catch {
    /* ignore persistence errors */
  }
}

const averageDuration = (entry) => {
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.avgMs === 'number' && !Number.isNaN(entry.avgMs)) return entry.avgMs
  if (Array.isArray(entry.samples) && entry.samples.length) return computeAverageFromSamples(entry.samples)
  if (Array.isArray(entry.rawSamples) && entry.rawSamples.length) return computeAverageFromSamples(entry.rawSamples)
  if (typeof entry.totalMs === 'number' && typeof entry.count === 'number' && entry.count > 0) {
    return entry.totalMs / entry.count
  }
  return null
}

export const formatDuration = (ms) => {
  if (ms == null || Number.isNaN(ms)) return ''
  const totalSeconds = Math.ceil(clamp(ms, 0) / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const hours = Math.floor(totalSeconds / 3600)
  const parts = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

export default function useStepTimingEstimator(cacheKey) {
  const storageKey = `${STORAGE_PREFIX}${cacheKey}`
  const initialRef = useRef(null)
  if (!initialRef.current) {
    initialRef.current = loadFromStorage(storageKey)
  }
  const [history, setHistory] = useState(initialRef.current.history)
  const historyRef = useRef(history)

  useEffect(() => { historyRef.current = history }, [history])

  const [orderVersion, setOrderVersion] = useState(0)
  const knownOrderRef = useRef(initialRef.current.order.slice())
  const runOrderRef = useRef([])
  const completedSetRef = useRef(new Set())
  const currentStageRef = useRef(null)
  const stageStartRef = useRef(null)
  const [active, setActive] = useState(false)
  const [eta, setEta] = useState({ ms: null, reliable: false })

  const ensureStageInOrder = useCallback((stage) => {
    if (!stage) return
    const knownOrder = knownOrderRef.current
    if (!knownOrder.includes(stage)) {
      knownOrder.push(stage)
      setOrderVersion((v) => v + 1)
    }
  }, [])

  const resetRunState = useCallback(() => {
    runOrderRef.current = []
    completedSetRef.current = new Set()
    currentStageRef.current = null
    stageStartRef.current = null
    setEta({ ms: null, reliable: false })
    setActive(false)
  }, [])

  const startRun = useCallback(() => {
    resetRunState()
  }, [resetRunState])

  const updateHistory = useCallback((stage, durationMs) => {
    if (!stage) return
    const sanitized = sanitizeDuration(durationMs)
    if (sanitized == null) return
    setHistory((prev) => {
      const previous = prev?.[stage]
      const rawSamples = previous?.rawSamples ? previous.rawSamples.slice() : []
      rawSamples.push(sanitized)
      if (rawSamples.length > MAX_RAW_SAMPLES) {
        rawSamples.splice(0, rawSamples.length - MAX_RAW_SAMPLES)
      }
      let samples = rawSamples.slice(-MAX_SAMPLES_PER_STAGE)
      if (samples.length >= 2) {
        const latestIdx = samples.length - 1
        const latest = samples[latestIdx]
        const outlierCap = latest * OUTLIER_CLAMP_MULTIPLIER
        samples = samples.filter((value, idx) => idx === latestIdx || value <= outlierCap)
        if (!samples.includes(latest)) {
          samples.push(latest)
        }
      }
      const trimmedAvg = computeAverageFromSamples(samples) ?? sanitized
      const priorAvg = Number.isFinite(previous?.avgMs) ? previous.avgMs : null
      const baseline = sanitized <= trimmedAvg ? sanitized : trimmedAvg
      const weight = priorAvg == null
        ? 1
        : sanitized <= priorAvg
          ? IMPROVEMENT_WEIGHT
          : REGRESSION_WEIGHT
      const rawAvg = priorAvg == null
        ? baseline
        : sanitized <= priorAvg * 0.5
          ? sanitized
          : (priorAvg * (1 - weight)) + (baseline * weight)
      const avgMs = sanitizeDuration(rawAvg) ?? baseline
      const lastMs = rawSamples.length ? rawSamples[rawSamples.length - 1] : samples.length ? samples[samples.length - 1] : null
      const count = Math.min(rawSamples.length, 1000)
      return {
        ...prev,
        [stage]: {
          samples,
          rawSamples,
          avgMs,
          lastMs,
          count,
        },
      }
    })
  }, [])

  const recomputeEta = useCallback(() => {
    const stage = currentStageRef.current
    if (!stage) {
      setEta({ ms: null, reliable: false })
      return
    }
    const order = knownOrderRef.current.length ? knownOrderRef.current : runOrderRef.current
    const idx = order.indexOf(stage)
    if (idx === -1) {
      setEta({ ms: null, reliable: false })
      return
    }

    let remaining = 0
    let hasKnown = false
    let missing = false
    const averages = historyRef.current

    const elapsed = stageStartRef.current != null ? nowMs() - stageStartRef.current : 0
    const currentEntry = averages?.[stage]
    const currentAvg = averageDuration(currentEntry)
    let currentEstimate = resolveStageEstimate(currentEntry, currentAvg)
    if (currentEstimate != null) {
      currentEstimate = Math.max(currentEstimate, elapsed)
    }
    const currentSamples = getSampleCount(currentEntry)
    if (currentEstimate != null) {
      hasKnown = true
      if (currentSamples < MIN_CONFIDENT_SAMPLES) missing = true
      remaining += clamp(currentEstimate - elapsed, 0)
    } else {
      missing = true
    }

    for (let i = idx + 1; i < order.length; i += 1) {
      const step = order[i]
      if (completedSetRef.current.has(step)) continue
      const entry = averages?.[step]
      const avg = averageDuration(entry)
      const estimate = resolveStageEstimate(entry, avg)
      const sampleCount = getSampleCount(entry)
      if (estimate != null) {
        hasKnown = true
        if (sampleCount < MIN_CONFIDENT_SAMPLES) missing = true
        remaining += estimate
      } else {
        missing = true
      }
    }

    if (!hasKnown) {
      setEta({ ms: null, reliable: false })
      return
    }
    setEta({ ms: remaining, reliable: !missing })
  }, [])

  const noteStage = useCallback((stage) => {
    if (!stage) return
    const now = nowMs()
    const previous = currentStageRef.current
    if (
      previous
      && previous !== stage
      && stageStartRef.current != null
      && !completedSetRef.current.has(previous)
    ) {
      const duration = now - stageStartRef.current
      completedSetRef.current.add(previous)
      updateHistory(previous, duration)
    }
    if (!previous || previous !== stage) {
      currentStageRef.current = stage
      stageStartRef.current = now
      ensureStageInOrder(stage)
      if (!runOrderRef.current.includes(stage)) {
        runOrderRef.current.push(stage)
      }
    }
    setActive(true)
    recomputeEta()
  }, [ensureStageInOrder, recomputeEta, updateHistory])

  const completeStage = useCallback((stage, durationMs) => {
    if (!stage) return
    const now = nowMs()
    const isCurrent = currentStageRef.current === stage
    let duration = durationMs
    if (!Number.isFinite(duration) || duration <= 0) {
      if (isCurrent && stageStartRef.current != null) {
        duration = now - stageStartRef.current
      } else {
        return
      }
    }
    ensureStageInOrder(stage)
    if (!runOrderRef.current.includes(stage)) {
      runOrderRef.current.push(stage)
    }
    completedSetRef.current.add(stage)
    updateHistory(stage, duration)
    if (isCurrent) {
      currentStageRef.current = null
      stageStartRef.current = null
    }
    setActive(true)
    recomputeEta()
  }, [ensureStageInOrder, recomputeEta, updateHistory])

  const finishRun = useCallback(() => {
    const stage = currentStageRef.current
    if (stage && stageStartRef.current != null && !completedSetRef.current.has(stage)) {
      const duration = nowMs() - stageStartRef.current
      updateHistory(stage, duration)
    }
    if (runOrderRef.current.length) {
      const merged = []
      runOrderRef.current.forEach((step) => {
        if (step && !merged.includes(step)) merged.push(step)
      })
      knownOrderRef.current.forEach((step) => {
        if (step && !merged.includes(step)) merged.push(step)
      })
      knownOrderRef.current = merged
      setOrderVersion((v) => v + 1)
    }
    setEta({ ms: 0, reliable: true })
    setActive(false)
    currentStageRef.current = null
    stageStartRef.current = null
    completedSetRef.current = new Set()
    runOrderRef.current = []
  }, [updateHistory])

  useEffect(() => {
    if (!active) return undefined
    const id = window.setInterval(recomputeEta, 500)
    return () => window.clearInterval(id)
  }, [active, recomputeEta])

  useEffect(() => {
    persistToStorage(storageKey, historyRef.current, knownOrderRef.current)
  }, [storageKey, history, orderVersion])

  return {
    eta,
    startRun,
    noteStage,
    completeStage,
    finishRun,
  }
}
