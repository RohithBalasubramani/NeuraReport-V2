# Right Panel — Status-First, Detail on Click

## Design Principle

**Show "what is happening", not "how it works".**

The right panel defaults to a **plain-language status view** — cards, progress, examples, next steps. No SQL, no schema, no jargon. The user thinks:

> "It reads my report → finds my data → checks it → gives me output"

Technical detail (mappings table, contract rules, data explorer) lives behind panel buttons. User clicks through when they want to dig in. Every status card maps to something clickable.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  RIGHT PANEL (45% of screen)                     │
│                                                   │
│  DEFAULT: Status View (always the home view)      │
│  ┌─────────────────────────────────────────────┐ │
│  │ Current Step: "Connecting your data"    60%  │ │
│  │                                              │ │
│  │ ✅ 16 fields matched automatically           │ │
│  │ ⚠️ 4 fields need your input  [Review →]     │ │
│  │                                              │ │
│  │ Here's a real example from your data:        │ │
│  │ ┌──────────────────────────────┐             │ │
│  │ │ Batch: FLUTO_24P             │             │ │
│  │ │ Material: Corn Flour  450 kg │             │ │
│  │ └──────────────────────────────┘             │ │
│  │                                              │ │
│  │ Next: We'll test with your real data         │ │
│  │                                              │ │
│  │ [Looks good, continue] [Review fields]       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  DRILL-IN: Panel Buttons in chat area             │
│  [Template] [Data] [Mappings]                     │
│  Click → replaces status view with detail panel   │
│  Click again or "Back" → returns to status        │
│                                                   │
└─────────────────────────────────────────────────┘
```

---

## The Status View (Default Home)

**File**: `panels/StatusView.jsx` — NEW

This is what the user sees 90% of the time. It's built from **status cards** that Hermes populates via NDJSON events. Not hardcoded — Hermes decides what cards to show based on what just happened.

### Sections (top to bottom):

#### 1. Current Step Summary (Top Anchor)
- Plain sentence: "We are connecting your data to the report"
- Progress bar with percentage
- Completed steps as subtle checkmarks below

#### 2. What Was Understood (Cards)
- "We found 21 fields in your report"
- "16 fields matched automatically"
- "4 need your input" → **clickable** → switches to Mappings panel
- Each card is a `StatusCard` component with optional click-through

#### 3. What the System Did (Plain Language)
- NOT: "Built contract, validated assets"
- YES: "We figured out where each value comes from"
- YES: "We tested it using real data — everything looks correct"
- List of completed actions in human language

#### 4. Live Example (Most Important)
- 2-3 real rows from the database filled into a mini template preview
- "Here's a real example from your data"
- User instantly understands output without thinking
- Source: first batch from dry_run_preview or sample data

#### 5. Confidence Summary (No Percentages)
- NOT: "87.5% confidence score"
- YES: "Most things look correct"
- YES: "Some parts need confirmation" → clickable → Mappings panel
- Color: green bar = good, yellow = needs attention, red = problems

#### 6. Problems (If Any)
- Plain statements: "We couldn't find where Batch Number comes from"
- "Some rows are empty in your data"
- Each problem has a "Fix this →" link → jumps to relevant panel

#### 7. What Happens Next
- "Next: We will test the report using your real data"
- "Then: You can generate final reports"
- Removes uncertainty — user always knows what's coming

#### 8. Action Buttons (Bottom)
- Context-sensitive: "Looks good, continue" / "Review fields" / "Fix issues"
- These mirror the ActionChips in chat but also appear here for convenience
- Clicking sends action to Hermes (same as chat chips)

### Data Model

Hermes sends status data in `chat_complete` events:

```json
{
  "event": "chat_complete",
  "status_view": {
    "step": "Connecting your data to the report",
    "progress": 60,
    "cards": [
      {"text": "We found 21 fields in your report", "type": "success", "panel": "template"},
      {"text": "16 fields matched automatically", "type": "success", "panel": "mappings"},
      {"text": "4 fields need your input", "type": "attention", "panel": "mappings"},
    ],
    "actions_taken": [
      "Read your PDF and extracted the layout",
      "Connected to your database",
      "Matched most fields automatically"
    ],
    "example": {
      "label": "Here's a real example from your data:",
      "rows": [
        {"Batch": "FLUTO_24P", "Material": "Corn Flour", "Weight": "450 kg"}
      ]
    },
    "confidence": "most_correct",
    "problems": [
      {"text": "We couldn't find where Batch Number comes from", "panel": "mappings", "field": "batch_no"}
    ],
    "next_step": "We'll test the report using your real data",
    "actions": [
      {"label": "Looks good, continue", "action": "approve"},
      {"label": "Review fields", "action": "show_panel", "panel": "mappings"}
    ]
  },
  "panel": {
    "available": ["template", "data", "mappings"],
    "show": null
  }
}
```

### How Hermes Populates This

In the system prompt, add guidance:

```
After every pipeline tool call, include a `status_view` in your response that summarizes 
what happened in plain language. The status_view has:
- step: one sentence describing the current state
- cards: list of findings (each with text, type: success/attention/error, and optional panel link)
- actions_taken: what you just did in plain language
- example: 2-3 real data rows if available
- problems: any issues (each with text and link to panel/field)
- next_step: what happens next
```

The backend `_build_user_message` or `_chat_complete` helper extracts this from Hermes's response and includes it in the NDJSON event.

---

## Panel Buttons (Drill-In)

Panel buttons appear in the chat area (below ActionChips). Clicking a button **replaces** the status view with the detailed panel. A "← Back to status" button at the top of each panel returns to the status view.

```
Chat area:
  [Connect my Database] [Make changes]          ← action chips
  [Search the web] [I need help]                ← persistent chips
  [Template] [Data] [Mappings]                  ← panel buttons (progressive)
