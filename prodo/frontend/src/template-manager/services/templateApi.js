/**
 * Template Manager API service layer.
 * Centralizes all API calls used by the template-manager domain.
 */
export * as api from '@/api/client'
export * as recommendationsApi from '@/api/intelligence'
export {
  chatTemplateCreate,
  createTemplateFromChat,
  mappingApprove,
  mappingPreview,
  runTemplateAgent,
} from '@/api/client'
