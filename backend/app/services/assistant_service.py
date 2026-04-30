from __future__ import annotations
"""Assistant service — handles chat requests for the in-product assistant.

Uses LLMClient.complete() directly (not the AgentService task queue) for
low-latency synchronous responses.
"""


import logging
from typing import Any, Dict, List


logger = logging.getLogger("neura.assistant")

# Max conversation turns to send to the LLM (user + assistant pairs)
_MAX_HISTORY_MESSAGES = 20
_MAX_RESPONSE_TOKENS = 1024
_TEMPERATURE = 0.4


class AssistantService:
    """In-product assistant backed by the existing LLM stack."""

    def chat(
        self,
        messages: List[Dict[str, str]],
        context: Dict[str, Any],
        mode: str = "auto",
    ) -> Dict[str, Any]:
        """Process a chat message and return an assistant response.

        Args:
            messages: Conversation history [{role, content}, ...].
                      The last message should be the user's current question.
            context: Frontend context (route, selected_entities, workflow_state, etc.)
            mode: Response mode (auto, explain, howto, troubleshoot, coaching, domain, action)

        Returns:
            dict with keys: answer, follow_ups, actions, tokens_used, mode_used
        """
        from backend.app.services.llm import get_llm_client

        # 1. Look up product knowledge for the current route
        route = context.get("route", "/")
        knowledge = lookup_route_knowledge(route)

        # 2. Assemble system prompt
        system_prompt = assemble_system_prompt(context, knowledge, mode)

        # 3. Build message list for the LLM
        # Trim conversation history to avoid context overflow
        history = messages[-_MAX_HISTORY_MESSAGES:] if messages else []

        llm_messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Add conversation history
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                llm_messages.append({"role": role, "content": content})

        # Ensure the last message is from the user
        if not llm_messages or llm_messages[-1].get("role") != "user":
            logger.warning("Assistant chat called with no user message")
            return {
                "answer": "Please ask a question and I'll help you with NeuraReport.",
                "follow_ups": [
                    "What is this page for?",
                    "How do I get started?",
                    "What can I do here?",
                ],
                "actions": [],
                "tokens_used": 0,
                "mode_used": mode,
            }

        # 4. Call the LLM
        try:
            client = get_llm_client()
            response = client.complete(
                messages=llm_messages,
                description="assistant-chat",
                max_tokens=_MAX_RESPONSE_TOKENS,
                temperature=_TEMPERATURE,
                use_cache=False,  # Assistant responses should be fresh
            )
        except Exception:
            logger.exception("Assistant LLM call failed")
            return {
                "answer": (
                    "I'm having trouble connecting to the AI service right now. "
                    "Please try again in a moment. If the problem persists, "
                    "check the Operations Console (/ops) for system status."
                ),
                "follow_ups": [],
                "actions": [
                    {"type": "navigate", "path": "/ops", "label": "Check System Status"},
                ],
                "tokens_used": 0,
                "mode_used": mode,
            }

        # 5. Extract response text and token usage
        raw_text = ""
        tokens_used = 0
        try:
            choices = response.get("choices") or []
            if choices:
                raw_text = choices[0].get("message", {}).get("content", "") or ""
            usage = response.get("usage") or {}
            tokens_used = (usage.get("prompt_tokens", 0) or 0) + (
                usage.get("completion_tokens", 0) or 0
            )
        except (IndexError, KeyError, TypeError, AttributeError):
            logger.warning("Failed to parse assistant LLM response")

        if not raw_text:
            return {
                "answer": "I wasn't able to generate a response. Please try rephrasing your question.",
                "follow_ups": [],
                "actions": [],
                "tokens_used": tokens_used,
                "mode_used": mode,
            }

        # 6. Extract follow-ups and actions from the response
        answer, follow_ups = extract_follow_ups(raw_text)
        answer, actions = extract_actions(answer)

        # Clean up any trailing whitespace or dashes
        answer = answer.rstrip().rstrip("-").rstrip()

        return {
            "answer": answer,
            "follow_ups": follow_ups[:3],  # Max 3 follow-ups
            "actions": actions[:3],  # Max 3 actions
            "tokens_used": tokens_used,
            "mode_used": mode,
        }



# ── Originally: knowledge.py ──

"""Product knowledge base for the NeuraReport in-product assistant.

Maps frontend routes to feature metadata used for grounding LLM responses.
Each entry provides context about what the page does, available actions,
common issues, and related features so the assistant can give actionable,
product-specific guidance instead of generic FAQ answers.
"""

from typing import Any, Dict, Optional

