# Widget Backend Dependency Map — 42 Widgets

Which of the 42 widgets need LLM, which need backend (non-LLM), and which are pure frontend.
Includes implementation status for backend infrastructure.

---

## Pure Frontend (28 widgets) — BACKEND: HYDRATION DAEMON ✅ PLANNED

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
| `column_tags.json` | `columnTags` | NEW: `POST /pipeline/data/tags` |
| `_build_status_view()` | `statusView` (cards, problems, example, next_step) | Computed from artifacts |

### Session isolation verified:
- Each template_id maps to a unique directory with hash suffix (e.g., `filled-1762928694-2be96f/`)
- Single `chat_session.json` per directory with bound `session_id`
- `/hydrate` endpoint validates `session_id` matches before returning artifacts
- Artifacts are co-located in the same directory — no cross-session data leakage

### Widget list:

| # | Widget | Store fields consumed | Behavior when empty |
|---|--------|---|---|
| 1a | Rendered report preview | `template.html` | Shows "Upload a file to get started" |
| 1b | Section boundaries | `template.html` | Hidden |
| 1c | Field placeholders highlighted | `template.html`, `template.tokens` | Hidden |
| 1d | Grid/spacing overlay | `template.html` | Hidden |
| 1e | Typography inspector | DOM element (no store) | Disabled until element clicked |
| 1g | Toggle raw/filled values | `template.html`, `mapping.token_samples` | Shows "labels" mode only |
| 8a | Version/diff layer | `templateVersions` (auto-tracked, not persisted) | Shows "Need ≥2 versions" |
| 8b | Output variance | `templateVersions`, `validation` | Shows placeholder |
| 10 | Quick actions | None (context menu) | Always works |
| D8 | Output variance check | `validation`, `templateVersions` | Shows placeholder |
| D9 | Constraint violations | `constraintViolations`, `contract.constraints` | Empty (client-side engine) |
| D11 | Template density map | `template.html` | Returns empty grid |
| D12 | User action replay | `pipelineState.history` (auto-tracked, not persisted) | Hidden if <2 entries |
| S1 | Pipeline strip | `getPipelineSteps()` (derived) | Always renders (all "pending") |
| S4 | Data flow (layman) | Same as S1 | Always renders |
| S9 | Control buttons | `availablePanels` | Shows minimal buttons |
| V1 | Living pipeline strip | Same as S1 + animations | Always renders |
| V2 | Field connection animation | `template.tokens`, `mapping.mapping`, `mapping.confidence` | Returns null |
| V3 | Before→after morph | `stages` prop (parent-driven) | Returns null |
| V4 | Data injection | `template.tokens`, `mapping.mapping`, `mapping.token_samples` | Returns null |
| V5 | Error as breakage | `statusView.problems` | Returns null |
| V6 | Confidence as opacity | `mapping.confidence` | Default 0.5 opacity |
| V7 | Row flow compression | `counts` prop (parent-driven) | Returns null |
| V8 | Data source glow | `highlightedField` | No glow (no highlighted field) |
| V9 | Timeline scrubber | `pipelineState.history` | Hidden if <2 entries |
| V10 | Mini reality snapshot | `statusView.example.rows` | Returns null |
| V11 | Interaction principle | None (wiring only) | Always works |
| S5 | Confidence/certainty | `mapping.confidence` | Default opacity |

### Backend implementation:
- `GET /api/v1/pipeline/{session_id}/hydrate` — returns ALL artifact data in one response
- `HydrationDaemon` (asyncio background task) — rebuilds `hydration_cache.json` on every session state transition
- Frontend calls `/hydrate` on page load → `store.processEvent(hydration)` populates entire store instantly
- File: `backend/app/services/hydration_daemon.py` + endpoint in `routes_a.py`

---

## Needs Backend but NOT LLM (10 widgets) — BACKEND: REST + DAEMON ✅ PLANNED

These need the backend to query the database or compute metrics, but no AI reasoning.
Backend solution: **Dedicated REST endpoints** at `/api/v1/pipeline/data/` + **WidgetDataDaemon** that pre-computes on session transitions.

| # | Widget | Endpoint | Existing backend | Status |
|---|--------|----------|-----------------|--------|
| 3a | Database explorer | `GET /connections/{id}/schema` | `get_connection_schema()` legacy_services.py:4789 | ✅ Exists — frontend needs to call it |
| 3b | Query builder | `POST /nl2sql/execute` | `NL2SQLService.execute_query()` | ✅ Exists — frontend needs to call it |
| 3c | Column tagging | `GET/POST /pipeline/data/tags` | None | 🔨 New — simple JSON read/write to `column_tags.json` |
| 3d | Preview in report | `GET /connections/{id}/preview` | `get_connection_table_preview()` legacy_services.py:4871 | ✅ Exists — frontend needs to call it |
| 6a | Real data preview | `GET /connections/{id}/preview` | Same as 3d | ✅ Exists |
| 6d | Batch selector | `GET /pipeline/data/batches` | `discover_batches_and_counts()` reports.py | 🔨 New — wraps existing function |
| D2 | Data quality | `GET /pipeline/data/column-stats` | `DataValidator.get_column_stats()` data_validator.py:215 | 🔨 New — extracts tool logic into REST |
| D6 | Temporal consistency | `GET /pipeline/data/temporal` | Partial (in column_stats temporal branch) | 🔨 New — gap/spike detection logic |
| D10 | Performance metrics | `GET /pipeline/data/performance` | Written to `performance_metrics.json` by hermes | 🔨 New — reads artifact file |
| S7 | Problems | `GET /pipeline/data/problems` | `DataValidator.validate_report_data()` + validator/runner.py | 🔨 New — reads artifacts, computes on-demand |