```

### Button Visibility (Progressive)
| When | Buttons available |
|------|-------------------|
| After upload | Template, Data |
| After mapping | + Mappings |
| After contract | + Logic |
| After dry run | + Preview |
| When errors | + Errors (with badge) |
| Workspace mode | All 6 always |

### Button Behavior
- Click button → right panel switches from Status View to that panel
- Click same button again (or "← Back") → returns to Status View
- Panel buttons are toggle buttons (MUI ToggleButtonGroup)
- `activePanel` in store: `null` = status view, `"template"` = Template panel, etc.

---

## The 6 Detail Panels

Each panel is a deep-dive view. Technical but still readable. Diagnostic visualizations embedded within.

### Panel 1: Template
**What it shows**: Rendered report preview with field highlighting, confidence heatmap overlay, diff toggle, typography inspector.

**Key diagnostics inside**:
- Confidence heatmap: fields shaded by match certainty
- Template density map: crowded vs empty regions
- Version diff: before/after toggle
- Field inspector: click field → source, type, transformation

### Panel 2: Mappings
**What it shows**: Table of Template Field ↔ DB Column with confidence colors, editable cells, bulk actions.

**Key diagnostics inside**:
- Data quality per column: null% bar, distribution sparkline, outlier markers
- Column stats popover: type, unique count, top values
- Column search autocomplete

### Panel 3: Data (Database Explorer)
**What it shows**: Table list, row preview, column metadata, query builder.

**Key diagnostics inside**:
- Temporal consistency: timeline chart showing record distribution over time
- Row explosion/collapse indicator: row count at each stage (raw → filtered → grouped)
- Column tagging: mark as ID / Date / Metric

### Panel 4: Logic (Contract + Flow)
**What it shows**: Readable rules (not JSON), data flow graph (Mermaid), field lineage trace.

**Key diagnostics inside**:
- Transformation pipeline: stepwise flow per field (Raw → Filter → Group → Format → Template)
- Join relationship graph: tables as nodes, joins as edges, duplication warnings
- Field lineage: select field → full ancestry tree from source to template

### Panel 5: Preview (Real Data)
**What it shows**: Rendered report with actual data, pagination, sample selector.

**Key diagnostics inside**:
- Output variance: compare previous vs current report, highlight changes
- Constraint violations: domain rules (Total ≥ 0, Batch ID exists) with violation counts
- Null/empty cell highlights

### Panel 6: Errors
**What it shows**: Issues by severity, fix suggestions, cross-panel jump.

**Key diagnostics inside**:
- Performance/cost view: query time per step, optimization suggestions
- User action replay: timeline of all actions with rollback capability
- Error explanation: why it failed, what was assumed

---

## Cross-Panel Features

### Quick Actions Overlay
Right-click any element in any panel → floating context menu:
- "Remap this field", "Trace data source", "Preview with data", "Change formatting"

### Memory Preferences (In Chat)
When Hermes applies a remembered preference → special chat message:
```
🧠 Applied: Arial font, landscape layout
[ Accept ] [ Reject ] [ Disable for this report ]
```

### Cross-Panel Jump
Click a problem in Status View → jumps to correct panel with field highlighted.
Click an error in Errors panel → jumps to Template panel with field highlighted.

---

## Backend: Hermes Provides Status Data

### `hermes_agent.py`

After Hermes completes a tool call, compute status_view from session state:

```python
def _build_status_view(session, tool_result=None) -> dict:
    """Build plain-language status for the right panel."""
    tdir = session.template_dir
    view = {"cards": [], "problems": [], "actions_taken": []}
    
    # Step summary
    state_labels = {
        "empty": "Ready for your report",
        "html_ready": "Your report template is ready",
        "mapping": "Connecting your data to the report",
        "mapped": "Data connections are set up",
        "approved": "Preparing your report structure",
        "building_assets": "Setting everything up",
        "validated": "Everything looks good — ready to create reports",
        "ready": "Your reports are ready",
    }
    view["step"] = state_labels.get(session.pipeline_state.value, "Working...")
    
    # Cards from artifacts
    if (tdir / "template_p1.html").exists():
        # count tokens
        tokens = _count_tokens(tdir)
        view["cards"].append({"text": f"We found {tokens} fields in your report", "type": "success", "panel": "template"})
    
    if (tdir / "mapping_step3.json").exists():
        resolved, total, unresolved = _count_mapping(tdir)
        view["cards"].append({"text": f"{resolved} fields matched automatically", "type": "success", "panel": "mappings"})
        if unresolved > 0:
            view["cards"].append({"text": f"{unresolved} fields need your input", "type": "attention", "panel": "mappings"})
    
    # Live example from sample data
    view["example"] = _build_sample_example(tdir, session.connection_id)
    
    return view