PRODUCT_KNOWLEDGE: Dict[str, Dict[str, Any]] = {
    # -------------------------------------------------------------------------
    # Core pages
    # -------------------------------------------------------------------------
    "/": {
        "feature": "Dashboard",
        "description": (
            "The main overview page showing recent report generation activity, "
            "active connections, recent jobs, and quick-action cards. This is the "
            "first page users see after login."
        ),
        "key_actions": [
            "View recent report generation jobs",
            "Quick-generate a report from last-used template and connection",
            "Check connection health status",
            "Navigate to Templates, Connections, or Reports",
        ],
        "common_issues": [
            "No connections configured yet — user needs to add a database connection first",
            "No templates available — user needs to create or upload a template",
            "Jobs stuck in pending — may indicate scheduler issue or LLM overload",
            "Empty dashboard — this is normal for first-time users, guide them to setup wizard",
        ],
        "related_routes": ["/connections", "/templates", "/reports", "/setup/wizard"],
        "concepts": {},
        "ui_elements": {
            "quick_generate_card": "Card with 'Generate Report' button — uses last-used template and connection for one-click report generation",
            "recent_jobs_list": "Shows the 5 most recent jobs with status badges (running/completed/failed) and clickable links",
            "connection_health_card": "Shows active connection name, type, and health indicator (green/yellow/red)",
            "stats_cards": "Top-row cards showing counts for Templates, Connections, Jobs, and Reports",
            "empty_state_banner": "Shown when no connections or templates exist — has 'Get Started' button linking to setup wizard",
        },
    },
    "/connections": {
        "feature": "Data Sources / Connections",
        "description": (
            "Manage database connections. Users can add, edit, test, and delete connections "
            "to PostgreSQL, MySQL, SQLite, SQL Server, BigQuery, and other databases. "
            "Each connection stores a database URL, credentials, and optional schema filters. "
            "One connection is set as 'active' and used for report generation."
        ),
        "key_actions": [
            "Add a new database connection (provide db_url, name, type)",
            "Test an existing connection to verify connectivity",
            "Browse tables and columns in the connected database (schema discovery)",
            "Set a connection as the active connection for report generation",
            "Edit connection credentials or URL",
            "Delete a connection",
        ],
        "common_issues": [
            "Connection test fails — check hostname, port, credentials, and firewall rules",
            "SSL certificate error — may need to add ?sslmode=require to connection string",
            "Schema discovery shows no tables — check that the database user has SELECT permission",
            "Connection works locally but not in production — check network accessibility",
        ],
        "related_routes": ["/templates", "/reports", "/query", "/federation"],
        "concepts": {
            "connection_string": "The database URL combining protocol, host, port, database name, and credentials (e.g. postgresql://user:pass@host:5432/dbname)",
            "active_connection": "The currently selected connection that will be used when generating reports or running queries",
            "schema_discovery": "Automatically listing all tables and columns in a database to assist with template mapping",
        },
        "ui_elements": {
            "connections_table": "Table listing all saved connections with name, type, status, and action buttons (Edit, Test, Delete, Set Active)",
            "add_connection_button": "Opens a form/dialog to add a new database connection",
            "test_connection_button": "Tests connectivity to the database and shows success/failure message",
            "connection_form": "Form fields: Name, Type (dropdown: PostgreSQL/MySQL/SQLite/etc.), Connection String/URL, optional SSL toggle",
            "schema_explorer_panel": "Expandable tree view showing tables and columns after connection test succeeds",
            "active_badge": "Green 'Active' badge on the connection currently used for report generation",
        },
    },
    "/templates": {
        "feature": "Templates",
        "description": (
            "Report templates define the layout, styling, and data mapping for generated reports. "
            "Templates are HTML-based with token placeholders (like {{column_name}}) that get "
            "replaced with actual data during report generation. Users can upload a sample PDF "
            "to create a template via AI, or create one from scratch using the chat interface."
        ),
        "key_actions": [
            "Upload a sample PDF to create a new template via AI",
            "Create a template from scratch using the AI chat interface",
            "Edit an existing template's HTML and mappings",
            "View template verification status and quality score",
            "Download a template",
            "Delete a template",
        ],
        "common_issues": [
            "Template verification fails — usually due to OCR extraction issues with the PDF",
            "Tokens don't match database columns — need to re-map or rename tokens",
            "Template HTML doesn't match the original PDF layout — try re-verifying or editing manually",
            "Template shows 'not approved' — user needs to approve the mapping before generating reports",
        ],
        "related_routes": ["/templates/new", "/connections", "/reports"],
        "concepts": {
            "tokens": "Placeholder variables in the template HTML (e.g. {{date}}, {{amount}}) that get replaced with actual database values during report generation",
            "scalar_tokens": "Tokens that map to a single value (e.g. report date, company name)",
            "row_tokens": "Tokens inside a table row that repeat for each data row from the database",
            "verification": "The AI process of converting a sample PDF into an HTML template with extracted tokens",
            "quality_score": "A 0-100 score indicating how well the AI-generated template matches the original PDF",
        },
        "ui_elements": {
            "template_cards": "Grid of cards showing each template with name, status (approved/pending), quality score, and action buttons",
            "create_from_pdf_button": "'Create from PDF' button — navigates to /templates/new for the full template creation flow",
            "create_from_scratch_button": "'Create from Scratch' — opens the AI chat interface for describing a template",
            "template_status_badge": "Badge showing approved (green), pending (yellow), or failed (red) status",
            "quality_score_indicator": "Circular progress showing 0-100 quality score for how well AI template matches original PDF",
        },
    },
    "/templates/new": {
        "feature": "Template Creator / Intelligence Canvas",
        "description": (
            "The unified template creation experience. This is a 3-panel layout: "
            "left panel for PDF upload and preview, center panel for AI chat interaction, "
            "and right panel for the generated HTML canvas. The AI guides users through "
            "the entire template creation workflow."
        ),
        "key_actions": [
            "Upload a sample PDF in the left panel",
            "Describe the template you need via the chat panel",
            "Preview the AI-generated HTML in the right canvas",
            "Review extracted tokens and their types (scalar vs row)",
            "Map tokens to database columns",
            "Approve the template for report generation",
        ],
        "common_issues": [
            "PDF upload fails — check file size (max 10MB) and format",
            "OCR extraction produces garbage text — PDF may be image-based, needs higher quality scan",
            "Generated HTML looks different from PDF — try refining via chat with specific instructions",
            "Token extraction misses some fields — manually add tokens or re-run extraction",
            "Mapping suggestions are wrong — the AI maps by column name similarity, manually correct mismatches",
        ],
        "related_routes": ["/templates", "/connections", "/reports"],
        "workflow_stages": [
            "1. Upload: Upload a sample PDF that represents the desired report format",
            "2. OCR/Extraction: AI uses vision model (GLM-OCR) to read text from the PDF",
            "3. HTML Generation: AI (Qwen3.5-27B) generates an HTML template matching the PDF layout",
            "4. Token Extraction: AI identifies data placeholders and creates token schema",
            "5. Mapping: Tokens are mapped to actual database columns from the active connection",
            "6. Contract Building: A mapping contract is built linking tokens to SQL queries",
            "7. Dry Run: A test report is generated to validate the template",
            "8. Approval: User approves the template for production report generation",
        ],
        "concepts": {
            "intelligence_canvas": "The AI-powered template creation workspace with chat, preview, and extraction tools",
            "extraction_mode": "The phase where AI extracts text and structure from the uploaded PDF",
            "mapping_mode": "The phase where tokens are matched to database columns",
            "validation_mode": "The phase where the template is tested against real data",
            "diff_mode": "Side-by-side comparison of original PDF and generated template",
            "auto_trigger": "Automatic progression through workflow stages based on available data",
            "mapping_confidence": "A score indicating how confident the AI is in a token-to-column mapping",
        },
        "ui_elements": {
            "left_panel": "PDF upload area and preview panel — shows the original PDF and reference image",
            "center_panel": "AI chat interface — describe your template, ask questions, or request changes",
            "right_panel_canvas": "Intelligence Canvas — shows AI-generated cards for extraction, mapping, validation, diff, data preview, and insights",
            "upload_dropzone": "Drag-and-drop zone for uploading a sample PDF (or click to browse files)",
            "chat_input": "Text input at bottom of center panel for chatting with the template AI",
            "extraction_card": "Canvas card showing OCR extraction results — detected text, tables, and layout structure",
            "mapping_card": "Canvas card showing token → column mappings with confidence scores and editable dropdowns",
            "validation_card": "Canvas card showing readiness score, validation issues, and fix suggestions",
            "diff_card": "Canvas card showing before/after HTML comparison when template is edited",
            "data_preview_card": "Canvas card showing a preview of the report with real data from the active connection",
            "token_chips": "Clickable chips representing each extracted token — click to see details and mapping",
            "approve_button": "'Approve Template' button — finalizes the template for report generation (requires all tokens mapped)",
            "readiness_meter": "Circular gauge showing 0-100% readiness — all issues must be resolved before approval",
            "agent_results_cards": "Cards showing results from AI agents: Template QA, Data Quality, Anomaly Detection, etc.",
        },
    },
    "/reports": {
        "feature": "Report Generation",
        "description": (
            "Generate reports by combining an approved template with a database connection. "
            "Users select a template, connection, and date range, then generate PDF or Excel "
            "reports. Reports can be generated synchronously (wait for result) or "
            "asynchronously (queued as a background job)."
        ),
        "key_actions": [
            "Select a template and connection for report generation",
            "Set date range or parameters for the report",
            "Generate a report (PDF or Excel)",
            "Download generated report artifacts",
            "View report generation history",
            "Queue an async report generation job",
        ],
        "common_issues": [
            "No approved templates — user needs to create and approve a template first",
            "No active connection — user needs to select a database connection",
            "Report generation fails with 'missing mapping keys' — template tokens don't match database columns",
            "No data returned for date range — check that data exists in the database for the specified dates",
            "Report generation timeout — may indicate slow database query or LLM overload",
            "Excel format issues — check that the template is compatible with Excel export",
        ],
        "related_routes": ["/templates", "/connections", "/jobs", "/schedules"],
        "concepts": {
            "run_id": "Unique identifier for each report generation run",
            "artifacts": "The generated output files (PDF, Excel, HTML) from a report run",
            "async_generation": "Queuing a report as a background job instead of waiting for it synchronously",
        },
        "ui_elements": {
            "template_selector": "Dropdown to choose an approved template for report generation",
            "connection_selector": "Dropdown to choose a database connection (defaults to active connection)",
            "date_range_picker": "Date range selector for filtering report data (start/end dates)",
            "generate_button": "'Generate Report' button — starts report generation with selected options",
            "format_toggle": "Toggle between PDF and Excel output format",
            "progress_bar": "Shows real-time progress during report generation (stages: query → render → generate)",
            "download_button": "Download button for completed report artifacts (PDF, Excel, HTML)",
            "history_table": "Table showing recent report generation runs with status, template, date, and download links",
        },
    },
    "/schedules": {
        "feature": "Report Schedules",
        "description": (
            "Schedule automatic report generation at recurring intervals. Users can set up "
            "daily, weekly, monthly, or custom cron-based schedules that automatically generate "
            "reports and optionally email them to recipients."
        ),
        "key_actions": [
            "Create a new schedule (select template, connection, frequency)",
            "Edit an existing schedule's timing or parameters",
            "Enable or disable a schedule",
            "View schedule execution history",
            "Delete a schedule",
            "Set email recipients for scheduled reports",
        ],
        "common_issues": [
            "Schedule not running — check if the scheduler service is enabled (NEURA_SCHEDULER_DISABLED)",
            "Schedule runs but report fails — check the underlying template and connection are still valid",
            "Email not sent — check SMTP configuration in settings",
            "Wrong timezone — schedule times are in the server's timezone",
        ],
        "related_routes": ["/reports", "/templates", "/connections", "/jobs", "/settings"],
        "concepts": {
            "cron_expression": "A cron-format string defining when the schedule runs (e.g. '0 9 * * MON' for every Monday at 9am)",
            "schedule_interval": "How often the scheduler checks for due schedules (configurable via NEURA_SCHEDULER_INTERVAL)",
        },
    },
    "/jobs": {
        "feature": "Jobs / Background Tasks",
        "description": (
            "View and manage background jobs including report generation, data processing, "
            "and agent tasks. Jobs show real-time progress, status, and allow cancellation "
            "or retry of failed jobs."
        ),
        "key_actions": [
            "View all jobs with status filters (pending, running, completed, failed)",
            "Cancel a running job",
            "Retry a failed job",
            "View job details including error messages and progress",
            "View the Dead Letter Queue (DLQ) for permanently failed jobs",
            "Requeue a job from the DLQ",
        ],
        "common_issues": [
            "Job stuck in 'pending' — may indicate worker is busy or not running",
            "Job failed with timeout — the operation took too long, try with smaller data",
            "Job failed with 'connection refused' — database or LLM service may be down",
            "Many jobs in DLQ — check system health and underlying service availability",
        ],
        "related_routes": ["/reports", "/agents", "/ops"],
        "concepts": {
            "job_status": "States: pending → running → completed/failed. Failed jobs may be retryable.",
            "dead_letter_queue": "A queue for jobs that have failed all retry attempts and need manual intervention",
            "progress_tracking": "Real-time progress percentage and step information for running jobs",
        },
        "ui_elements": {
            "status_filter_tabs": "Tabs to filter jobs: All, Pending, Running, Completed, Failed",
            "job_row": "Each job row shows: template name, status badge, progress bar, created time, and action buttons",
            "retry_button": "'Retry' button on failed jobs — re-queues the job with the same parameters",
            "cancel_button": "'Cancel' button on running/pending jobs — stops the job",
            "expand_details": "Click a job row to expand and see error message, parameters, and execution timeline",
            "dlq_tab": "'Dead Letter Queue' tab — shows permanently failed jobs with 'Requeue' buttons",
            "pipeline_tracker": "Visual step indicator showing pipeline stages (verify → extract → analyze → merge → execute → render → generate)",
        },
    },
    # -------------------------------------------------------------------------
    # AI Features
    # -------------------------------------------------------------------------
    "/query": {
        "feature": "Query Builder / NL2SQL",
        "description": (
            "Natural Language to SQL query builder. Users type questions in plain English "
            "and the AI generates SQL queries against the active database connection. "
            "Results can be previewed, saved, and used in reports."
        ),
        "key_actions": [
            "Type a natural language question to generate SQL",
            "Review and edit the generated SQL query",
            "Execute the query and preview results",
            "Save a query for reuse",
            "Export query results",
        ],
        "common_issues": [
            "No active connection — user must select a database connection first",
            "Generated SQL is incorrect — try rephrasing the question with more specific column/table names",
            "Query returns no results — check that the data exists and the WHERE clause is correct",
            "Query timeout — the generated SQL may be too complex, try simplifying",
            "SQL injection warning — the system validates queries for safety before execution",
        ],
        "related_routes": ["/connections", "/analyze"],
        "concepts": {
            "nl2sql": "Natural Language to SQL — converting plain English questions into database queries",
            "schema_context": "The AI uses the database schema (tables, columns, types) to generate accurate SQL",
        },
    },
    "/enrichment": {
        "feature": "Data Enrichment",
        "description": (
            "Enrich data with additional information from external sources or AI-powered "
            "analysis. Configure enrichment rules to automatically augment data in reports "
            "or queries with additional context."
        ),
        "key_actions": [
            "Configure enrichment sources",
            "Set up enrichment rules for specific data fields",
            "Preview enriched data before applying",
            "View enrichment cache statistics",
        ],
        "common_issues": [
            "Enrichment is slow — check cache settings and external source availability",
            "Enrichment returns empty results — verify the source configuration and API keys",
        ],
        "related_routes": ["/connections", "/reports", "/analyze"],
        "concepts": {
            "enrichment_source": "An external data provider or AI model used to augment data",
            "enrichment_cache": "Cached enrichment results to avoid repeated API calls",
        },
    },
    "/federation": {
        "feature": "Schema Federation",
        "description": (
            "Build federated schemas across multiple database connections. Allows querying "
            "and joining data from different databases as if they were a single source."
        ),
        "key_actions": [
            "Select multiple connections to federate",
            "Define virtual schema mappings",
            "Run federated queries across databases",
            "Create join relationships between tables from different sources",
        ],
        "common_issues": [
            "Federation query fails — one of the source connections may be down",
            "Join results are empty — check that the join keys match between databases",
            "Performance issues — federated queries are slower than single-database queries",
        ],
        "related_routes": ["/connections", "/query"],
        "concepts": {
            "virtual_schema": "A unified view of tables from multiple databases that can be queried together",
            "federated_query": "A query that spans multiple database connections",
        },
    },
    "/synthesis": {
        "feature": "Document Synthesis",
        "description": (
            "Combine and synthesize information from multiple documents into a unified "
            "analysis. Upload multiple documents and ask the AI to find patterns, "
            "contradictions, or create summaries across all of them."
        ),
        "key_actions": [
            "Create a synthesis session",
            "Add documents to the session",
            "Ask synthesis questions across all documents",
            "Export synthesis results",
        ],
        "common_issues": [
            "Synthesis takes too long — try with fewer or smaller documents",
            "Results don't reference all documents — the AI may focus on the most relevant ones",
        ],
        "related_routes": ["/docqa", "/summary", "/documents"],
        "concepts": {
            "synthesis_session": "A workspace where multiple documents are analyzed together",
            "cross_document_analysis": "Finding patterns and insights across multiple documents",
        },
    },
    "/docqa": {
        "feature": "Document Q&A",
        "description": (
            "Chat-based question answering over uploaded documents. Upload a document "
            "(PDF, DOCX, etc.) and ask questions about its content. The AI uses RAG "
            "(Retrieval Augmented Generation) to find relevant passages and answer accurately."
        ),
        "key_actions": [
            "Create a new Q&A session",
            "Upload a document to the session",
            "Ask questions about the document content",
            "View source passages for each answer",
            "Export the Q&A conversation",
        ],
        "common_issues": [
            "Answer seems incorrect — try rephrasing the question or being more specific",
            "Document upload fails — check file size and format (PDF, DOCX, TXT supported)",
            "'No relevant content found' — the document may not contain information about the question",
        ],
        "related_routes": ["/synthesis", "/summary", "/documents", "/knowledge"],
        "concepts": {
            "rag": "Retrieval Augmented Generation — finding relevant document passages before generating an answer",
            "source_passages": "The specific text segments from the document that the AI used to answer",
        },
    },
    "/summary": {
        "feature": "Document Summarization",
        "description": (
            "Generate concise summaries of documents or text. Supports different "
            "summary lengths and styles (executive summary, bullet points, etc.)."
        ),
        "key_actions": [
            "Upload a document to summarize",
            "Paste text for summarization",
            "Choose summary length and style",
            "Export the generated summary",
        ],
        "common_issues": [
            "Summary is too generic — try selecting a more specific focus area",
            "Summary misses key points — the document may be too long, try summarizing sections",
        ],
        "related_routes": ["/docqa", "/synthesis", "/documents"],
        "concepts": {},
    },
    "/agents": {
        "feature": "AI Agents",
        "description": (
            "Run specialized AI agents for various tasks: research, data analysis, "
            "email drafting, content repurposing, proofreading, and report analysis. "
            "Each agent has specific capabilities and can run tasks in the background "
            "with real-time progress tracking."
        ),
        "key_actions": [
            "Select an agent type (research, data analyst, email draft, etc.)",
            "Configure agent parameters and input",
            "Run an agent task (sync or async)",
            "View task progress in real-time",
            "View completed task results",
            "Cancel a running agent task",
            "Retry a failed task",
        ],
        "common_issues": [
            "Agent task is slow — research and analysis agents may take 2-5 minutes for comprehensive tasks",
            "Agent task failed — check the error message, may indicate LLM overload or timeout",
            "Results seem generic — provide more specific input and focus areas",
        ],
        "related_routes": ["/jobs", "/reports"],
        "concepts": {
            "agent_types": "Research, Data Analyst, Email Draft, Content Repurpose, Proofreading, Report Analyst",
            "agent_task": "A background task executed by an AI agent with progress tracking and persistence",
            "idempotency_key": "A unique key that prevents duplicate task execution",
        },
    },
    "/analyze": {
        "feature": "Enhanced Analysis",
        "description": (
            "Upload data files for AI-powered analysis including chart suggestions, "
            "anomaly detection, correlation analysis, trend detection, and forecasting. "
            "The AI automatically suggests the best visualizations for your data."
        ),
        "key_actions": [
            "Upload a data file (CSV, Excel) for analysis",
            "View AI-suggested charts and visualizations",
            "Run anomaly detection on the data",
            "Find correlations between data columns",
            "Generate trend analysis and forecasts",
            "Export analysis results",
        ],
        "common_issues": [
            "No chart suggestions — the data may need column headers or more rows",
            "Anomaly detection finds nothing — the data may not have significant outliers",
            "Analysis is slow — large files take longer, try with a subset first",
        ],
        "related_routes": ["/visualization", "/query", "/charts"],
        "concepts": {
            "anomaly_detection": "AI identifies unusual data points that deviate from expected patterns",
            "correlation_analysis": "Finding statistical relationships between data columns",
            "trend_analysis": "Detecting upward, downward, or seasonal trends in time-series data",
        },
    },
    # -------------------------------------------------------------------------
    # Document Tools
    # -------------------------------------------------------------------------
    "/documents": {
        "feature": "Document Editor",
        "description": (
            "Rich text document editor powered by TipTap with real-time collaboration "
            "via Yjs. Create, edit, and collaborate on documents with formatting, "
            "comments, version history, and AI-powered writing assistance."
        ),
        "key_actions": [
            "Create a new document",
            "Edit document content with rich formatting",
            "Add comments and annotations",
            "Collaborate in real-time with other users",
            "Export document to PDF, DOCX, or HTML",
            "Use AI writing assistance (grammar, style, rewrite)",
            "View version history",
        ],
        "common_issues": [
            "Collaboration not working — check WebSocket connection status",
            "Formatting lost on export — some advanced formatting may not export perfectly",
            "Document won't save — check network connectivity",
        ],
        "related_routes": ["/docqa", "/synthesis", "/summary", "/export"],
        "concepts": {},
    },
    "/spreadsheets": {
        "feature": "Spreadsheet Editor",
        "description": (
            "Full-featured spreadsheet editor powered by Handsontable. Create and edit "
            "spreadsheets with formulas, formatting, pivot tables, and AI-powered "
            "formula suggestions."
        ),
        "key_actions": [
            "Create a new spreadsheet",
            "Edit cells with formulas and formatting",
            "Create pivot tables from data",
            "Use AI to generate formulas",
            "Add conditional formatting rules",
            "Export to Excel or CSV",
            "Import data from database queries",
        ],
        "common_issues": [
            "Formula not working — check syntax, use = prefix for formulas",
            "Pivot table shows wrong data — verify row/column/value field selections",
            "Import failed — check data format and size",
        ],
        "related_routes": ["/query", "/analyze", "/export"],
        "concepts": {
            "ai_formula": "AI-generated spreadsheet formulas based on natural language description",
            "pivot_table": "A data summarization tool that groups and aggregates data",
        },
    },
    "/dashboard-builder": {
        "feature": "Dashboard Builder",
        "description": (
            "Build interactive dashboards with drag-and-drop widgets. Connect widgets "
            "to data sources, configure visualizations, and share dashboards with "
            "filters and variables."
        ),
        "key_actions": [
            "Create a new dashboard",
            "Add widgets (charts, KPIs, tables, text)",
            "Configure widget data sources",
            "Set up dashboard-level filters and variables",
            "Arrange widget layout with drag-and-drop",
            "Share dashboard with other users",
            "Export dashboard as PDF or image",
        ],
        "common_issues": [
            "Widget shows no data — check the data source connection and query",
            "Layout breaks on mobile — adjust widget sizes for responsive design",
            "Filters not working — ensure widgets are connected to the filter variable",
        ],
        "related_routes": ["/visualization", "/connections", "/query"],
        "concepts": {
            "widget": "A visual component on a dashboard (chart, KPI card, table, etc.)",
            "dashboard_filter": "A user-controllable filter that affects multiple widgets",
            "dashboard_variable": "A dynamic parameter that widgets can reference",
        },
    },
    "/connectors": {
        "feature": "Data Connectors",
        "description": (
            "Connect to external services and APIs beyond databases. Includes connectors "
            "for cloud storage, SaaS applications, and third-party data sources."
        ),
        "key_actions": [
            "Browse available connectors",
            "Authenticate with a connector (OAuth, API key)",
            "Configure connector settings",
            "Test connector connectivity",
            "Sync data from connected services",
        ],
        "common_issues": [
            "OAuth authentication fails — check redirect URLs and client credentials",
            "Connector sync is slow — large datasets take time, check rate limits",
            "Data format mismatch — some connectors may need field mapping",
        ],
        "related_routes": ["/connections", "/ingestion"],
        "concepts": {
            "connector": "An integration with an external service (different from a direct database connection)",
            "sync_schedule": "Automated periodic data synchronization from a connector",
        },
    },
    "/workflows": {
        "feature": "Workflow Builder",
        "description": (
            "Build automated workflows that chain multiple actions together. "
            "Visual node-based editor for creating data processing pipelines, "
            "report generation chains, and automated notifications."
        ),
        "key_actions": [
            "Create a new workflow",
            "Add workflow nodes (data fetch, transform, generate, notify)",
            "Connect nodes with edges to define execution order",
            "Configure triggers (schedule, webhook, manual)",
            "Test/debug a workflow with sample data",
            "Execute a workflow",
            "View workflow execution history",
        ],
        "common_issues": [
            "Workflow fails at a specific node — check that node's configuration and input data",
            "Trigger not firing — verify trigger configuration (cron, webhook URL, etc.)",
            "Execution order wrong — check edge connections between nodes",
        ],
        "related_routes": ["/schedules", "/reports", "/connectors"],
        "concepts": {
            "workflow_node": "A single step in a workflow (e.g., fetch data, generate report, send email)",
            "workflow_trigger": "What starts a workflow (schedule, webhook, or manual execution)",
            "workflow_edge": "A connection between two nodes defining execution order",
        },
    },
    # -------------------------------------------------------------------------
    # New Feature Pages
    # -------------------------------------------------------------------------
    "/visualization": {
        "feature": "Visualization Builder",
        "description": (
            "Create standalone data visualizations and charts. Supports bar charts, "
            "line charts, pie charts, scatter plots, heatmaps, and more via ECharts."
        ),
        "key_actions": [
            "Select a chart type",
            "Configure data source and axes",
            "Customize colors, labels, and legends",
            "Export chart as image or embed code",
        ],
        "common_issues": [
            "Chart looks empty — check that data columns are correctly mapped to axes",
            "Colors don't match brand — use the Design page to set brand colors",
        ],
        "related_routes": ["/analyze", "/dashboard-builder", "/design"],
        "concepts": {},
    },
    "/knowledge": {
        "feature": "Knowledge Library",
        "description": (
            "Manage a searchable knowledge base of documents, templates, and data. "
            "Organize documents into collections, add tags, and use semantic search "
            "to find relevant information."
        ),
        "key_actions": [
            "Add documents to the knowledge library",
            "Create and manage collections",
            "Search documents with semantic search",
            "Tag and categorize documents",
            "View document recommendations",
        ],
        "common_issues": [
            "Search returns no results — try different keywords or use semantic search",
            "Document not indexed — indexing may take a moment after upload",
        ],
        "related_routes": ["/docqa", "/synthesis", "/search"],
        "concepts": {
            "semantic_search": "AI-powered search that understands meaning, not just keyword matching",
            "collection": "A group of related documents in the knowledge library",
        },
    },
    "/design": {
        "feature": "Design / Brand Kit",
        "description": (
            "Configure brand identity including colors, fonts, and design guidelines "
            "that are applied to generated reports and exports."
        ),
        "key_actions": [
            "Set brand colors (primary, secondary, accent)",
            "Configure font pairings",
            "Upload logo",
            "Preview brand kit on sample report",
            "Apply brand kit to all templates",
        ],
        "common_issues": [
            "Brand colors not showing in reports — the template must reference brand variables",
            "Font not available — only web-safe fonts are guaranteed in PDF exports",
        ],
        "related_routes": ["/templates", "/reports", "/visualization"],
        "concepts": {
            "brand_kit": "A set of colors, fonts, and design elements that define your organization's visual identity",
        },
    },
    "/ingestion": {
        "feature": "Data Ingestion",
        "description": (
            "Ingest data from various sources: folder watchers, email attachments, "
            "web clipping, and structured data feeds. Automate data collection for "
            "report generation."
        ),
        "key_actions": [
            "Set up a folder watcher for automatic file ingestion",
            "Configure email ingestion (IMAP)",
            "Clip web pages for data extraction",
            "Ingest structured data (JSON, CSV)",
            "View ingestion history and status",
        ],
        "common_issues": [
            "Folder watcher not detecting files — check directory permissions and path",
            "Email ingestion fails — verify IMAP credentials and server settings",
            "Web clipper returns empty — the page may block scraping",
        ],
        "related_routes": ["/connectors", "/documents", "/knowledge"],
        "concepts": {
            "folder_watcher": "A background service that monitors a directory for new files and automatically processes them",
            "web_clipper": "A tool to capture and extract content from web pages",
        },
    },
    "/search": {
        "feature": "Global Search",
        "description": (
            "Search across all entities in NeuraReport — templates, reports, documents, "
            "connections, jobs, and more. Supports keyword and semantic search."
        ),
        "key_actions": [
            "Search for templates, reports, or documents by name or content",
            "Filter results by type",
            "Save searches for quick access",
        ],
        "common_issues": [],
        "related_routes": ["/knowledge", "/templates", "/documents"],
        "concepts": {},
    },
    # -------------------------------------------------------------------------
    # Admin / System Pages
    # -------------------------------------------------------------------------
    "/settings": {
        "feature": "Settings",
        "description": (
            "Configure application settings including user preferences, SMTP email "
            "settings, API keys, display preferences, and system configuration."
        ),
        "key_actions": [
            "Configure SMTP settings for email delivery",
            "Set display preferences (compact tables, theme)",
            "Manage API keys",
            "View system configuration",
        ],
        "common_issues": [
            "SMTP test fails — check server address, port, and credentials",
            "Settings not saving — check browser localStorage availability",
        ],
        "related_routes": ["/schedules", "/ops"],
        "concepts": {},
    },
    "/activity": {
        "feature": "Activity Log",
        "description": (
            "View a chronological log of all actions performed in NeuraReport — "
            "template creation, report generation, connection changes, and more. "
            "Useful for auditing and tracking who did what."
        ),
        "key_actions": [
            "View recent activity timeline",
            "Filter by action type or user",
            "Export activity log",
        ],
        "common_issues": [],
        "related_routes": ["/jobs", "/ops"],
        "concepts": {},
    },
    "/stats": {
        "feature": "Usage Statistics",
        "description": (
            "View usage analytics including LLM token usage, report generation counts, "
            "API call statistics, and cost tracking."
        ),
        "key_actions": [
            "View token usage over time",
            "Check generation costs",
            "Monitor API call rates",
            "Export statistics",
        ],
        "common_issues": [],
        "related_routes": ["/ops", "/activity"],
        "concepts": {},
    },
    "/ops": {
        "feature": "Operations Console",
        "description": (
            "System operations dashboard showing health status, LLM provider status, "
            "database connectivity, background service status, and system warnings. "
            "Used for monitoring and debugging system issues."
        ),
        "key_actions": [
            "Check system health status",
            "View LLM provider availability and circuit breaker states",
            "Monitor background service status (scheduler, recovery daemon, workers)",
            "View recent errors and warnings",
            "Check database connectivity",
            "View token usage statistics",
        ],
        "common_issues": [
            "LLM provider showing 'unavailable' — check that vLLM/LiteLLM is running",
            "Circuit breaker is 'open' — too many recent failures, will auto-reset after timeout",
            "Scheduler not running — check NEURA_SCHEDULER_DISABLED environment variable",
            "High error rate — check the error log for root cause",
        ],
        "related_routes": ["/jobs", "/settings", "/stats"],
        "concepts": {
            "circuit_breaker": "A fault-tolerance mechanism that stops sending requests to a failing service to let it recover",
            "health_check": "Automated checks for system component availability (database, LLM, storage)",
            "recovery_daemon": "A background service that retries failed jobs and recovers stale tasks",
        },
    },
    "/setup/wizard": {
        "feature": "Setup Wizard",
        "description": (
            "First-time setup guide that walks users through the initial configuration: "
            "adding a database connection, uploading a sample template, and generating "
            "their first report."
        ),
        "key_actions": [
            "Add your first database connection",
            "Upload a sample PDF to create a template",
            "Map template tokens to database columns",
            "Generate your first test report",
        ],
        "common_issues": [
            "Stuck on connection step — make sure the database is accessible from this machine",
            "PDF upload fails — check file size and format",
            "No tables found — the database may be empty or user lacks permissions",
        ],
        "related_routes": ["/connections", "/templates", "/reports"],
        "concepts": {},
    },
    # -------------------------------------------------------------------------
    # Parameterized routes (matched by prefix)
    # -------------------------------------------------------------------------
    "/templates/edit": {
        "feature": "Template Editor",
        "description": (
            "Edit an existing template's HTML, tokens, and data mappings. "
            "Includes a chat interface for AI-assisted editing and a live HTML preview."
        ),
        "key_actions": [
            "Edit template HTML directly",
            "Use AI chat to describe changes",
            "Preview changes in real-time",
            "Update token mappings",
            "Save template changes",
        ],
        "common_issues": [
            "Changes not reflecting in preview — try clicking 'Refresh Preview'",
            "AI suggestions are wrong — be more specific in your chat instructions",
            "Token added but not mapped — go to mapping view to connect it to a database column",
        ],
        "related_routes": ["/templates", "/connections", "/reports"],
        "concepts": {},
    },
    "/history": {
        "feature": "Version History",
        "description": "Browse version history of templates and documents.",
        "key_actions": ["View previous versions", "Compare versions", "Restore a version"],
        "common_issues": [],
        "related_routes": ["/templates", "/documents"],
        "concepts": {},
    },
    "/widgets": {
        "feature": "Widget Gallery",
        "description": (
            "Browse and configure dashboard widgets. Each widget type (KPI, chart, "
            "table, narrative, alert) has specific data requirements and configuration options."
        ),
        "key_actions": [
            "Browse available widget types",
            "Preview widget with sample data",
            "Add widget to a dashboard",
            "Configure widget data source and display options",
        ],
        "common_issues": [
            "Widget shows no data — check the data source binding",
        ],
        "related_routes": ["/dashboard-builder", "/visualization"],
        "concepts": {},
    },
    "/logger": {
        "feature": "Logger",
        "description": "Client-side logging and device log viewing for debugging.",
        "key_actions": ["View client-side logs", "Filter by severity", "Export logs"],
        "common_issues": [],
        "related_routes": ["/ops"],
        "concepts": {},
    },
}