### Daemon precomputation triggers:

| Session transition | Widgets pre-computed |
|---|---|
| `state:mapped` | D2 (column stats), D6 (temporal) |
| `state:approved` | 6d (batches) |
| `state:validated` | S7 (problems), D10 (performance) |

### Cache:
- Written to `{template_dir}/widget_cache/{name}.json`
- REST endpoint checks cache first, computes on-demand on miss
- Session-isolated: cache lives inside the session's template_dir

### Backend implementation:
- File: `backend/app/api/routes/routes_pipeline_data.py` (6 new endpoints)
- File: `backend/app/services/widget_data_daemon.py` (background precompute)
- Frontend: `frontend/src/api/widgetData.js` (API client for direct widget fetching)

---

## Needs LLM (23 widgets) — TODO

These require the Qwen agent to reason, generate, or decide. Many share the same LLM calls.

| # | Widget | What the LLM provides |
|---|--------|---|
| 1f | Click field → source/type | **Mapping + confidence** — LLM decides which DB column maps to which token |
| 2a-2e | Full mapping table | **Auto-mapping** — LLM matches tokens to columns, scores confidence, suggests candidates |
| 4a | Contract logic blocks | **Contract generation** — LLM writes the transformation rules |
| 4b | Per-rule validation | **Validation** — LLM-generated contract is then validated |
| 4c | Transformation pipeline | Derived from **LLM contract** |
| 5a | Data flow graph | Derived from **LLM contract** |
| 5b | Join relationship graph | **LLM decides join conditions** between tables |
| 5c | Field lineage trace | Derived from **LLM contract** |
| 6b | Constraint violations | **LLM-generated constraints** (engine is client-side, but rules come from LLM) |
| 6c | Constraint rule editor | User adds rules, but **defaults come from LLM contract** |
| 6e | Toggle raw vs formatted | Needs `token_samples` which come from **LLM mapping** |
| 7a | Validation panel | **LLM validates** contract against data |
| 7b | Auto-fix vs manual | **LLM classifies** which issues are auto-fixable |
| 7c | Optimization suggestions | Heuristic (frontend), but metrics from **LLM pipeline timing** |
| 9 | Learned patterns | **LLM learning signal** — patterns extracted from user behavior |
| D1 | Confidence heatmap | **LLM confidence scores** per field |
| D3 | Transform pipeline view | From **LLM contract** |
| D5 | Join relationship graph | From **LLM contract joins** |
| D7 | Field lineage | From **LLM contract** |
| S2 | What was understood | **LLM status_view.cards** — LLM summarizes what it understood |
| S3 | What system did | **LLM status_view.actions_taken** |
| S6 | Live example | **LLM provides example rows** in status_view |
| S8 | What happens next | **LLM status_view.next_step** |

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

## Backend Work Priority

### Covered (38 of 42 widgets):

| Phase | Scope | Widgets | Files | Status |
|-------|-------|---------|-------|--------|
| **A** | Hydration daemon + endpoint | 28 pure frontend | `hydration_daemon.py`, `routes_a.py` (hydrate endpoint), `PipelineChatPage.jsx`, `pipeline.js` | 📋 Planned |
| **B** | REST endpoints + data daemon | 10 non-LLM backend | `routes_pipeline_data.py`, `widget_data_daemon.py`, `widgetData.js` | 📋 Planned |

### Remaining (23 LLM widgets — separate phase):

1. **Already working**: Status View generation (action 4) — backend already emits `status_view` in `chat_complete`
2. **Partially working**: Map action (action 1) — auto-mapping exists but needs confidence scores, candidates, token_samples
3. **Needs implementation**: Contract/Approve (action 2) — contract generation with joins, transforms, field rules
4. **Needs implementation**: Validate (action 3) — run contract against real data, produce issues list
5. **Nice-to-have**: Learning Signal (action 5) — pattern extraction from user session history

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
│   ├── column_tags.json               ← NEW (3c column tagging)
│   ├── hydration_cache.json           ← NEW (pre-built by HydrationDaemon)
│   └── widget_cache/                  ← NEW (pre-built by WidgetDataDaemon)
│       ├── quality_{table}.json
│       ├── temporal_{table}_{col}.json
│       ├── batches.json
│       └── problems.json
└── filled-1762928694-38e79e/          ← different session, different directory
    └── ...
```
