/**
 * Submit guard — prevents duplicate form submissions.
 *
 * Usage:
 *   const guard = createSubmitGuard(2000)
 *   async function handleSubmit() {
 *     if (!guard.canSubmit()) return
 *     await api.post(...)
 *   }
 */

export function createSubmitGuard(delayMs = 2000) {
  let lastSubmitTime = 0
  return {
    canSubmit() {
      const now = Date.now()
      if (now - lastSubmitTime < delayMs) return false
      lastSubmitTime = now
      return true
    },
    reset() {
      lastSubmitTime = 0
    },
  }
}