def lookup_route_knowledge(route: str) -> Dict[str, Any]:
    """Look up product knowledge for a given route.

    Tries exact match first, then prefix match for parameterized routes
    like /templates/:id/edit.
    """
    # Exact match
    if route in PRODUCT_KNOWLEDGE:
        return PRODUCT_KNOWLEDGE[route]

    # Prefix match (for parameterized routes like /templates/abc123/edit)
    # Try progressively shorter prefixes
    for known_route, knowledge in PRODUCT_KNOWLEDGE.items():
        # Handle /templates/:id/edit style
        if known_route.endswith("/edit") and route.endswith("/edit"):
            base = known_route.rsplit("/edit", 1)[0]
            if route.startswith(base):
                return knowledge

    # Generic prefix match
    best_match: Optional[Dict[str, Any]] = None
    best_len = 0
    for known_route, knowledge in PRODUCT_KNOWLEDGE.items():
        if route.startswith(known_route) and len(known_route) > best_len:
            best_match = knowledge
            best_len = len(known_route)

    if best_match:
        return best_match

    # Fallback
    return {
        "feature": "NeuraReport",
        "description": "NeuraReport V2 is a report generation platform.",
        "key_actions": [],
        "common_issues": [],
        "related_routes": ["/"],
        "concepts": {},
    }



