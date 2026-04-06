/**
 * report-generator domain barrel.
 *
 * Default export  = TemplateEditor (the main page component)
 * Named exports   = TemplateChatEditor, getShortcutDisplay, hooks, atoms, molecules
 */

// Organisms (page-level containers)
export { default } from './organisms/GeneratorShell'
export { TemplateChatEditor, getShortcutDisplay } from './organisms/GeneratorShell'

// Hooks
export { useEditorDraft } from './hooks/useEditorDraft'
export { useEditorKeyboardShortcuts, EDITOR_SHORTCUTS } from './hooks/useEditorKeyboardShortcuts'
export { useSavedCharts } from './hooks/useSavedCharts'

// Atoms
export { AutoSaveIndicator } from './atoms/AutoSaveIndicator'
export { ChatMessage } from './atoms/ChatMessage'
export { DraftRecoveryBanner } from './atoms/DraftRecoveryBanner'
export { EditorSkeleton } from './atoms/EditorSkeleton'
export { FollowUpQuestions } from './atoms/FollowUpQuestions'
export { ShortcutKey, ShortcutDisplay } from './atoms/ShortcutKey'

// Molecules
export { KeyboardShortcutsPanel } from './molecules/KeyboardShortcutsPanel'
export { ProposedChangesPanel } from './molecules/ProposedChangesPanel'
export { SavedChartsPanel } from './molecules/SavedChartsPanel'
