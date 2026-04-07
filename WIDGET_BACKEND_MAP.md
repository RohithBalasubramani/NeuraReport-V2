# Widget Backend Dependency Map — 42 Widgets

Which of the 42 widgets need LLM, which need backend (non-LLM), and which are pure frontend.
Includes implementation status for backend infrastructure.

---

## Pure Frontend (28 widgets) — BACKEND: HYDRATION DAEMON ✅ IMPLEMENTED

These work with data already in the Zustand store. The store starts **empty** on page load.
Backend solution: **Hydration endpoint** (`GET /api/v1/pipeline/{session_id}/hydrate`) + **HydrationDaemon** background service that pre-builds a full store payload from cached session artifacts.

### Store data sources (all read from `{template_dir}/` artifact files):

| Artifact file | Store field(s) populated | Written by |
|---|---|---|
| `template_p1.html` | `template.html`, `template.tokens` (regex extracted) | `tool_verify_template` |
| `mapping_step3.json` | `mapping.mapping`, `.confidence`, `.candidates`, `.token_samples` | `tool_simulate_mapping` |
| `contract.json` | `contract.contract`, `.overview`, `.gates` | `tool_build_contract` |
| `validation_result.json` | `validation.result`, `.issues`, `pipelineState.errors` | `tool_validate_pipeline` |
| `dry_run_result.json` | `generation.batches`, `statusView.example` | `tool_dry_run_preview` |
| `column_stats.json` | `columnStats` | `tool_get_column_stats` |
| `performance_metrics.json` | `performanceMetrics` | `HermesBridge.save_performance_metrics()` |
| `constraint_violations.json` | `constraintViolations` | `tool_validate_pipeline` |
| `column_tags.json` | `columnTags` | `POST /pipeline/data/tags` |
| `custom_constraints.json` | `customConstraintRules` | `POST /pipeline/data/constraints` |
| `pipeline_history.json` | `pipelineState.history` | `POST /pipeline/data/history` (debounced) |
| `learning_signal.json` | `learningSignal` | Hermes agent learning signal |
| `widget_cache/temporal_*.json` | `temporalData` (gap/spike analysis) | WidgetDataDaemon |
| `_build_status_view()` | `statusView` (cards, problems, example, next_step) | Computed from artifacts |

### Session isolation verified:
- Each template_id maps to a unique directory with hash suffix (e.g., `filled-1762928694-2be96f/`)
- Single `chat_session.json` per directory with bound `session_id`
- `/hydrate` endpoint validates `session_id` matches before returning artifacts
- Artifacts are co-located in the same directory — no cross-session data leakage

### Widget list:

| # | Widget | Store fields consumed | Behavior when empty | Backend status |
|---|--------|---|---|---|
| 1a | Rendered report preview | `template.html` | Shows "Upload a file to get started" | ✅ Hydrated |
| 1b | Section boundaries | `template.html` | Hidden | ✅ Hydrated |
| 1c | Field placeholders highlighted | `template.html`, `template.tokens` | Hidden | ✅ Hydrated |
| 1d | Grid/spacing overlay | `template.html` | Hidden | ✅ CSS only |
| 1e | Typography inspector | DOM element (no store) | Disabled until element clicked | ✅ DOM only |
| 1g | Toggle raw/filled values | `template.html`, `mapping.token_samples` | Shows "labels" mode only | ✅ Hydrated |
| 8a | Version/diff layer | `templateVersions` (auto-tracked) | Shows "Need ≥2 versions" | ✅ Frontend only |
| 8b | Output variance | `templateVersions`, `validation` | Shows placeholder | ✅ Hydrated |
| 10 | Quick actions | None (context menu) | Always works | ✅ No data needed |
| D8 | Output variance check | `validation`, `templateVersions` | Shows placeholder | ✅ Hydrated |
| D9 | Constraint violations | `constraintViolations`, `contract.constraints` | Empty (client-side engine) | ✅ Hydrated |
| D11 | Template density map | `template.html` | Returns empty grid | ✅ Hydrated |
| D12 | User action replay | `pipelineState.history` | Hidden if <2 entries | ✅ Persisted to `pipeline_history.json` |
| S1 | Pipeline strip | `getPipelineSteps()` (derived) | Always renders (all "pending") | ✅ Derived |
| S4 | Data flow (layman) | Same as S1 | Always renders | ✅ Derived |
| S9 | Control buttons | `availablePanels` | Shows minimal buttons | ✅ Hydrated |
| V1 | Living pipeline strip | Same as S1 + animations | Always renders | ✅ Derived |
| V2 | Field connection animation | `template.tokens`, `mapping.mapping`, `mapping.confidence` | Returns null | ✅ Hydrated |
| V3 | Before→after morph | `stages` prop (parent-driven) | Returns null | ✅ Hydrated |
| V4 | Data injection | `template.tokens`, `mapping.mapping`, `mapping.token_samples` | Returns null | ✅ Hydrated |
| V5 | Error as breakage | `statusView.problems` | Returns null | ✅ Hydrated |
| V6 | Confidence as opacity | `mapping.confidence` | Default 0.5 opacity | ✅ Hydrated |
| V7 | Row flow compression | `counts` prop (parent-driven) | Returns null | ✅ Hydrated |
| V8 | Data source glow | `highlightedField` | No glow (no highlighted field) | ✅ Frontend only |
| V9 | Timeline scrubber | `pipelineState.history` | Hidden if <2 entries | ✅ Persisted |
| V10 | Mini reality snapshot | `statusView.example.rows` | Returns null | ✅ Hydrated |
| V11 | Interaction principle | None (wiring only) | Always works | ✅ No data needed |
| S5 | Confidence/certainty | `mapping.confidence` | Default opacity | ✅ Hydrated |