# ── Originally: prompts.py ──

"""System prompt assembly for the NeuraReport in-product assistant.

Builds a layered system prompt from:
1. Base persona (constant)
2. Feature grounding (per-route from knowledge.py)
3. Live session context (per-request from frontend)
4. Mode instruction (per-request)
"""

import re
from typing import Any, Dict, List, Optional, Tuple

BASE_PERSONA = """\
You are the NeuraReport product assistant built into the application. \
You help users understand and use NeuraReport V2 — a report generation \
platform that connects to databases, uses AI to create and map report \
templates, and generates PDF/Excel reports.

Rules:
- Only answer about NeuraReport features and workflows.
- Be concise: 2-4 short paragraphs unless the user asks for step-by-step instructions.
- Be actionable: tell the user exactly what to click or do next.
- Never fabricate features that do not exist in NeuraReport.
- If you are uncertain or the information is not available, say so clearly.
- Reference the user's current page and state when relevant.
- When giving step-by-step instructions, number each step.

At the end of every response, suggest 2-3 short follow-up questions the user \
might ask next. Format them on the last line as:
[FOLLOW_UPS: "question one" | "question two" | "question three"]
Do NOT include this line inside your main answer text."""

MODE_INSTRUCTIONS: Dict[str, str] = {
    "auto": (
        "Detect the user's intent (explain, how-to, troubleshoot, coaching, "
        "or domain question) and respond appropriately."
    ),
    "explain": (
        "The user wants an explanation. Explain what this feature/page/concept "
        "does and when to use it. Be clear and educational."
    ),
    "howto": (
        "The user wants step-by-step instructions. Number each step. "
        "Be specific about button names, menu locations, and field labels."
    ),
    "troubleshoot": (
        "The user has a problem. Help diagnose the issue. Check the error "
        "messages and state provided in the context. Suggest specific fixes."
    ),
    "coaching": (
        "Guide the user through the optimal workflow. Suggest the best next "
        "action based on their current state. Mention best practices."
    ),
    "domain": (
        "Explain the domain concept (data connections, templates, tokens, "
        "report generation, etc.) in the context of NeuraReport."
    ),
    "action": (
        "The user wants to perform an action. If you can suggest navigation "
        'or steps, include an action line at the end like: '
        '[ACTION: {"type":"navigate","path":"/connections","label":"Go to Connections"}]'
    ),
}


