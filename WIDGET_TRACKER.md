# Widget Implementation Tracker — 42 Widgets

All 42 widgets from the spec at `Pasted text (5).txt`.
Status: [ ] = done, [ ] = pending

---

## Group 1 — Left Panel Features (Sections 1-10)

| # | Widget | Status | File(s) | Notes |
|---|--------|--------|---------|-------|
| 1a | Rendered report preview | [x] | `tabs/TemplateTab.jsx` | HTML preview with scaling, fullscreen dialog |
| 1b | Section boundaries | [x] | `tabs/TemplateTab.jsx` | Semantic tag detection via density map view mode |
| 1c | Field placeholders highlighted | [x] | `tabs/TemplateTab.jsx` | Token spans with data-token attr, color-coded |
| 1d | Grid/spacing overlay toggle | [x] | `tabs/TemplateTab.jsx` | CSS repeating-linear-gradient grid (C4) |
| 1e | Typography inspector | [x] | `tabs/TemplateTab.jsx` | getComputedStyle on click in typo mode |
| 1f | Click field → source/type/transform | [x] | `tabs/TemplateTab.jsx` | TokenInspector shows source, confidence, type |
| 1g | Toggle raw placeholders vs filled values | [x] | `tabs/TemplateTab.jsx` | displayMode toggle: labels/raw/filled (A7) |
| 2a | Field mapping table | [x] | `tabs/MappingsTab.jsx` | TanStack Table with sorting, filtering, selection |
| 2b | Color-coded confidence | [x] | `tabs/MappingsTab.jsx` | Chips colored by confidence threshold |
| 2c | Dropdown remap + search | [x] | `tabs/MappingsTab.jsx` | MUI Autocomplete with all DB columns |
| 2d | Sample values + column stats | [x] | `tabs/MappingsTab.jsx` | Tippy popover with null%, unique count, distribution |
| 2e | Bulk actions | [x] | `tabs/MappingsTab.jsx` | Set Unresolved, Auto-remap, Accept All |
| 3a | Database explorer (tables, columns) | [x] | `tabs/DataTab.jsx` | Expandable table sections with FK/PK indicators |
| 3b | Query builder | [x] | `tabs/DataTab.jsx` | react-querybuilder with SQL output |
| 3c | Column tagging (ID/Date/Metric) | [x] | `tabs/DataTab.jsx` | ColumnTagSelector chips per column |
| 3d | Preview in report button | [x] | `tabs/DataTab.jsx` | Column click → setActivePanel('preview') (B6) |
| 4a | Contract readable logic blocks | [x] | `tabs/LogicTab.jsx` | RuleCard with plain-language descriptions |
| 4b | Per-rule validation indicator | [x] | `tabs/LogicTab.jsx` | Pass/fail/warn icons on RuleCards (A2) |
| 4c | Transformation pipeline view | [x] | `tabs/LogicTab.jsx` | TransformPipelineView stepper (C3) |
| 5a | Data flow graph | [x] | `tabs/LogicTab.jsx` | Mermaid data flow diagram |
| 5b | Join relationship graph | [x] | `tabs/LogicTab.jsx` | ReactFlow with edge click popover (B1) + 1:N warning (B2) |
| 5c | Field lineage trace | [x] | `tabs/LogicTab.jsx` | react-d3-tree with cross-panel navigation (B3) |
| 6a | Real data preview | [x] | `tabs/PreviewTab.jsx` | DataPreviewTable with pagination |
| 6b | Constraint violations | [x] | `tabs/PreviewTab.jsx` | json-rules-engine + ViolationCards |
| 6c | Constraint rule editor | [x] | `tabs/PreviewTab.jsx` | ConstraintRuleEditor UI (B9) |
| 6d | Sample/batch selector | [x] | `tabs/PreviewTab.jsx` | Enhanced batch selector (B4) |
| 6e | Toggle raw vs formatted | [x] | `tabs/PreviewTab.jsx` | showRaw toggle (B5) |
| 7a | Validation/errors panel | [x] | `tabs/ErrorsTab.jsx` | Sentry-style category grouping |
| 7b | Auto-fix vs manual distinction | [x] | `tabs/ErrorsTab.jsx` | Quick Fix / Manual chips (A3) |
| 7c | Optimization suggestions | [x] | `tabs/ErrorsTab.jsx` | Heuristic suggestions for slow steps (A4) |
| 8a | Version/diff layer | [x] | `tabs/TemplateTab.jsx` | react-diff-viewer side-by-side compare |
| 8b | Output variance check | [x] | `tabs/PreviewTab.jsx` | Diff viewer with trace-to-cause click (C6) |
| 9 | Memory/learned patterns | [x] | `panels/StatusView.jsx` | LearnedPatternsWidget with Accept/Reject (C1) |
| 10 | Quick actions overlay | [x] | `panels/QuickActions.jsx` | react-contexify right-click menu, 6 actions |

## Group 2 — Diagnostic Visualizations (Sections 1-12)