### Backend implementation:
- `GET /api/v1/pipeline/{session_id}/hydrate` — returns ALL artifact data in one response ✅
- `HydrationDaemon` (asyncio background task) — rebuilds `hydration_cache.json` on every session state transition ✅
- Frontend calls `/hydrate` on page load → `store.processEvent(hydration)` populates entire store instantly ✅
- File: `backend/app/services/hydration_daemon.py` + `backend/app/services/hydration.py` + endpoint in `routes_a.py`

---

## Needs Backend but NOT LLM (10 widgets) — BACKEND: REST + DAEMON ✅ IMPLEMENTED

These need the backend to query the database or compute metrics, but no AI reasoning.
Backend solution: **Dedicated REST endpoints** at `/api/v1/pipeline/data/` + **WidgetDataDaemon** that pre-computes on session transitions.

| # | Widget | Endpoint | Status |
|---|--------|----------|--------|
| 3a | Database explorer | `GET /connections/{id}/schema` | ✅ Exists + frontend wired |
| 3b | Query builder | `POST /pipeline/data/query` | ✅ Direct SQL execution wired in DataTab |
| 3c | Column tagging | `GET/POST /pipeline/data/tags` | ✅ Persisted to `column_tags.json` |
| 3d | Preview in report | `setActivePanel('preview')` | ✅ Store navigation |
| 6a | Real data preview | `GET /connections/{id}/preview` | ✅ Exists |
| 6d | Batch selector | `GET /pipeline/data/batches` | ✅ Wraps `discover_batches_and_counts()` |
| D2 | Data quality | `GET /pipeline/data/column-stats` | ✅ Daemon precomputes on `state:html_ready` + `state:mapped` |
| D6 | Temporal consistency | `GET /pipeline/data/temporal` | ✅ Gap/spike detection, hydrated + fetched on mount |
| D10 | Performance metrics | `GET /pipeline/data/performance` | ✅ Reads `performance_metrics.json` |
| S7 | Problems | `GET /pipeline/data/problems` | ✅ Reads validation + violations, computes on-demand |

### Additional endpoints (persistence for frontend state):

| Endpoint | Widget | Purpose |
|----------|--------|---------|
| `GET/POST /pipeline/data/constraints` | 6c | Persist custom constraint rules to `custom_constraints.json` |
| `GET/POST /pipeline/data/history` | D12 | Persist pipeline edit history to `pipeline_history.json` |

### Daemon precomputation triggers:

| Session transition | Widgets pre-computed |
|---|---|
| `state:html_ready` | D2 (column stats) |
| `state:mapped` | D2 (column stats), D6 (temporal) |
| `state:approved` | 6d (batches) |
| `state:validated` | S7 (problems), D10 (performance) |

### Cache:
- Written to `{template_dir}/widget_cache/{name}.json`
- REST endpoint checks cache first, computes on-demand on miss
- Session-isolated: cache lives inside the session's template_dir

### Backend implementation:
- File: `backend/app/api/routes/routes_pipeline_data.py` (12 endpoints total) ✅
- File: `backend/app/services/widget_data_daemon.py` (background precompute) ✅
- Frontend: `frontend/src/api/widgetData.js` (API client with 11 functions) ✅

---

## Needs LLM (23 widgets — overlaps with above) — WORKS VIA CHAT PIPELINE

These require the Qwen agent to reason, generate, or decide. Many share the same LLM calls.
Data arrives via NDJSON `chat_complete` events, and is **persisted as artifacts** so the hydration daemon can serve them on subsequent page loads.