def _format_feature_grounding(knowledge: Dict[str, Any]) -> str:
    """Format a knowledge entry into a grounding paragraph for the system prompt."""
    parts: list[str] = []

    feature = knowledge.get("feature", "")
    desc = knowledge.get("description", "")
    if feature and desc:
        parts.append(f"The user is on the {feature} page. {desc}")

    actions = knowledge.get("key_actions", [])
    if actions:
        parts.append("Available actions: " + "; ".join(actions) + ".")

    issues = knowledge.get("common_issues", [])
    if issues:
        parts.append("Common issues: " + "; ".join(issues[:4]) + ".")

    stages = knowledge.get("workflow_stages", [])
    if stages:
        parts.append("Workflow stages:\n" + "\n".join(stages))

    concepts = knowledge.get("concepts", {})
    if concepts:
        concept_lines = [f"- {k}: {v}" for k, v in concepts.items()]
        parts.append("Key concepts:\n" + "\n".join(concept_lines))

    ui_elements = knowledge.get("ui_elements", {})
    if ui_elements:
        ui_lines = [f"- {k}: {v}" for k, v in ui_elements.items()]
        parts.append("UI elements on this page:\n" + "\n".join(ui_lines))

    related = knowledge.get("related_routes", [])
    if related:
        parts.append("Related pages: " + ", ".join(related) + ".")

    return "\n\n".join(parts)


