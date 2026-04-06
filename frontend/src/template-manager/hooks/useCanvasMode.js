import { useTemplateCreatorStore } from '@/stores/content'

/**
 * Hook: determines current canvas mode from store state.
 *
 * Priority-ordered rules -- first match wins.
 * Returns one of: 'extraction' | 'mapping' | 'diff' | 'validation' | 'data_preview' | 'insights'
 */
export function useCanvasMode() {
  const canvasModeOverride = useTemplateCreatorStore((s) => s.canvasModeOverride)
  const validating = useTemplateCreatorStore((s) => s.validating)
  const validationIssues = useTemplateCreatorStore((s) => s.validationIssues)
  const htmlDiff = useTemplateCreatorStore((s) => s.htmlDiff)
  const selectedToken = useTemplateCreatorStore((s) => s.selectedToken)
  const mappingLoading = useTemplateCreatorStore((s) => s.mappingLoading)
  const schemaExt = useTemplateCreatorStore((s) => s.schemaExt)
  const autoMapping = useTemplateCreatorStore((s) => s.autoMapping)
  const userMapping = useTemplateCreatorStore((s) => s.userMapping)
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)
  const dataPreviewRequested = useTemplateCreatorStore((s) => s.dataPreviewRequested)

  if (canvasModeOverride) return canvasModeOverride
  if (validating || validationIssues.length > 0) return 'validation'
  if (htmlDiff) return 'diff'
  if (selectedToken || mappingLoading) return 'mapping'
  if (schemaExt && Object.keys(userMapping).length === 0 && Object.keys(autoMapping).length === 0) {
    return 'mapping'
  }
  if (currentHtml && !schemaExt) return 'extraction'
  if (connectionId && dataPreviewRequested) return 'data_preview'
  return 'insights'
}