| # | Widget | What the LLM provides | Hydrated after first run? |
|---|--------|---|---|
| 1f | Click field → source/type | **Mapping + confidence** | ✅ via `mapping_step3.json` |
| 2a-2e | Full mapping table | **Auto-mapping** | ✅ via `mapping_step3.json` |
| 4a | Contract logic blocks | **Contract generation** | ✅ via `contract.json` |
| 4b | Per-rule validation | **Validation** | ✅ via `validation_result.json` |
| 4c | Transformation pipeline | Derived from **LLM contract** | ✅ via `contract.json` |
| 5a | Data flow graph | Derived from **LLM contract** | ✅ via `contract.json` |
| 5b | Join relationship graph | **LLM decides join conditions** | ✅ via `contract.json` |
| 5c | Field lineage trace | Derived from **LLM contract** | ✅ via `contract.json` |
| 6b | Constraint violations | **LLM-generated constraints** | ✅ via `constraint_violations.json` |
| 6c | Constraint rule editor | User adds rules, defaults from LLM | ✅ via `custom_constraints.json` |
| 6e | Toggle raw vs formatted | `token_samples` from LLM mapping | ✅ via `mapping_step3.json` |
| 7a | Validation panel | **LLM validates** contract | ✅ via `validation_result.json` |
| 7b | Auto-fix vs manual | `issue.autoFixable` flag | ✅ via `validation_result.json` |
| 7c | Optimization suggestions | Metrics from pipeline timing | ✅ via `performance_metrics.json` |
| 9 | Learned patterns | **LLM learning signal** | ✅ via `learning_signal.json` |
| D1 | Confidence heatmap | LLM confidence scores | ✅ via `mapping_step3.json` |
| D3 | Transform pipeline view | From LLM contract | ✅ via `contract.json` |
| D5 | Join relationship graph | From LLM contract joins | ✅ via `contract.json` |
| D7 | Field lineage | From LLM contract | ✅ via `contract.json` |
| S2 | What was understood | `statusView.cards` | ✅ via `_build_status_view()` |
| S3 | What system did | `statusView.actions_taken` | ✅ via `_build_status_view()` |
| S6 | Live example | `statusView.example` | ✅ via `_build_status_view()` |
| S8 | What happens next | `statusView.next_step` | ✅ via `_build_status_view()` |

---

## Key Insight: 5 Distinct LLM Actions

The 23 LLM-dependent widgets only need **5 distinct LLM actions**:

| LLM Action | Widgets it feeds | Current backend |
|---|---|---|
| **1. Map** (auto-mapping) | 1f, 2a-2e, 6e, D1, V2, V4, V8 | `hermes_agent.py` → `map` tool |
| **2. Approve/Contract** | 4a-4c, 5a-5c, D3, D5, D7 | `hermes_agent.py` → `approve` tool |
| **3. Validate** | 4b, 6b, 6c, 7a-7c | `hermes_agent.py` → `validate` tool |
| **4. Status View** | S2, S3, S6, S8, 9 | Generated in `chat_complete` response |
| **5. Learning Signal** | 9 | `learning_signal` in event stream |

---

## Implementation Status: 42/42 COMPLETE ✅

| Phase | Scope | Widgets | Status |
|-------|-------|---------|--------|
| **A** | Hydration daemon + endpoint | 28 pure frontend | ✅ Implemented |
| **B** | REST endpoints + data daemon | 10 non-LLM backend | ✅ Implemented |
| **C** | Gap fixes (3b, 6c, D2, D6, D12) | 5 widgets with wiring gaps | ✅ Fixed |
| **D** | LLM widgets via chat pipeline | 23 LLM-dependent (overlaps) | ✅ Working via chat + hydrated on reload |

### Gap fixes completed:
- **3b Query builder**: Direct `POST /pipeline/data/query` execution wired in DataTab (was dispatching to parent only)
- **6c Constraint rules**: Persisted to `custom_constraints.json` via `GET/POST /pipeline/data/constraints` (was Zustand-only)
- **D2 Data quality**: Daemon triggers on `state:html_ready` + proactive fetch on mount (was sparse after hydration)
- **D6 Temporal**: Detailed gap/spike data included in hydration payload + fetched on mount (was missing)
- **D12 History**: Debounce-persisted to `pipeline_history.json` + restored on hydration (was lost on refresh)

### Session Isolation Model

```
{UPLOAD_ROOT}/
├── filled-1762928694-2be96f/          ← unique per template_id (hash suffix)
│   ├── chat_session.json              ← session_id bound here
│   ├── template_p1.html               ← artifacts all co-located
│   ├── mapping_step3.json
│   ├── contract.json
│   ├── validation_result.json
│   ├── column_stats.json
│   ├── performance_metrics.json
│   ├── constraint_violations.json
│   ├── column_tags.json               ← 3c column tagging
│   ├── custom_constraints.json         ← 6c constraint rules
│   ├── pipeline_history.json           ← D12 edit history
│   ├── learning_signal.json            ← 9 learned patterns
│   ├── hydration_cache.json            ← pre-built by HydrationDaemon
│   └── widget_cache/                   ← pre-built by WidgetDataDaemon
│       ├── quality_{table}.json
│       ├── temporal_{table}_{col}_month.json
│       ├── batches.json
│       └── problems.json
└── filled-1762928694-38e79e/          ← different session, different directory
    └── ...
```
