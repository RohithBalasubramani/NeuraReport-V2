/**
 * template-manager domain barrel.
 *
 * Default export = TemplatesPage
 * Named exports  = TemplateChatCreateContainer, UnifiedTemplateCreator, hooks, atoms, molecules
 */

// Organisms (page-level containers)
export { default } from './organisms/TemplateManagerShell'
export { TemplateChatCreateContainer, UnifiedTemplateCreator } from './organisms/TemplateManagerShell'

// Hooks
export { useAgentTrigger } from './hooks/useAgentTrigger'
export { useCanvasMode } from './hooks/useCanvasMode'

// Atoms
export { CanvasCard } from './atoms/CanvasCard'

// Molecules
export { TemplatePreview } from './molecules/TemplatePreview'