def _format_live_context(context: Dict[str, Any]) -> str:
    """Format the live frontend context into a context block.

    Handles the enriched context from useAssistantContext which includes
    deep state from template creator, documents, spreadsheets, dashboards,
    connectors, workflows, and pipelines.
    """
    lines: list[str] = ["Current session state:"]

    route = context.get("route", "")
    if route:
        lines.append(f"- Page: {route}")

    page_title = context.get("page_title", "")
    if page_title:
        lines.append(f"- Page title: {page_title}")

    # Selected entities
    entities = context.get("selected_entities", {})
    for key, value in entities.items():
        if value and value is not True:
            label = key.replace("_", " ").replace("Id", " ID")
            lines.append(f"- {label}: {value}")

    # Workflow / setup state
    state = context.get("workflow_state", {})
    setup_step = state.get("setupStep")
    if setup_step:
        lines.append(f"- Setup step: {setup_step}")
    conn_count = state.get("connectionCount", 0)
    tmpl_count = state.get("templateCount", 0)
    lines.append(f"- Connections: {conn_count}, Templates: {tmpl_count}")

    jobs_summary = state.get("jobs")
    if jobs_summary and isinstance(jobs_summary, dict):
        parts = []
        if jobs_summary.get("running"):
            parts.append(f"{jobs_summary['running']} running")
        if jobs_summary.get("failed"):
            parts.append(f"{jobs_summary['failed']} failed")
        if jobs_summary.get("pending"):
            parts.append(f"{jobs_summary['pending']} pending")
        if parts:
            lines.append(f"- Jobs: {', '.join(parts)} (of {jobs_summary.get('total', 0)} total)")
            for fj in (jobs_summary.get("recentFailed") or []):
                err = fj.get("error", "unknown error")
                name = fj.get("templateName", fj.get("id", ""))
                lines.append(f"  - Failed job '{name}': {err}")

    pipelines = state.get("pipelines")
    if pipelines:
        for p in pipelines:
            lines.append(
                f"- Active pipeline: {p.get('type', 'unknown')} "
                f"({p.get('progress', 0)}% complete, "
                f"stage: {p.get('currentStage', 'starting')})"
            )
            if p.get("stagesSummary"):
                lines.append(f"  Stages: {p['stagesSummary']}")

    # Template Creator / Intelligence Canvas state
    tc = context.get("template_creator")
    if tc and isinstance(tc, dict):
        lines.append("")
        lines.append("Intelligence Canvas state:")
        if tc.get("templateName"):
            lines.append(f"- Template: {tc['templateName']} ({tc.get('templateKind', 'pdf')})")
        lines.append(f"- Source mode: {tc.get('sourceMode', 'upload')}")
        lines.append(f"- Has HTML design: {tc.get('hasHtml', False)}")
        if tc.get("ssimScore") is not None:
            lines.append(f"- Visual similarity (SSIM): {tc['ssimScore']}")
        lines.append(f"- Canvas mode: {tc.get('canvasMode', 'auto')}")
        tokens = tc.get("tokens", {})
        if tokens.get("total"):
            lines.append(
                f"- Tokens: {tokens['total']} total, "
                f"{tokens.get('mapped', 0)} mapped, "
                f"{tokens.get('unmapped', 0)} unmapped"
            )
        if tc.get("avgMappingConfidence") is not None:
            lines.append(f"- Avg mapping confidence: {tc['avgMappingConfidence']}")
        if tc.get("readinessScore"):
            lines.append(f"- Readiness score: {tc['readinessScore']}%")
        lines.append(f"- Has contract: {tc.get('hasContract', False)}")
        lines.append(f"- Has dry run: {tc.get('hasDryRun', False)}")
        if tc.get("dryRunSuccess") is not None:
            lines.append(f"- Dry run success: {tc['dryRunSuccess']}")
        lines.append(f"- Finalized: {tc.get('finalized', False)}")
        issues = tc.get("validationIssues", [])
        if issues:
            lines.append(f"- Validation issues ({len(issues)}):")
            for iss in issues:
                lines.append(f"  - [{iss.get('severity', '?')}] {iss.get('message', '')}")
        if tc.get("selectedToken"):
            lines.append(f"- User is looking at token: {tc['selectedToken']}")
        if tc.get("selectedIssue"):
            lines.append(f"- User is looking at issue: {tc['selectedIssue']}")
        agents = tc.get("activeAgentResults", [])
        if agents:
            lines.append(f"- Agent results available: {', '.join(agents)}")
        if tc.get("error"):
            lines.append(f"- Template creator error: {tc['error']}")

    # Document editor state
    doc = context.get("document")
    if doc and isinstance(doc, dict):
        lines.append("")
        lines.append("Document editor state:")
        lines.append(f"- Document: {doc.get('title', 'Untitled')}")
        if doc.get("category"):
            lines.append(f"- Category: {doc['category']}")
        lines.append(f"- Has content: {doc.get('hasContent', False)}")
        lines.append(f"- Comments: {doc.get('commentCount', 0)}, Collaborators: {doc.get('collaboratorCount', 0)}")
        if doc.get("saving"):
            lines.append("- Currently saving")
        if doc.get("lastAiAction"):
            lines.append(f"- Last AI action: {doc['lastAiAction']}")

    # Spreadsheet editor state
    ss = context.get("spreadsheet")
    if ss and isinstance(ss, dict):
        lines.append("")
        lines.append("Spreadsheet editor state:")
        lines.append(f"- Spreadsheet: {ss.get('name', 'Untitled')}")
        lines.append(f"- Sheets: {ss.get('sheetCount', 0)}, active: {ss.get('activeSheetName', 'Sheet 1')}")
        if ss.get("hasPivotTables"):
            lines.append(f"- Pivot tables: {ss.get('pivotCount', 0)}")
        if ss.get("saving"):
            lines.append("- Currently saving")

    # Dashboard builder state
    dash = context.get("dashboard")
    if dash and isinstance(dash, dict):
        lines.append("")
        lines.append("Dashboard builder state:")
        lines.append(f"- Dashboard: {dash.get('name', 'Untitled')}")
        lines.append(f"- Widgets: {dash.get('widgetCount', 0)}")
        types = dash.get("widgetTypes", [])
        if types:
            lines.append(f"- Widget types: {', '.join(types)}")
        if dash.get("filterCount"):
            lines.append(f"- Active filters: {dash['filterCount']}")
        if dash.get("insightCount"):
            lines.append(f"- AI insights available: {dash['insightCount']}")
        if dash.get("refreshing"):
            lines.append("- Currently refreshing data")

    # Connector state
    conn = context.get("connector")
    if conn and isinstance(conn, dict):
        lines.append("")
        lines.append("Connector state:")
        lines.append(f"- Connection: {conn.get('name', 'unnamed')} ({conn.get('type', 'unknown')})")
        if conn.get("hasSchema"):
            lines.append(f"- Schema loaded: {conn.get('tableCount', 0)} tables")
        if conn.get("testing"):
            lines.append("- Currently testing connection")
        if conn.get("querying"):
            lines.append("- Query in progress")

    # Workflow state
    wf = context.get("workflow")
    if wf and isinstance(wf, dict):
        lines.append("")
        lines.append("Workflow state:")
        lines.append(f"- Workflow: {wf.get('name', 'Untitled')}")
        lines.append(f"- Nodes: {wf.get('nodeCount', 0)}")
        if wf.get("triggerType"):
            lines.append(f"- Trigger: {wf['triggerType']}")
        if wf.get("executionStatus"):
            lines.append(f"- Execution: {wf['executionStatus']}")
        if wf.get("pendingApprovals"):
            lines.append(f"- Pending approvals: {wf['pendingApprovals']}")
        if wf.get("executing"):
            lines.append("- Currently executing")

    # Errors and loading
    errors = context.get("errors", [])
    if errors:
        lines.append("")
        lines.append("Errors on screen: " + "; ".join(str(e) for e in errors))
    else:
        lines.append("")
        lines.append("- No errors displayed")

    loading = context.get("loading_keys", [])
    if loading:
        lines.append("- Currently loading: " + ", ".join(loading))

    return "\n".join(lines)