```

Include in `chat_complete`:
```python
yield _chat_complete(
    ...
    status_view=_build_status_view(self.session),
    panel={"available": available_panels, "show": auto_panel},
)
```

### `tools.py` — Tool-to-panel map (unchanged)
```python
_TOOL_PANEL_MAP = {
    "verify_template": "template",
    "auto_map_tokens": "mappings",
    "build_contract": "logic",
    "dry_run_preview": "preview",
    "validate_pipeline": "errors",
    "inspect_data": "data",
}
```

---

## Frontend Changes

### Store (`pipeline.js`)
```javascript
activePanel: null,           // null = status view, 'template' = Template panel, etc.
availablePanels: [],
statusView: null,            // status data from backend
highlightedField: null,
setActivePanel: (p) => set({ activePanel: p }),
setAvailablePanels: (p) => set({ availablePanels: p }),
setStatusView: (s) => set({ statusView: s }),
setHighlightedField: (f) => set({ highlightedField: f }),
```

### NDJSON handler
```javascript
if (event.status_view) store.setStatusView(event.status_view)
if (event.panel?.available) store.setAvailablePanels(event.panel.available)
if (event.panel?.show) store.setActivePanel(event.panel.show)
```

### `PanelButtons.jsx` — NEW
Toggle buttons below action chips. Click = switch panel. Click active = return to status.

### `LivePanel.jsx` — REWRITE
```jsx
function LivePanel({ onAction }) {
  const activePanel = usePipelineStore(s => s.activePanel)
  
  if (activePanel === null) {
    return <StatusView onAction={onAction} />   // default home
  }
  
  const Panel = PANELS[activePanel]
  return (
    <Box>
      <BackToStatus />                           // "← Back to overview"
      <Panel onAction={onAction} />
    </Box>
  )
}
```

### `StatusView.jsx` — NEW (the main home view)
Renders status cards, progress, live example, problems, next steps, action buttons.
All from `store.statusView` data provided by Hermes.

### 6 detail panel components in `panels/tabs/`
Template, Mappings, Data, Logic, Preview, Errors — with embedded diagnostics.

### `QuickActions.jsx` — NEW
Floating context menu on right-click in any panel.

### `ChatStream.jsx` — MODIFY
Memory preference messages with Accept/Reject/Disable.

---

## Files Summary

| File | Status | What it does |
|------|--------|-------------|
| `panels/StatusView.jsx` | **NEW** | Default home — status cards, progress, examples, next steps |
| `panels/tabs/TemplateTab.jsx` | **NEW** | Template preview + confidence heatmap + diff + inspector |
| `panels/tabs/MappingsTab.jsx` | **Refactor** | Mapping table + data quality viz + column stats |
| `panels/tabs/DataTab.jsx` | **NEW** | DB explorer + temporal chart + row counts |
| `panels/tabs/LogicTab.jsx` | **NEW** | Contract rules + data flow graph + lineage |
| `panels/tabs/PreviewTab.jsx` | **NEW** | Real data preview + variance check + constraints |
| `panels/tabs/ErrorsTab.jsx` | **Refactor** | Errors + performance view + action replay |
| `panels/QuickActions.jsx` | **NEW** | Context menu overlay |
| `panels/LivePanel.jsx` | **Rewrite** | Routes between StatusView and detail panels |
| `PanelButtons.jsx` | **NEW** | Toggle buttons in chat area |
| `PipelineChatPage.jsx` | **Modify** | Add PanelButtons |
| `ChatStream.jsx` | **Modify** | Memory preference messages |
| `stores/pipeline.js` | **Modify** | Panel state + status data |
| `backend/.../hermes_agent.py` | **Modify** | Build status_view + panel signals |
| `backend/.../tools.py` | **Modify** | Tool-to-panel map |
| `backend/.../hermes_system_prompt.py` | **Modify** | Teach Hermes to produce status_view |

---

## User Journey (What They See)

### Upload PDF
**Status View**:
- "Reading your report..."
- Progress bar → complete
- Card: "We found 21 fields in your report" [click → Template panel]
- Card: "Your report has a header, a data table, and totals"
- Live example: mini preview of extracted template
- Next: "Connect your database to fill in the data"
- Button: [Connect my Database]

### Connect Database
**Status View**:
- "Connecting your data to the report..."
- Card: "16 fields matched automatically" ✅
- Card: "4 fields need your input" ⚠️ [click → Mappings panel]
- Live example: 2 real rows filled into mini template
- Confidence: "Most things look correct. Some parts need confirmation."
- Button: [Looks good, continue] [Review fields]

### Build Contract + Assets
**Status View**:
- "Setting up your report structure..."
- Card: "We figured out where each value comes from" ✅
- Card: "We prepared how data will fill your report" ✅
- Next: "We'll test it with your real data"
- Button: [Continue]

### Validation + Dry Run
**Status View**:
- "Testing with your real data..."
- Card: "78 batches of data found" ✅
- Card: "464 rows rendered correctly" ✅
- Card: "Everything looks good" ✅
- Live example: 3 real rows from the test
- Next: "Ready to create your reports"
- Button: [Create my Reports]

### Problems Found
**Status View**:
- Card: "We couldn't find where Batch Number comes from" ❌ [click → Mappings panel, field highlighted]
- Card: "Some rows are empty in your data" ⚠️ [click → Data panel]
- Problems section with "Fix this →" links
- Button: [Fix issues]

---

## Verification

1. **Status is default**: Open app → right panel shows status view, not a technical panel
2. **Cards are clickable**: Click "4 fields need input" → switches to Mappings panel with those fields highlighted
3. **Back button works**: In Mappings panel, click "← Back to overview" → returns to status view
4. **Progressive buttons**: Upload PDF → only Template + Data buttons appear. Map → + Mappings.
5. **Live example**: After mapping, status shows real data rows from DB
6. **Problems link**: Status shows "We couldn't find Batch Number" → click → jumps to Mappings with batch_no highlighted
7. **Workspace mode**: All 6 panel buttons visible. Status view still works but shows less pipeline context.
8. **No jargon**: Status view never shows "tokens", "contract", "pipeline", "schema", "validation"

---
---

# Phase 2: Visual State Layer — Shape, Motion, Change

## Design Principle

**Show state through shape, motion, and change — not text.**

Every visualization is interactive: click → inspect, hover → reveal, drag → change. No dead visuals.

---

## Architecture: Viz Widgets in StatusView

StatusView becomes an orchestrator that conditionally renders visualization widgets based on available data. Each widget is a self-contained component in `panels/viz/`.

```
StatusView.jsx (orchestrator)
  ├── PipelineStrip.jsx          (#1 — always visible)
  ├── FieldConnectionGraph.jsx   (#2 + #8 — after mapping)
  ├── RowFlowCompression.jsx     (#7 — after validation/dry-run)
  ├── DataInjection.jsx          (#4 — after mapping has samples)
  ├── MiniReality.jsx            (#10 — when example data available)
  ├── ErrorBreakage.jsx          (#5 — when problems exist)
  ├── BeforeAfterMorph.jsx       (#3 — after contract/validation)
  ├── TimelineScrubber.jsx       (#9 — when history has 2+ entries)
  └── NextStepActions            (keep existing action buttons)

Cross-cutting:
  └── useConfidenceStyle.js      (#6 — opacity hook applied everywhere)
```

### Progressive Rendering (what appears when)
| Phase | Widgets Visible |
|-------|----------------|
| Upload | PipelineStrip |
| Template ready | + MiniReality (template preview) |
| Mapping | + FieldConnectionGraph (lines animate in), DataInjection |
| Contract | + BeforeAfterMorph, RowFlowCompression |
| Validation | + ErrorBreakage (if problems), all data enriched |
| Ready | Full set, TimelineScrubber available |

---

## Animation Approach

**No new libraries needed.** Use existing:
- CSS keyframes from `styles.jsx`: `pulse`, `shake`, `fadeIn`, `slideUp`, `shimmer`, `glow`, `bounce`
- MUI transitions: `<Collapse>`, `<Fade>`, `<Grow>`
- SVG native `<animate>` and CSS `stroke-dashoffset` for line-drawing
- ReactFlow (already installed v11.10.0) for the connection graph
- Recharts (already installed) for any bar/funnel charts

---

## The 11 Visualizations

### 1. Living Pipeline Strip (Top — Always Visible)

**File**: `panels/viz/PipelineStrip.jsx`

**Visual**: Horizontal strip with 5 blocks connected by lines:
```
[Report] ──→ [Match] ──→ [Prepare] ──→ [Check] ──��� [Generate]
```

**Behavior**:
- Active step: `animation: pulse 2s infinite`, elevated shadow
- Completed steps: solid fill, success color, checkmark icon
- Problem step: `animation: shake 0.5s`, amber border, warning icon
- Connector lines: solid for completed, dashed+animating for active, grey for pending

**Interaction**: Click any block → `setActivePanel(panelMap[step])` to zoom into that stage

**Data**: `getPipelineSteps()` (existing derived getter), `statusView.problems[]`

**Replaces**: Step text + LinearProgress bar at top of StatusView

---

### 2. Field Connection Animation (Primary Visual)

**File**: `panels/viz/FieldConnectionGraph.jsx`

**Visual**: Mini template fields (left) ←→ DB columns (right), SVG lines connecting them

**Implementation**: ReactFlow in compact mode (~200px height)
- Left nodes: template tokens from `template.tokens`
- Right nodes: DB columns from `mapping.catalog`
- Edges from `mapping.mapping` values

**Line behavior**:
- Strong match (confidence ≥ 0.8): thick solid line, token color
- Weak match (confidence < 0.8): thin dashed line, faded
- Lines animate in using SVG `stroke-dashoffset` transition on mount
- Unresolved: no line, node blinks with `animation: pulse`

**Hover**: Tooltip shows `"Batch Number ← production.batch_id (92%)"

**Drag**: ReactFlow `onEdgeUpdate` → updates mapping via store

**Data Source Glow (#8 integrated)**: When `highlightedField` is set, that edge + source node glow (`animation: glow 1s infinite`), everything else dims to `opacity: 0.15`

**Click**: Expand → `setActivePanel('mappings')`

**Replaces**: "16 fields matched" / "4 fields need input" cards entirely

---

### 3. Before → After Morph (Understanding Transformation)

**File**: `panels/viz/BeforeAfterMorph.jsx`

**Visual**: Three-stage morph view:
```
Raw Table Rows  →  Cleaned/Grouped  →  Final Report Row
   100 rows           5 groups            1 output
```

**Animation**:
- Rows represented as colored bars
- Stage 1: many thin bars (raw rows)
- Transition: bars slide together, merge, change color
- Stage 2: fewer thicker bars (grouped)
- Stage 3: single formatted row (final)
- Auto-plays on mount, ~3s total with CSS transitions

**Interaction**: Click any stage → tooltip with row counts + description

**Backend data needed**: New `status_view.transform_stages`:
```python
view["transform_stages"] = [
    {"label": "Raw Data", "count": 100},
    {"label": "Grouped", "count": 5},
    {"label": "Final", "count": 1},
]
```
Can be derived from `dry_run_result.json` — source rows, grouped rows, output rows.

---

### 4. Real Data Injection (Critical)

**File**: `panels/viz/DataInjection.jsx`

**Visual**: Mini template with empty placeholder boxes that fill progressively:
1. Empty outlined boxes (token placeholders)
2. Data fades in field by field (staggered `animation: fadeIn 0.3s` with increasing delay)
3. Table rows populate one by one

**Animation sequence** (on mount or data change):
```
Header fields fill (0s-0.5s)
  → Body fields fill (0.5s-1.5s)
    → Table rows populate (1.5s-3s)
      → Totals appear last (3s-3.5s)
```

**Data**: Client-side token replacement using `template.html` + `mapping.token_samples` (existing field in mapping data, has sample values per token)

**Interaction**: Click any filled field → `setHighlightedField(token)` + source glow in FieldConnectionGraph

**Replaces**: Static ExampleTable component

---

### 5. Error as Breakage (Not Text)

**File**: `panels/viz/ErrorBreakage.jsx`

**Visual**: For each problem, show a snapped/broken connection:
```
[Batch Number] ──╳── [???]     ← broken line, node blinks
```

**Implementation**:
- SVG with two nodes + a jagged/broken line between them
- Break point pulses red: `animation: glow 1.5s infinite`
- The unresolved field blinks: `animation: pulse 2s infinite`
- If problem has a `field`, show the field name on the left node

**Interaction**: Click broken point → `setActivePanel(problem.panel)` + `setHighlightedField(problem.field)`

**Fallback**: When problem has no structural context (no field/panel), render as a small amber card with shake animation

**Replaces**: Text-based problems list in StatusView

---

### 6. Confidence as Opacity (Cross-cutting)

**File**: `panels/viz/useConfidenceStyle.js`

**Not a standalone widget** — a hook applied to elements in other widgets.

```javascript
function useConfidenceStyle(confidence) {
  // confidence: 0-1 number
  if (confidence >= 0.8) return { opacity: 1 }
  if (confidence >= 0.5) return { opacity: 0.65, filter: 'saturate(0.6)' }
  return { opacity: 0.35, filter: 'saturate(0.3)' }
}
```

**Applied to**:
- FieldConnectionGraph edge strokes + node fills
- DataInjection filled values
- MiniReality card field values
- TemplateTab token chips (existing)

**No numbers shown.** User instinctively sees "this part is unclear" through visual weight.

---

### 7. Row Flow Compression (Powerful + Simple)

**File**: `panels/viz/RowFlowCompression.jsx`

**Visual**: Horizontal funnel — shrinking blocks:
```
┌──────────────────┐
│   1000 rows      │  ← source (full width)
└──────────────────┘
    ┌────────────┐
    │  120 rows  │    ← filtered
    └────────────┘
       ┌──────┐
       │  12  │       ← grouped
       └──────┘
        ┌───┐
        │ 1 │         ← final report
        └───┘
```

**Implementation**: Stacked `<Box>` elements with widths proportional to row counts, CSS `transition: width 0.8s ease` on mount

**Animation**: Blocks start at full width and shrink to their target over ~1.5s with staggered delays

**Shimmer**: Active processing stage has `animation: shimmer 2s infinite`

**Backend data needed**: New `status_view.row_counts`:
```python
view["row_counts"] = {"source": 1000, "filtered": 120, "grouped": 12, "final": 1}
```

**Click**: Tooltip on each block shows label + count

---

### 8. Data "Source Glow" (Integrated into #2)

Not a separate component — it's a mode of FieldConnectionGraph activated by `highlightedField`.

When user clicks a field anywhere in the panel:
1. `setHighlightedField(token)` fires
2. FieldConnectionGraph reads `highlightedField`
3. Matching edge + source DB column node glow: `animation: glow 1s infinite`, bright color
4. Path between them brightens: stroke-width increases, color intensifies
5. All other edges/nodes dim to `opacity: 0.15`

**Answers**: "Where did this come from?" — instantly.

---

### 9. Timeline Scrubber (State Replay)

**File**: `panels/viz/TimelineScrubber.jsx`

**Visual**: Horizontal slider at bottom of StatusView:
```
Upload ───── Match ───── Prepare ───── Check ───── Output
                    ◆ (current position, pulses)
```

**Implementation**: MUI `<Slider>` with custom marks
- Marks derived from `pipelineState.history[]` timestamps
- Labels match pipeline step names
- Current position mark pulses: `animation: pulse 2s infinite`

**Interaction**: Drag slider → temporarily overlays historical state snapshot
- Store method: `previewHistoryAt(index)` sets transient `historyPreview`
- All viz widgets read `historyPreview || current` state
- Release slider → `clearHistoryPreview()` snaps back to current

**Appears**: When `pipelineState.history.length >= 2`

---

### 10. Mini "Reality Snapshot"

**File**: `panels/viz/MiniReality.jsx`

**Visual**: Card showing 2-3 real entries rendered like the final report output — NOT a raw table.

**Implementation**:
- Takes `statusView.example` (existing: `{ label, rows }`)
- Renders each row as a styled mini-card mimicking the report layout
- Field labels on left, values on right, styled with template typography
- Cards stagger in: `animation: slideUp 0.3s ease-out` with `animation-delay: ${i * 0.15}s`

**Confidence applied**: Values use `useConfidenceStyle` for opacity-based visual weight

**Interaction**: Click card → `setActivePanel('preview')`

**Replaces**: Raw ExampleTable in StatusView

---

### 11. Interaction Principle (Implementation Guideline)

Every visual element must support:
- **Click → inspect**: navigate to detail panel or show expanded tooltip
- **Hover → reveal**: MUI `<Tooltip>` with contextual detail
- **Drag → change**: only FieldConnectionGraph (remap edges)

Implementation: All viz components receive `onAction` prop + use store setters (`setActivePanel`, `setHighlightedField`). Every rendered element has `cursor: pointer` and hover state.

---

## New File Structure

```
frontend/src/features/pipeline/panels/viz/
  index.js                    — barrel export
  PipelineStrip.jsx           — #1
  FieldConnectionGraph.jsx    — #2 + #8
  BeforeAfterMorph.jsx        — #3
  DataInjection.jsx           — #4
  ErrorBreakage.jsx           — #5
  useConfidenceStyle.js       — #6 (hook)
  RowFlowCompression.jsx      — #7
  TimelineScrubber.jsx        — #9
  MiniReality.jsx             — #10
```

## StatusView.jsx — Refactored

```jsx
export default function StatusView({ onAction }) {
  const statusView = usePipelineStore(s => s.statusView)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const history = usePipelineStore(s => s.pipelineState.history)

  if (!statusView) return <WelcomeState />

  const hasMapping = mapping?.mapping && Object.keys(mapping.mapping).length > 0
  const hasProblems = statusView.problems?.length > 0
  const hasExample = statusView.example?.rows?.length > 0
  const hasRowCounts = !!statusView.row_counts
  const hasHistory = history.length >= 2

  return (
    <Box sx={{ ... }}>
      <PipelineStrip />
      {hasMapping && <FieldConnectionGraph compact />}
      {hasRowCounts && <RowFlowCompression counts={statusView.row_counts} />}
      {hasExample && <DataInjection />}
      {hasExample && <MiniReality example={statusView.example} />}
      {hasProblems && <ErrorBreakage problems={statusView.problems} />}
      {statusView.transform_stages && <BeforeAfterMorph stages={statusView.transform_stages} />}
      {statusView.next_step && <NextStepActions ... />}
      {hasHistory && <TimelineScrubber />}
    </Box>
  )
}
```

## Backend Extensions (Additive)

In `hermes_agent.py` `_build_status_view()`, add optional fields:

```python
# Row counts for RowFlowCompression (#7)
if dry_run_file.exists():
    dr = json.loads(dry_run_file.read_text())
    view["row_counts"] = {
        "source": dr.get("source_rows", 0),
        "filtered": dr.get("filtered_rows", 0),
        "grouped": dr.get("grouped_rows", 0),
        "final": dr.get("output_rows", 0),
    }

# Transform stages for BeforeAfterMorph (#3)
if contract_file.exists() and dry_run_file.exists():
    view["transform_stages"] = [
        {"label": "Raw Data", "count": dr.get("source_rows", 0)},
        {"label": "Grouped", "count": dr.get("grouped_rows", 0)},
        {"label": "Final Report", "count": dr.get("output_rows", 0)},
    ]
```

## Store Extensions

```javascript
// Timeline scrubber state
historyPreview: null,
previewHistoryAt: (index) => set(s => ({
  historyPreview: s.pipelineState.history[index] || null,
})),
clearHistoryPreview: () => set({ historyPreview: null }),
```

## Phased Implementation Order

### Phase 2a: High Impact, Low Effort
1. **PipelineStrip** (#1) — replaces text, uses existing data
2. **useConfidenceStyle** (#6) — hook, apply to existing components
3. **MiniReality** (#10) — replaces ExampleTable, uses existing data
4. **ErrorBreakage** (#5) — replaces text problems, uses existing data

### Phase 2b: Medium Impact, Medium Effort
5. **FieldConnectionGraph** (#2+#8) — ReactFlow, uses existing mapping data
6. **DataInjection** (#4) — token replacement animation, uses existing data
7. **TimelineScrubber** (#9) — MUI Slider, uses existing history

### Phase 2c: Needs Backend Extension
8. **RowFlowCompression** (#7) — needs `row_counts` field
9. **BeforeAfterMorph** (#3) — needs `transform_stages` field

## Verification

1. **PipelineStrip pulses**: Active step visually pulses, completed steps solid green
2. **Field connections animate**: Lines draw in when mapping completes, thick=strong, dotted=weak
3. **Hover reveals**: Hover any connection → tooltip shows field mapping detail
4. **Error breakage visible**: Missing mapping shows as broken snapped line, not text
5. **Confidence is opacity**: No numbers — strong fields solid, weak fields faded
6. **Row compression shows**: Funnel visual from 1000→12→1 rows
7. **Source glow works**: Click template field → source DB column lights up
8. **Timeline scrubs**: Drag slider → UI shows past state, release → snaps back
9. **Reality snapshot**: 3 real entries shown in final-report style, not raw table
10. **All clickable**: Every visual element has hover state and click action
11. **No dead visuals**: Nothing is purely decorative — all lead to action
