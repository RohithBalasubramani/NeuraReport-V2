# mypy: ignore-errors
"""
LangGraph-based pipelines (merged from V1 graph/).

Provides:
- ReportPipelineState / AgentWorkflowState typed dicts
- run_report_pipeline() — LangGraph with sequential fallback
- run_agent_workflow() — LangGraph with sequential fallback

LangGraph is optional; sequential execution is used when unavailable.
"""
from __future__ import annotations

import concurrent.futures
import json
import logging
import threading
from typing import Any, Dict, List, TypedDict

logger = logging.getLogger("neura.graph")

try:
    from langgraph.graph import StateGraph, START, END
    _langgraph_available = True
except ImportError:
    _langgraph_available = False


def _get_llm_client():
    try:
        from backend.app.services.llm import get_llm_client
        return get_llm_client()
    except Exception:
        return None


# =========================================================================== #
#  Section 1: State types                                                     #
# =========================================================================== #

class ReportPipelineState(TypedDict, total=False):
    report_id: str
    template_id: str
    connection_id: str
    user_query: str
    parameters: Dict[str, Any]
    extracted_data: Dict[str, Any]
    sql_queries: List[str]
    query_results: List[Dict[str, Any]]
    mapped_fields: Dict[str, Any]
    generated_sections: List[Dict[str, Any]]
    review_feedback: str
    review_score: float
    revision_count: int
    max_revisions: int
    final_report: Dict[str, Any]
    confidence: float
    method: str
    errors: List[str]


class AgentWorkflowState(TypedDict, total=False):
    task_description: str
    agent_type: str
    context: Dict[str, Any]
    plan: List[Dict[str, Any]]
    search_results: List[Dict[str, Any]]
    analysis_results: Dict[str, Any]
    draft_content: str
    revision_count: int
    max_revisions: int
    evaluation_feedback: str
    final_output: Any
    quality_score: float
    method: str
    errors: List[str]


# =========================================================================== #
#  Section 2: Report pipeline nodes                                           #
# =========================================================================== #

def _llm_call(system: str, user: str, desc: str) -> str:
    client = _get_llm_client()
    if client is None:
        return ""
    try:
        response = client.complete(messages=[{"role": "system", "content": system}, {"role": "user", "content": user}], description=desc)
        text = response.get("choices", [{}])[0].get("message", {}).get("content", "")
        return text or str(response)
    except Exception as exc:
        logger.error("graph_llm_call_failed", extra={"desc": desc, "error": str(exc)})
        return ""


