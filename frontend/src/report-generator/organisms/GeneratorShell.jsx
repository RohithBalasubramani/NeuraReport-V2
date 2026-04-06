/**
 * GeneratorShell — the main TemplateEditor page container.
 * This is the default export from the report-generator domain.
 * It re-exports the full Generate.jsx default export so the lazy
 * import chain in App.jsx / Pages.jsx continues to work while the
 * monolith is incrementally hollowed out.
 *
 * NOTE: The original Generate.jsx remains the source-of-truth for
 * runtime code. This organism serves as the barrel target so that
 * `import('@/report-generator')` resolves correctly. As each
 * sub-component is wired into the original file via re-imports,
 * this shell will shrink to a thin wrapper.
 */
export { default } from '@/features/Generate.jsx'
export { TemplateChatEditor } from '@/features/Generate.jsx'
export { getShortcutDisplay } from '@/features/Generate.jsx'