def assemble_system_prompt(
    context: Dict[str, Any],
    knowledge: Dict[str, Any],
    mode: str = "auto",
) -> str:
    """Assemble the full system prompt from all layers."""
    sections = [BASE_PERSONA]

    # Layer 2: Feature grounding
    grounding = _format_feature_grounding(knowledge)
    if grounding:
        sections.append(grounding)

    # Layer 3: Live context
    live = _format_live_context(context)
    if live:
        sections.append(live)

    # Layer 4: Mode instruction
    mode_instr = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["auto"])
    sections.append(f"Response mode: {mode_instr}")

    return "\n\n---\n\n".join(sections)


# ---- Follow-up / action extraction ----

_FOLLOW_UP_RE = re.compile(
    r'\[FOLLOW_UPS?:\s*"([^"]+)"(?:\s*\|\s*"([^"]+)")*\s*\]',
    re.IGNORECASE,
)

_ACTION_RE = re.compile(
    r'\[ACTION:\s*(\{[^}]+\})\s*\]',
    re.IGNORECASE,
)


def extract_follow_ups(text: str) -> Tuple[str, List[str]]:
    """Extract follow-up questions from the tail of the assistant response.

    Returns (cleaned_text, follow_ups).
    """
    match = _FOLLOW_UP_RE.search(text)
    if not match:
        return text.strip(), []

    # Extract all quoted questions from the match
    full_match = match.group(0)
    questions = re.findall(r'"([^"]+)"', full_match)
    cleaned = text.replace(full_match, "").strip()
    return cleaned, questions


def extract_actions(text: str) -> Tuple[str, List[Dict[str, str]]]:
    """Extract action suggestions from the assistant response.

    Returns (cleaned_text, actions).
    """
    import json as _json

    actions: List[Dict[str, str]] = []
    cleaned = text

    for match in _ACTION_RE.finditer(text):
        try:
            action = _json.loads(match.group(1))
            if isinstance(action, dict):
                actions.append(action)
            cleaned = cleaned.replace(match.group(0), "").strip()
        except (_json.JSONDecodeError, ValueError):
            pass

    return cleaned, actions