| # | Widget | Status | File(s) | Notes |
|---|--------|--------|---------|-------|
| D1 | Mapping confidence heatmap | [x] | `tabs/TemplateTab.jsx` | d3-scale overlay + click→top 3 candidates popover (A1) |
| D2 | Data quality visualization | [x] | `tabs/DataTab.jsx` | Null% bars, sparklines, outlier markers (B8) |
| D3 | Transformation pipeline view | [x] | `tabs/LogicTab.jsx` | Stepper per field (C3) |
| D4 | Row explosion/collapse indicator | [x] | `viz/RowFlowCompression.jsx` | Stacked bars + funnel + click popover (A5) |
| D5 | Join relationship graph | [x] | `tabs/LogicTab.jsx` | ReactFlow + edge click + 1:N warning (B1, B2) |
| D6 | Temporal consistency view | [x] | `tabs/DataTab.jsx` | Recharts bar chart with gap/spike highlighting (B7) |
| D7 | Field lineage trace | [x] | `tabs/LogicTab.jsx` | react-d3-tree with interactive navigation (B3) |
| D8 | Output variance check | [x] | `tabs/PreviewTab.jsx` | react-diff-viewer + trace click (C6) |
| D9 | Constraint violations | [x] | `tabs/PreviewTab.jsx` | json-rules-engine + rule editor (B9) |
| D10 | Performance/cost view | [x] | `tabs/ErrorsTab.jsx` | Recharts bar chart + optimization suggestions (A4) |
| D11 | Template density map | [x] | `tabs/TemplateTab.jsx` | Grid heatmap overlay (C2) |
| D12 | User action replay | [x] | `tabs/ErrorsTab.jsx` | Timeline slider + revert button (B10) |

## Group 3 — Right Panel Status (Sections 1-9)

| # | Widget | Status | File(s) | Notes |
|---|--------|--------|---------|-------|
| S1 | Current step summary | [x] | `viz/PipelineStrip.jsx` | Animated strip with progress |
| S2 | What was understood (cards) | [x] | `panels/StatusView.jsx` | StatusCard components from statusView.cards |
| S3 | What system did | [x] | `panels/StatusView.jsx` | actions_taken list |
| S4 | Data flow (layman) | [x] | `viz/PipelineStrip.jsx` | Linear blocks: Report→Match→Prepare→Check→Generate |
| S5 | Confidence/certainty | [x] | `viz/useConfidenceStyle.js` | Opacity-based, no percentages |
| S6 | Live example | [x] | `viz/MiniReality.jsx` | 2-3 real rows as report-style cards |
| S7 | Problems | [x] | `viz/ErrorBreakage.jsx` | Broken SVG connections with fix-click |
| S8 | What happens next | [x] | `panels/StatusView.jsx` | next_step text + action buttons |
| S9 | Control buttons | [x] | `PanelButtons.jsx` | Progressive toggle buttons with error badge |

## Group 4 — Visual State Widgets (Sections 1-11)

| # | Widget | Status | File(s) | Notes |
|---|--------|--------|---------|-------|
| V1 | Living pipeline strip | [x] | `viz/PipelineStrip.jsx` | Framer Motion pulse/shake/spring |
| V2 | Field connection animation | [x] | `viz/FieldConnectionGraph.jsx` | ReactFlow + dagre + edge tooltips + stroke-dashoffset |
| V3 | Before→after morph | [x] | `viz/BeforeAfterMorph.jsx` | Framer Motion bar morphing through stages |
| V4 | Real data injection | [x] | `viz/DataInjection.jsx` | Progressive field fill + fadeIn animation |
| V5 | Error as breakage | [x] | `viz/ErrorBreakage.jsx` | SVG broken lines + pulse animation |
| V6 | Confidence as opacity | [x] | `viz/useConfidenceStyle.js` | Cross-cutting hook, 3-tier opacity |
| V7 | Row flow compression | [x] | `viz/RowFlowCompression.jsx` | Staggered shrinking bars + Recharts funnel |
| V8 | Data source glow | [x] | `viz/FieldConnectionGraph.jsx` + `tabs/TemplateTab.jsx` | highlightedField glow from template clicks (A6) |
| V9 | Timeline scrubber | [x] | `viz/TimelineScrubber.jsx` | vis-timeline + MUI Slider fallback + history preview |
| V10 | Mini reality snapshot | [x] | `viz/MiniReality.jsx` | Auto-animated report-style cards |
| V11 | Interaction principle | [x] | Cross-panel | Click/hover/drag on all visuals, dnd-kit reorder |

---

## Summary

**42/42 widgets implemented from scratch.** Build passes cleanly (`npx vite build` in 22s, no errors).

### Verification per widget

Each widget was verified against these criteria:
1. Component renders without errors
2. Click interactions wired to store actions
3. Hover tooltips present where spec requires
4. State reads from correct store selectors
5. State writes trigger correct store mutations
6. Edge cases handled (empty data, 0 items, overflow)
7. Integrates with other widgets via shared store state (highlightedField, activePanel)

### Files involved (all in `frontend/src/features/pipeline/`)
- `panels/viz/PipelineStrip.jsx` — V1, S1, S4
- `panels/viz/FieldConnectionGraph.jsx` — V2, V8
- `panels/viz/BeforeAfterMorph.jsx` — V3
- `panels/viz/DataInjection.jsx` — V4
- `panels/viz/ErrorBreakage.jsx` — V5, S7
- `panels/viz/useConfidenceStyle.js` — V6, S5
- `panels/viz/RowFlowCompression.jsx` — V7, D4
- `panels/viz/TimelineScrubber.jsx` — V9
- `panels/viz/MiniReality.jsx` — V10, S6
- `panels/StatusView.jsx` — S2, S3, S8, 9 (memory)
- `panels/LivePanel.jsx` — routing
- `panels/QuickActions.jsx` — 10
- `PanelButtons.jsx` — S9
- `tabs/TemplateTab.jsx` — 1a-1g, 8a, D1, D11, V8
- `tabs/MappingsTab.jsx` — 2a-2e
- `tabs/DataTab.jsx` — 3a-3d, D2, D6
- `tabs/LogicTab.jsx` — 4a-4c, 5a-5c, D3, D5, D7
- `tabs/PreviewTab.jsx` — 6a-6e, 8b, D8, D9
- `tabs/ErrorsTab.jsx` — 7a-7c, D10, D12
- `stores/pipeline.js` — all state management
