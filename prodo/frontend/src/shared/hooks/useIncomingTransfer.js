import { useToast } from '@/components/core'
import { useCrossPageStore } from '@/stores/workspace'
import { FEATURE_LABELS } from '@/utils/helpers'
import { useEffect, useRef } from 'react'

/**
 * useIncomingTransfer -- Auto-processes incoming cross-page transfers on mount.
 *
 * Usage in a consumer page:
 *
 *   useIncomingTransfer('docqa', {
 *     [TransferAction.CHAT_WITH]: async (payload) => {
 *       const session = await createSession(`Q&A: ${payload.title}`)
 *       await addDocument(session.id, { name: payload.title, content: payload.content })
 *     },
 *   })
 */
export function useIncomingTransfer(featureKey, handlers) {
  const consumeTransfer = useCrossPageStore((s) => s.consumeTransfer)
  const toast = useToast()
  const processedRef = useRef(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (processedRef.current) return
    const transfer = consumeTransfer(featureKey)
    if (!transfer) return
    processedRef.current = true

    const handler = handlersRef.current[transfer.action]
    if (handler) {
      const sourceLabel = FEATURE_LABELS[transfer.source] || transfer.source
      Promise.resolve(handler(transfer.payload, transfer))
        .then(() => toast.show(`Imported from ${sourceLabel}`, 'success'))
        .catch((err) =>
          toast.show(`Import failed: ${err?.message || 'Unknown error'}`, 'error'),
        )
    }
  }, [consumeTransfer, featureKey, toast])
}
