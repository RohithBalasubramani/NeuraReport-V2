/**
 * dashboard-builder domain barrel.
 *
 * Default export = DashboardBuilderPage
 * Named exports  = WidgetRenderer, hooks, atoms, molecules
 */

// Organisms (page-level containers)
export { default } from './organisms/DashboardShell'
export { WidgetRenderer } from './organisms/DashboardShell'

// Hooks
export { useWidgetData } from './hooks/useWidgetData'

// Atoms
export { DataSourceBadge } from './atoms/DataSourceBadge'
export { WidgetCard, WidgetCardStyled } from './atoms/WidgetCard'

// Molecules
export { WidgetRenderer as WidgetRendererMolecule } from './molecules/WidgetRenderer'