def rp_extract_data(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a data-requirements analyst. Extract structured data requirements as JSON.", f"User query: {state.get('user_query', '')}\nTemplate ID: {state.get('template_id', '')}\nParameters: {json.dumps(state.get('parameters', {}))}\n\nReturn JSON with keys: tables, columns, filters, aggregations, relationships.", "graph:rp_extract_data")
    try:
        return {"extracted_data": json.loads(text)}
    except (json.JSONDecodeError, TypeError):
        return {"extracted_data": {"raw_response": text, "tables": [], "columns": [], "filters": []}}


def rp_generate_sql(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a SQL expert. Generate SQL queries. Return a JSON array.", f"Data requirements: {json.dumps(state.get('extracted_data', {}))}\nConnection ID: {state.get('connection_id', '')}", "graph:rp_generate_sql")
    try:
        queries = json.loads(text)
        return {"sql_queries": queries if isinstance(queries, list) else [str(queries)]}
    except (json.JSONDecodeError, TypeError):
        return {"sql_queries": [text] if text.strip() else []}


def rp_execute_queries(state: Dict[str, Any]) -> Dict[str, Any]:
    results = [{"query_index": i, "query": q, "rows": [], "row_count": 0, "status": "stub"} for i, q in enumerate(state.get("sql_queries", []))]
    return {"query_results": results}


def rp_map_fields(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a data mapping specialist. Map query results to report template fields. Return JSON.", f"Query results: {json.dumps(state.get('query_results', []))}\nTemplate ID: {state.get('template_id', '')}\nExtracted data: {json.dumps(state.get('extracted_data', {}))}", "graph:rp_map_fields")
    try:
        return {"mapped_fields": json.loads(text)}
    except (json.JSONDecodeError, TypeError):
        return {"mapped_fields": {"raw_mapping": text}}


def rp_generate_sections(state: Dict[str, Any]) -> Dict[str, Any]:
    feedback_ctx = f"\n\nPrevious review feedback:\n{state['review_feedback']}" if state.get("review_feedback") else ""
    text = _llm_call("You are a report writer. Generate report sections. Return JSON array with keys: title, content, order.", f"Mapped fields: {json.dumps(state.get('mapped_fields', {}))}\nUser query: {state.get('user_query', '')}{feedback_ctx}", "graph:rp_generate_sections")
    try:
        sections = json.loads(text)
        return {"generated_sections": sections if isinstance(sections, list) else [{"title": "Report", "content": str(sections), "order": 0}]}
    except (json.JSONDecodeError, TypeError):
        return {"generated_sections": [{"title": "Report", "content": text, "order": 0}]}


def rp_review(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a quality reviewer. Return JSON with keys: score (0.0-1.0), feedback.", f"Sections: {json.dumps(state.get('generated_sections', []))}\nUser query: {state.get('user_query', '')}", "graph:rp_review")
    try:
        review = json.loads(text)
        score = float(review.get("score", 0.5))
        feedback = str(review.get("feedback", ""))
    except (json.JSONDecodeError, TypeError, ValueError):
        score, feedback = 0.5, text
    return {"review_score": score, "review_feedback": feedback, "revision_count": state.get("revision_count", 0) + 1}


def rp_finalize(state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "final_report": {"report_id": state.get("report_id", ""), "template_id": state.get("template_id", ""), "sections": state.get("generated_sections", []), "review_score": state.get("review_score", 0.0)},
        "confidence": state.get("review_score", 0.5),
        "method": "langgraph" if _langgraph_available else "sequential",
    }


def _rp_route_after_review(state: Dict[str, Any]) -> str:
    if state.get("review_score", 1.0) < 0.7 and state.get("revision_count", 0) < state.get("max_revisions", 2):
        return "rp_generate_sections"
    return "rp_finalize"


_rp_compiled = None
_rp_lock = threading.Lock()


def _build_report_graph():
    global _rp_compiled
    if _rp_compiled is not None:
        return _rp_compiled
    with _rp_lock:
        if _rp_compiled is not None:
            return _rp_compiled
        if not _langgraph_available:
            raise ImportError("langgraph is not installed")
        graph = StateGraph(ReportPipelineState)
        for name, fn in [("rp_extract_data", rp_extract_data), ("rp_generate_sql", rp_generate_sql), ("rp_execute_queries", rp_execute_queries), ("rp_map_fields", rp_map_fields), ("rp_generate_sections", rp_generate_sections), ("rp_review", rp_review), ("rp_finalize", rp_finalize)]:
            graph.add_node(name, fn)
        graph.add_edge(START, "rp_extract_data")
        graph.add_edge("rp_extract_data", "rp_generate_sql")
        graph.add_edge("rp_generate_sql", "rp_execute_queries")
        graph.add_edge("rp_execute_queries", "rp_map_fields")
        graph.add_edge("rp_map_fields", "rp_generate_sections")
        graph.add_edge("rp_generate_sections", "rp_review")
        graph.add_conditional_edges("rp_review", _rp_route_after_review, {"rp_generate_sections": "rp_generate_sections", "rp_finalize": "rp_finalize"})
        graph.add_edge("rp_finalize", END)
        _rp_compiled = graph.compile()
        return _rp_compiled


def _rp_sequential(state: Dict[str, Any]) -> Dict[str, Any]:
    state.update(rp_extract_data(state))
    state.update(rp_generate_sql(state))
    state.update(rp_execute_queries(state))
    state.update(rp_map_fields(state))
    while True:
        state.update(rp_generate_sections(state))
        state.update(rp_review(state))
        if state.get("review_score", 1.0) >= 0.7 or state.get("revision_count", 0) >= state.get("max_revisions", 2):
            break
    state.update(rp_finalize(state))
    state["method"] = "sequential"
    return state


def run_report_pipeline(report_id: str, template_id: str, connection_id: str, user_query: str = "", max_revisions: int = 2, **kwargs: Any) -> dict:
    initial: Dict[str, Any] = {"report_id": report_id, "template_id": template_id, "connection_id": connection_id, "user_query": user_query, "max_revisions": max_revisions, "revision_count": 0, "errors": [], **kwargs}

    # V2 feature flag: only use LangGraph if enable_langgraph_pipeline is True
    try:
        from backend.app.services.config import get_v2_config
        v2 = get_v2_config()
        if not v2.enable_langgraph_pipeline:
            logger.debug("LangGraph pipeline disabled by V2 feature flag, using sequential")
            return _rp_sequential(initial)
    except Exception:
        pass  # If config unavailable, fall through to existing logic

    if _langgraph_available:
        try:
            return dict(_build_report_graph().invoke(initial))
        except Exception:
            pass
    return _rp_sequential(initial)


# =========================================================================== #
#  Section 3: Agent workflow nodes                                            #
# =========================================================================== #

def aw_plan(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a task planner. Return JSON array of sub-task objects.", f"Task: {state.get('task_description', '')}\nAgent type: {state.get('agent_type', 'research')}\nContext: {json.dumps(state.get('context', {}))}", "graph:aw_plan")
    try:
        plan = json.loads(text)
        return {"plan": plan if isinstance(plan, list) else [{"task": str(plan), "priority": 1}]}
    except (json.JSONDecodeError, TypeError):
        return {"plan": [{"task": text, "priority": 1}]}


def _search_subtask(subtask: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a research assistant. Return JSON with findings, sources, relevance_score.", f"Sub-task: {json.dumps(subtask)}", "graph:aw_search_subtask")
    try:
        result = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        result = {"findings": text, "sources": [], "relevance_score": 0.5}
    result["subtask"] = subtask.get("task", "")
    return result


def aw_search(state: Dict[str, Any]) -> Dict[str, Any]:
    plan = state.get("plan", [])
    if not plan:
        return {"search_results": []}
    results: List[Dict[str, Any]] = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(plan), 4)) as executor:
            futures = {executor.submit(_search_subtask, t): t for t in plan}
            for future in concurrent.futures.as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as exc:
                    results.append({"subtask": futures[future].get("task", ""), "findings": "", "error": str(exc)})
    except Exception:
        for t in plan:
            results.append(_search_subtask(t))
    return {"search_results": results}


def aw_analyze(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are an analyst. Synthesize search results. Return JSON with summary, key_findings, gaps, recommendations.", f"Task: {state.get('task_description', '')}\nSearch results: {json.dumps(state.get('search_results', []))}", "graph:aw_analyze")
    try:
        return {"analysis_results": json.loads(text)}
    except (json.JSONDecodeError, TypeError):
        return {"analysis_results": {"summary": text}}


def aw_draft(state: Dict[str, Any]) -> Dict[str, Any]:
    feedback_ctx = f"\n\nPrevious feedback:\n{state['evaluation_feedback']}" if state.get("evaluation_feedback") else ""
    text = _llm_call("You are a content writer. Generate a draft.", f"Task: {state.get('task_description', '')}\nAnalysis: {json.dumps(state.get('analysis_results', {}))}{feedback_ctx}", "graph:aw_draft")
    return {"draft_content": text}


def aw_evaluate(state: Dict[str, Any]) -> Dict[str, Any]:
    text = _llm_call("You are a quality evaluator. Return JSON with score (0.0-1.0) and feedback.", f"Task: {state.get('task_description', '')}\nDraft: {state.get('draft_content', '')}", "graph:aw_evaluate")
    try:
        ev = json.loads(text)
        score, feedback = float(ev.get("score", 0.5)), str(ev.get("feedback", ""))
    except (json.JSONDecodeError, TypeError, ValueError):
        score, feedback = 0.5, text
    return {"quality_score": score, "evaluation_feedback": feedback, "revision_count": state.get("revision_count", 0) + 1}


def aw_finalize(state: Dict[str, Any]) -> Dict[str, Any]:
    return {"final_output": {"content": state.get("draft_content", ""), "analysis": state.get("analysis_results", {}), "quality_score": state.get("quality_score", 0.0)}, "method": "langgraph" if _langgraph_available else "sequential"}


def _aw_route_after_evaluate(state: Dict[str, Any]) -> str:
    if state.get("quality_score", 1.0) < 0.7 and state.get("revision_count", 0) < state.get("max_revisions", 2):
        return "aw_draft"
    return "aw_finalize"


_aw_compiled = None
_aw_lock = threading.Lock()


def _build_agent_graph():
    global _aw_compiled
    if _aw_compiled is not None:
        return _aw_compiled
    with _aw_lock:
        if _aw_compiled is not None:
            return _aw_compiled
        if not _langgraph_available:
            raise ImportError("langgraph is not installed")
        graph = StateGraph(AgentWorkflowState)
        for name, fn in [("aw_plan", aw_plan), ("aw_search", aw_search), ("aw_analyze", aw_analyze), ("aw_draft", aw_draft), ("aw_evaluate", aw_evaluate), ("aw_finalize", aw_finalize)]:
            graph.add_node(name, fn)
        graph.add_edge(START, "aw_plan")
        graph.add_edge("aw_plan", "aw_search")
        graph.add_edge("aw_search", "aw_analyze")
        graph.add_edge("aw_analyze", "aw_draft")
        graph.add_edge("aw_draft", "aw_evaluate")
        graph.add_conditional_edges("aw_evaluate", _aw_route_after_evaluate, {"aw_draft": "aw_draft", "aw_finalize": "aw_finalize"})
        graph.add_edge("aw_finalize", END)
        _aw_compiled = graph.compile()
        return _aw_compiled


def _aw_sequential(state: Dict[str, Any]) -> Dict[str, Any]:
    state.update(aw_plan(state))
    state.update(aw_search(state))
    state.update(aw_analyze(state))
    while True:
        state.update(aw_draft(state))
        state.update(aw_evaluate(state))
        if state.get("quality_score", 1.0) >= 0.7 or state.get("revision_count", 0) >= state.get("max_revisions", 2):
            break
    state.update(aw_finalize(state))
    state["method"] = "sequential"
    return state


def run_agent_workflow(task_description: str, agent_type: str = "research", context: Dict[str, Any] | None = None, max_revisions: int = 2) -> dict:
    initial: Dict[str, Any] = {"task_description": task_description, "agent_type": agent_type, "context": context or {}, "max_revisions": max_revisions, "revision_count": 0, "errors": []}

    # V2 feature flag: only use LangGraph if enable_langgraph_pipeline is True
    try:
        from backend.app.services.config import get_v2_config
        v2 = get_v2_config()
        if not v2.enable_langgraph_pipeline:
            logger.debug("LangGraph workflow disabled by V2 feature flag, using sequential")
            return _aw_sequential(initial)
    except Exception:
        pass  # If config unavailable, fall through to existing logic

    if _langgraph_available:
        try:
            return dict(_build_agent_graph().invoke(initial))
        except Exception:
            pass
    return _aw_sequential(initial)


__all__ = ["ReportPipelineState", "AgentWorkflowState", "run_report_pipeline", "run_agent_workflow"]
