/**
 * Report Generator API service layer.
 * Centralizes all API calls used by the report-generator domain.
 */

export {
  applyChatTemplateEdit,
  chatTemplateEdit,
  createSavedChart,
  deleteSavedChart,
  deleteTemplate as deleteTemplateRequest,
  discoverReports,
  editTemplateAi,
  editTemplateManual,
  exportTemplateZip,
  fetchTemplateKeyOptions,
  getTemplateCatalog,
  getTemplateHtml,
  importTemplateZip,
  isMock,
  listApprovedTemplates,
  listSavedCharts,
  queueRecommendTemplates,
  recommendTemplates,
  runReportAsJob,
  suggestCharts,
  undoTemplateEdit,
  updateSavedChart,
  withBase,
} from '@/api/client'

export * as mock from '@/api/mock'
