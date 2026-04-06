"""Service layer for Data Enrichment feature."""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Type

from backend.app.utils import AppError
from backend.app.repositories import state_store as state_store_module

# EnrichmentCache defined below in this file
from backend.app.common import get_state_store, utc_now, utc_now_iso
from backend.app.schemas import (
    EnrichmentSource,
    EnrichmentSourceCreate,
    EnrichmentSourceType,
    EnrichmentRequest,
    EnrichmentResult,
    EnrichedField,
    EnrichmentResponse,
    EnrichmentFieldMapping,
)
# (same file) # EnrichmentSourceBase
# (same file) # CompanyInfoSource
# (same file) # AddressSource
# (same file) # ExchangeRateSource

logger = logging.getLogger("neura.domain.enrichment")






# Registry of enrichment source types to their implementations (populated lazily)
def _get_source_registry():
    return {
        EnrichmentSourceType.COMPANY_INFO: CompanyInfoSource,
        EnrichmentSourceType.ADDRESS: AddressSource,
        EnrichmentSourceType.EXCHANGE_RATE: ExchangeRateSource,
    }


class EnrichmentService:
    """Service for data enrichment operations."""

    def __init__(self):
        self._cache = EnrichmentCache(get_state_store())
        self._source_instances: Dict[str, EnrichmentSourceBase] = {}

    def _get_source_instance(self, source: EnrichmentSource) -> EnrichmentSourceBase:
        """Get or create a source instance."""
        if source.id in self._source_instances:
            return self._source_instances[source.id]

        source_class = _get_source_registry().get(source.type)
        if not source_class:
            raise AppError(
                code="unknown_source_type",
                message=f"Unknown enrichment source type: {source.type}",
                status_code=400,
            )

        instance = source_class(source.config)
        self._source_instances[source.id] = instance
        return instance

    def create_source(
        self,
        request: EnrichmentSourceCreate,
        correlation_id: Optional[str] = None,
    ) -> EnrichmentSource:
        """Create a new enrichment source."""
        logger.info(f"Creating enrichment source: {request.name}", extra={"correlation_id": correlation_id})

        source_id = str(uuid.uuid4())[:8]
        now = utc_now_iso()

        source = EnrichmentSource(
            id=source_id,
            name=request.name,
            type=request.type,
            description=request.description,
            config=request.config,
            cache_ttl_hours=request.cache_ttl_hours,
            created_at=now,
            updated_at=now,
        )

        # Persist to state store
        store = get_state_store()
        with store.transaction() as state:
            state.setdefault("enrichment_sources", {})[source_id] = source.model_dump()

        return source

    def list_sources(self) -> List[EnrichmentSource]:
        """List all enrichment sources."""
        store = get_state_store()
        with store.transaction() as state:
            sources = state.get("enrichment_sources", {})
        return [EnrichmentSource(**s) for s in sources.values()]

    def get_source(self, source_id: str) -> Optional[EnrichmentSource]:
        """Get an enrichment source by ID."""
        store = get_state_store()
        with store.transaction() as state:
            source = state.get("enrichment_sources", {}).get(source_id)
        return EnrichmentSource(**source) if source else None

    def delete_source(self, source_id: str) -> bool:
        """Delete an enrichment source."""
        store = get_state_store()
        with store.transaction() as state:
            sources = state.get("enrichment_sources", {})
            if source_id not in sources:
                return False
            del sources[source_id]

        # Clear cached instances
        self._source_instances.pop(source_id, None)

        # Invalidate cache for this source
        self._cache.invalidate(source_id)

        return True

    async def enrich(
        self,
        request: EnrichmentRequest,
        correlation_id: Optional[str] = None,
    ) -> EnrichmentResponse:
        """
        Enrich data with additional information.

        Args:
            request: Enrichment request with data and mappings
            correlation_id: Request correlation ID

        Returns:
            Enrichment response with results
        """
        logger.info(
            f"Enriching {len(request.data)} rows with {len(request.mappings)} mappings",
            extra={"correlation_id": correlation_id},
        )

        started = time.time()
        results: List[EnrichmentResult] = []
        cache_hits = 0
        cache_misses = 0
        enriched_count = 0

        # Build source lookup
        sources: Dict[str, EnrichmentSource] = {}
        for mapping in request.mappings:
            if mapping.enrichment_source_id not in sources:
                source = self.get_source(mapping.enrichment_source_id)
                if not source:
                    raise AppError(
                        code="source_not_found",
                        message=f"Enrichment source not found: {mapping.enrichment_source_id}",
                        status_code=404,
                    )
                if not source.enabled:
                    raise AppError(
                        code="source_disabled",
                        message=f"Enrichment source is disabled: {source.name}",
                        status_code=400,
                    )
                sources[mapping.enrichment_source_id] = source

        # Process each row
        for row_index, row in enumerate(request.data):
            enriched_fields: List[EnrichedField] = []
            errors: List[str] = []

            for mapping in request.mappings:
                source = sources[mapping.enrichment_source_id]
                source_instance = self._get_source_instance(source)

                # Get the lookup value
                lookup_value = row.get(mapping.source_field)
                if lookup_value is None:
                    continue

                # Check cache first
                cached_data = None
                if request.use_cache:
                    cached_data = self._cache.get(
                        source.id,
                        lookup_value,
                        max_age_hours=source.cache_ttl_hours,
                    )

                if cached_data:
                    cache_hits += 1
                    enrichment_data = cached_data
                    from_cache = True
                else:
                    cache_misses += 1
                    try:
                        enrichment_data = await source_instance.lookup(lookup_value)
                        if enrichment_data and request.use_cache:
                            self._cache.set(
                                source.id,
                                lookup_value,
                                enrichment_data,
                                ttl_hours=source.cache_ttl_hours,
                            )
                    except Exception as exc:
                        logger.warning("Enrichment lookup failed for %s: %s", mapping.source_field, exc)
                        errors.append(f"Lookup failed for {mapping.source_field}")
                        enrichment_data = None
                    from_cache = False

                if enrichment_data:
                    confidence = source_instance.get_confidence(enrichment_data)
                    for target_field in mapping.target_fields:
                        if target_field in enrichment_data:
                            enriched_fields.append(
                                EnrichedField(
                                    field=target_field,
                                    original_value=lookup_value,
                                    enriched_value=enrichment_data[target_field],
                                    confidence=confidence,
                                    source=source.name,
                                    cached=from_cache,
                                )
                            )

            if enriched_fields:
                enriched_count += 1

            results.append(
                EnrichmentResult(
                    row_index=row_index,
                    enriched_fields=enriched_fields,
                    errors=errors,
                )
            )

        processing_time_ms = int((time.time() - started) * 1000)

        return EnrichmentResponse(
            total_rows=len(request.data),
            enriched_rows=enriched_count,
            results=results,
            cache_hits=cache_hits,
            cache_misses=cache_misses,
            processing_time_ms=processing_time_ms,
        )

    async def preview_enrichment(
        self,
        sample_data: List[Dict[str, Any]],
        mappings: List[EnrichmentFieldMapping],
        correlation_id: Optional[str] = None,
    ) -> EnrichmentResponse:
        """
        Preview enrichment without caching results.

        Args:
            sample_data: Sample data rows
            mappings: Field mappings
            correlation_id: Request correlation ID

        Returns:
            Enrichment preview results
        """
        request = EnrichmentRequest(
            data=sample_data,
            mappings=mappings,
            use_cache=False,  # Don't cache preview results
        )
        return await self.enrich(request, correlation_id)

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        return self._cache.get_stats()

    def clear_cache(self, source_id: Optional[str] = None) -> int:
        """Clear enrichment cache."""
        return self._cache.invalidate(source_id)

    def get_available_source_types(self) -> List[Dict[str, Any]]:
        """Get list of available source types with their supported fields."""
        result = []
        for source_type, source_class in _get_source_registry().items():
            instance = source_class({})
            result.append({
                "type": source_type.value,
                "name": source_type.value.replace("_", " ").title(),
                "supported_fields": instance.get_supported_fields(),
            })
        return result

    @staticmethod
    def get_builtin_sources() -> List[Dict[str, Any]]:
        """Return the catalog of built-in enrichment sources."""
        return [
            {
                "id": "company",
                "name": "Company Information",
                "type": EnrichmentSourceType.COMPANY_INFO.value,
                "description": "Enrich with company details (industry, size, revenue)",
                "required_fields": ["company_name"],
                "output_fields": ["industry", "company_size", "estimated_revenue", "founded_year"],
            },
            {
                "id": "address",
                "name": "Address Standardization",
                "type": EnrichmentSourceType.ADDRESS.value,
                "description": "Standardize and validate addresses",
                "required_fields": ["address"],
                "output_fields": ["formatted_address", "city", "state", "postal_code", "country"],
            },
            {
                "id": "exchange",
                "name": "Currency Exchange",
                "type": EnrichmentSourceType.EXCHANGE_RATE.value,
                "description": "Convert currencies to target currency",
                "required_fields": ["amount", "currency"],
                "output_fields": ["converted_amount", "exchange_rate", "target_currency"],
            },
        ]

    async def simple_enrich(
        self,
        data: List[Dict[str, Any]],
        sources: List[str],
        options: Dict[str, Any],
        correlation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Simplified enrichment for frontend.

        Args:
            data: List of data rows to enrich
            sources: List of source type IDs (e.g., ["company", "address"])
            options: Additional options (target_currency, etc.)
            correlation_id: Request correlation ID

        Returns:
            Dict with enriched_data, total_rows, enriched_rows, processing_time_ms
        """
        logger.info(
            f"Simple enrichment: {len(data)} rows with sources {sources}",
            extra={"correlation_id": correlation_id},
        )

        started = time.time()
        enriched_data = []
        enriched_count = 0

        # Map source IDs to source types (support multiple aliases)
        source_type_map = {
            "company": EnrichmentSourceType.COMPANY_INFO,
            "company_info": EnrichmentSourceType.COMPANY_INFO,
            "address": EnrichmentSourceType.ADDRESS,
            "exchange": EnrichmentSourceType.EXCHANGE_RATE,
            "exchange_rate": EnrichmentSourceType.EXCHANGE_RATE,
        }

        for row in data:
            enriched_row = dict(row)  # Copy original row
            row_enriched = False

            for source_id in sources:
                source_type = source_type_map.get(source_id)
                if not source_type:
                    continue

                source_class = _get_source_registry().get(source_type)
                if not source_class:
                    continue

                # Create config with options
                config = dict(options) if options else {}
                source_instance = source_class(config)

                # Determine lookup field based on source type
                lookup_value = None
                if source_type == EnrichmentSourceType.COMPANY_INFO:
                    lookup_value = row.get("company_name") or row.get("company")
                elif source_type == EnrichmentSourceType.ADDRESS:
                    lookup_value = row.get("address")
                elif source_type == EnrichmentSourceType.EXCHANGE_RATE:
                    lookup_value = row.get("amount")
                    if lookup_value is not None:
                        # Pass as dict for proper parsing by ExchangeRateSource
                        from_currency = row.get("currency") or row.get("from_currency") or "USD"
                        target_currency = config.get("target_currency", "USD")
                        lookup_value = {
                            "amount": lookup_value,
                            "from_currency": from_currency,
                            "to_currency": target_currency,
                        }

                if lookup_value is None:
                    continue

                try:
                    # Pass lookup_value directly (can be string, dict, or number)
                    enrichment_result = await source_instance.lookup(lookup_value)
                    if enrichment_result:
                        enriched_row.update(enrichment_result)
                        row_enriched = True
                except Exception as exc:
                    logger.warning(f"Enrichment lookup failed: {exc}")

            enriched_data.append(enriched_row)
            if row_enriched:
                enriched_count += 1

        processing_time_ms = int((time.time() - started) * 1000)

        return {
            "enriched_data": enriched_data,
            "total_rows": len(data),
            "enriched_rows": enriched_count,
            "processing_time_ms": processing_time_ms,
        }

    async def simple_preview(
        self,
        data: List[Dict[str, Any]],
        sources: List[str],
        sample_size: int = 5,
        correlation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Preview enrichment on a sample of data.

        Args:
            data: List of data rows
            sources: List of source type IDs
            sample_size: Number of rows to preview
            correlation_id: Request correlation ID

        Returns:
            Dict with preview results
        """
        # Take only sample_size rows
        sample_data = data[:sample_size]

        result = await self.simple_enrich(
            data=sample_data,
            sources=sources,
            options={},
            correlation_id=correlation_id,
        )

        return {
            "preview": result["enriched_data"],
            "total_rows": len(data),
            "enriched_rows": result["enriched_rows"],
            "processing_time_ms": result["processing_time_ms"],
        }


# =============================================================================
# CACHE (merged from cache.py)
# =============================================================================

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger("neura.domain.enrichment.cache")




def _compute_cache_key(source_id: str, lookup_value: Any) -> str:
    """Compute a cache key from source and lookup value."""
    value_str = json.dumps(lookup_value, sort_keys=True, default=str)
    content = f"{source_id}:{value_str}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


class EnrichmentCache:
    """In-memory cache with TTL support for enrichment data."""

    def __init__(self, state_store):
        self._store = state_store
        self._hits = 0
        self._misses = 0

    def get(
        self,
        source_id: str,
        lookup_value: Any,
        max_age_hours: int = 24,
    ) -> Optional[Dict[str, Any]]:
        """
        Get cached enrichment result.

        Args:
            source_id: ID of the enrichment source
            lookup_value: The value being looked up
            max_age_hours: Maximum age of cached data in hours

        Returns:
            Cached data if found and not expired, None otherwise
        """
        cache_key = _compute_cache_key(source_id, lookup_value)

        try:
            with self._store.transaction() as state:
                cache = dict(state.get("enrichment_cache", {}) or {})
            entry = cache.get(cache_key)

            if not entry:
                self._misses += 1
                return None

            # Check expiration
            cached_at = entry.get("cached_at")
            if cached_at:
                cache_time = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                age_hours = (now - cache_time).total_seconds() / 3600

                if age_hours > max_age_hours:
                    logger.debug(f"Cache expired for key {cache_key}")
                    self._misses += 1
                    return None

            self._hits += 1
            return entry.get("data")

        except Exception as exc:
            logger.warning(f"Cache read error: {exc}")
            self._misses += 1
            return None

    def set(
        self,
        source_id: str,
        lookup_value: Any,
        data: Dict[str, Any],
        ttl_hours: int = 24,
    ) -> None:
        """
        Cache enrichment result.

        Args:
            source_id: ID of the enrichment source
            lookup_value: The value being looked up
            data: The enrichment data to cache
            ttl_hours: Time-to-live in hours
        """
        cache_key = _compute_cache_key(source_id, lookup_value)

        try:
            with self._store.transaction() as state:
                cache = state.setdefault("enrichment_cache", {})

                cache[cache_key] = {
                    "source_id": source_id,
                    "lookup_value": lookup_value,
                    "data": data,
                    "ttl_hours": ttl_hours,
                    "cached_at": utc_now_iso(),
                }

                # Trim cache if too large (keep most recent 1000 entries)
                if len(cache) > 1000:
                    sorted_entries = sorted(
                        cache.items(),
                        key=lambda x: x[1].get("cached_at", ""),
                        reverse=True,
                    )
                    state["enrichment_cache"] = dict(sorted_entries[:1000])

        except Exception as exc:
            logger.warning(f"Cache write error: {exc}")

    def invalidate(self, source_id: Optional[str] = None) -> int:
        """
        Invalidate cache entries.

        Args:
            source_id: If provided, only invalidate entries for this source.
                      If None, invalidate all entries.

        Returns:
            Number of entries invalidated
        """
        try:
            with self._store.transaction() as state:
                cache = state.get("enrichment_cache", {})

                if source_id is None:
                    count = len(cache)
                    state["enrichment_cache"] = {}
                else:
                    original_count = len(cache)
                    cache = {k: v for k, v in cache.items() if v.get("source_id") != source_id}
                    count = original_count - len(cache)
                    state["enrichment_cache"] = cache

                return count

        except Exception as exc:
            logger.warning(f"Cache invalidation error: {exc}")
            return 0

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        try:
            with self._store.transaction() as state:
                cache = dict(state.get("enrichment_cache", {}) or {})

            now = datetime.now(timezone.utc)
            expired_count = 0
            sources = {}
            size_bytes = 0

            for entry in cache.values():
                source_id = entry.get("source_id", "unknown")
                sources[source_id] = sources.get(source_id, 0) + 1

                # Estimate size of entry
                try:
                    size_bytes += len(json.dumps(entry, default=str))
                except Exception:
                    size_bytes += 100  # Estimate if serialization fails

                cached_at = entry.get("cached_at")
                ttl_hours = entry.get("ttl_hours", 24)
                if cached_at:
                    cache_time = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
                    age_hours = (now - cache_time).total_seconds() / 3600
                    if age_hours > ttl_hours:
                        expired_count += 1

            # Calculate hit rate
            total_requests = self._hits + self._misses
            hit_rate = self._hits / total_requests if total_requests > 0 else 0.0

            return {
                "total_entries": len(cache),
                "expired_entries": expired_count,
                "entries_by_source": sources,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": hit_rate,
                "size_bytes": size_bytes,
            }

        except Exception as exc:
            logger.warning(f"Cache stats error: {exc}")
            return {"error": "Cache stats unavailable", "hits": 0, "misses": 0, "hit_rate": 0.0, "size_bytes": 0}


# =============================================================================
# ENRICHMENT_SOURCES (merged from enrichment_sources.py)
# =============================================================================

# ── Originally: base.py ──


"""Base class for enrichment sources."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class EnrichmentSourceBase(ABC):
    """Abstract base class for enrichment sources."""

    source_type: str = "base"
    supported_fields: List[str] = []

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the enrichment source.

        Args:
            config: Source-specific configuration
        """
        self.config = config

    @abstractmethod
    async def lookup(self, value: Any) -> Optional[Dict[str, Any]]:
        """
        Look up enrichment data for a value.

        Args:
            value: The value to look up (e.g., company name, address)

        Returns:
            Dictionary of enriched fields, or None if not found
        """
        pass

    @abstractmethod
    def get_supported_fields(self) -> List[str]:
        """
        Get list of fields this source can provide.

        Returns:
            List of field names
        """
        pass

    def validate_config(self) -> bool:
        """
        Validate the source configuration.

        Returns:
            True if configuration is valid
        """
        return True

    def get_confidence(self, result: Dict[str, Any]) -> float:
        """
        Calculate confidence score for a result.

        Args:
            result: The enrichment result

        Returns:
            Confidence score between 0 and 1
        """
        return 1.0




# ── Originally: address.py ──


"""Address normalization and enrichment source."""


import logging
from typing import Any, Dict, List, Optional

from backend.app.services.infra_services import extract_json_from_llm_response

logger = logging.getLogger("neura.domain.enrichment.address")


class AddressSource(EnrichmentSourceBase):
    """
    Enrichment source for address normalization and geocoding.

    Uses LLM to parse and normalize addresses.
    """

    source_type = "address"
    supported_fields = [
        "street_address",
        "city",
        "state_province",
        "postal_code",
        "country",
        "country_code",
        "formatted_address",
        "address_type",  # residential, commercial, po_box
    ]

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._llm_client = None

    def _get_llm_client(self):
        """Get or create LLM client."""
        if self._llm_client is None:
            from backend.app.services.llm import get_llm_client
            self._llm_client = get_llm_client()
        return self._llm_client

    async def lookup(self, value: Any) -> Optional[Dict[str, Any]]:
        """
        Parse and normalize an address.

        Args:
            value: Raw address string

        Returns:
            Dictionary of parsed address components
        """
        if not value or not isinstance(value, str):
            return None

        address = value.strip()
        if not address:
            return None

        try:
            client = self._get_llm_client()

            prompt = f"""Parse and normalize this address into components:

Address: "{address}"

Return a JSON object with the following fields (use null for unknown/missing):
{{
  "street_address": "123 Main St, Suite 100",
  "city": "City name",
  "state_province": "State or province name",
  "postal_code": "12345",
  "country": "Country name",
  "country_code": "US",
  "formatted_address": "Complete formatted address",
  "address_type": "residential|commercial|po_box|unknown"
}}

Return ONLY the JSON object, no other text."""

            response = client.complete(
                messages=[{"role": "user", "content": prompt}],
                description="address_enrichment",
                temperature=0.0,
            )

            content = response["choices"][0]["message"]["content"]

            # Parse JSON from response (handles markdown code blocks from Claude)
            result = extract_json_from_llm_response(content, default=None)
            return result

        except Exception as exc:
            # Check for critical errors that should be re-raised
            exc_str = str(exc).lower()
            is_critical = any(indicator in exc_str for indicator in [
                "authentication", "api_key", "invalid_api_key", "unauthorized",
                "quota", "rate_limit", "insufficient_quota",
            ])

            if is_critical:
                logger.error(
                    f"Address lookup critical error for '{address[:50]}...': {exc}",
                    exc_info=True,
                    extra={"event": "address_enrichment_critical_error", "address_preview": address[:50]},
                )
                raise  # Re-raise critical errors (auth, quota, rate limit)

            # Non-critical errors: log with details but return None
            logger.warning(
                f"Address lookup failed for '{address[:50]}...': {exc}",
                exc_info=True,  # Include stack trace for debugging
                extra={"event": "address_enrichment_failed", "address_preview": address[:50], "error_type": type(exc).__name__},
            )
            return None

    def get_supported_fields(self) -> List[str]:
        return self.supported_fields

    def get_confidence(self, result: Dict[str, Any]) -> float:
        """Calculate confidence based on how many fields are populated."""
        if not result:
            return 0.0

        # Weight important fields more heavily
        weights = {
            "city": 0.2,
            "country": 0.2,
            "postal_code": 0.15,
            "street_address": 0.15,
            "state_province": 0.1,
            "country_code": 0.1,
            "formatted_address": 0.1,
        }

        score = 0.0
        for field, weight in weights.items():
            if result.get(field):
                score += weight

        return min(score, 1.0)




# ── Originally: company.py ──


"""Company information enrichment source using LLM."""

import logging
from typing import Any, Dict, List, Optional

from backend.app.services.infra_services import extract_json_from_llm_response

logger = logging.getLogger("neura.domain.enrichment.company")


class CompanyInfoSource(EnrichmentSourceBase):
    """
    Enrichment source for company information.

    Uses LLM to lookup company details like industry, size, location, etc.
    """

    source_type = "company_info"
    supported_fields = [
        "industry",
        "sector",
        "company_size",
        "founded_year",
        "headquarters_city",
        "headquarters_country",
        "website",
        "description",
    ]

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._llm_client = None

    def _get_llm_client(self):
        """Get or create LLM client."""
        if self._llm_client is None:
            from backend.app.services.llm import get_llm_client
            self._llm_client = get_llm_client()
        return self._llm_client

    async def lookup(self, value: Any) -> Optional[Dict[str, Any]]:
        """
        Look up company information.

        Args:
            value: Company name to look up

        Returns:
            Dictionary of company information
        """
        if not value or not isinstance(value, str):
            return None

        company_name = value.strip()
        if not company_name:
            return None

        try:
            client = self._get_llm_client()

            prompt = f"""Provide information about the company "{company_name}".

Return a JSON object with the following fields (use null for unknown values):
{{
  "industry": "Primary industry/sector",
  "sector": "Business sector",
  "company_size": "small/medium/large/enterprise",
  "founded_year": 1900,
  "headquarters_city": "City name",
  "headquarters_country": "Country name",
  "website": "https://example.com",
  "description": "Brief company description"
}}

Return ONLY the JSON object, no other text."""

            response = client.complete(
                messages=[{"role": "user", "content": prompt}],
                description="company_enrichment",
                temperature=0.0,
            )

            content = response["choices"][0]["message"]["content"]

            # Parse JSON from response (handles markdown code blocks from Claude)
            result = extract_json_from_llm_response(content, default=None)
            return result

        except Exception as exc:
            # Check for critical errors that should be re-raised
            exc_str = str(exc).lower()
            is_critical = any(indicator in exc_str for indicator in [
                "authentication", "api_key", "invalid_api_key", "unauthorized",
                "quota", "rate_limit", "insufficient_quota",
            ])

            if is_critical:
                logger.error(
                    f"Company lookup critical error for '{company_name}': {exc}",
                    exc_info=True,
                    extra={"event": "company_enrichment_critical_error", "company_name": company_name},
                )
                raise  # Re-raise critical errors (auth, quota, rate limit)

            # Non-critical errors: log with details but return None
            logger.warning(
                f"Company lookup failed for '{company_name}': {exc}",
                exc_info=True,  # Include stack trace for debugging
                extra={"event": "company_enrichment_failed", "company_name": company_name, "error_type": type(exc).__name__},
            )
            return None

    def get_supported_fields(self) -> List[str]:
        return self.supported_fields

    def get_confidence(self, result: Dict[str, Any]) -> float:
        """Calculate confidence based on how many fields are populated."""
        if not result:
            return 0.0

        populated = sum(1 for v in result.values() if v is not None)
        return min(populated / len(self.supported_fields), 1.0)




# ── Originally: exchange.py ──


"""Currency exchange rate enrichment source with live API support."""

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


logger = logging.getLogger("neura.domain.enrichment.exchange")

# Common exchange rates (fallback when API is unavailable)
# These are approximate rates as of Jan 2025 and should be used only as fallback
FALLBACK_RATES_USD = {
    # Major currencies
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 149.50,
    "CAD": 1.36,
    "AUD": 1.53,
    "CHF": 0.88,
    "CNY": 7.24,
    # Asian currencies
    "INR": 83.12,
    "KRW": 1325.0,
    "SGD": 1.34,
    "HKD": 7.82,
    "TWD": 31.50,
    "THB": 34.50,
    "MYR": 4.45,
    "IDR": 15800.0,
    "PHP": 56.20,
    "VND": 24500.0,
    "PKR": 278.0,
    "BDT": 110.0,
    # European currencies
    "NOK": 10.65,
    "SEK": 10.42,
    "DKK": 6.87,
    "PLN": 4.02,
    "CZK": 23.20,
    "HUF": 365.0,
    "RON": 4.60,
    "BGN": 1.80,
    "HRK": 6.95,
    "UAH": 41.50,
    "RUB": 92.50,
    "TRY": 32.15,
    # Americas
    "MXN": 17.15,
    "BRL": 4.97,
    "ARS": 875.0,
    "CLP": 950.0,
    "COP": 4050.0,
    "PEN": 3.72,
    # Middle East & Africa
    "ILS": 3.70,
    "AED": 3.67,
    "SAR": 3.75,
    "QAR": 3.64,
    "KWD": 0.31,
    "BHD": 0.38,
    "OMR": 0.38,
    "EGP": 30.90,
    "ZAR": 18.75,
    "NGN": 1580.0,
    "KES": 153.0,
    # Oceania
    "NZD": 1.64,
    "FJD": 2.27,
}

# API configuration
EXCHANGE_RATE_API_KEY = os.getenv("EXCHANGE_RATE_API_KEY", "")
# Free tier APIs (in order of preference):
# 1. exchangerate.host - No API key needed for basic usage
# 2. open.er-api.com - Free tier available
# 3. frankfurter.app - Free ECB rates
EXCHANGE_API_URLS = [
    "https://api.exchangerate.host/latest",  # Free, no key needed
    "https://api.frankfurter.app/latest",    # Free ECB rates
]

# In-memory cache for API rates (refresh every 6 hours)
_RATES_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours


class ExchangeRateSource(EnrichmentSourceBase):
    """
    Enrichment source for currency exchange rates.

    Converts amounts between currencies using live exchange rates from APIs,
    with fallback to cached/hardcoded rates when APIs are unavailable.
    """

    source_type = "exchange_rate"
    supported_fields = [
        "converted_amount",
        "exchange_rate",
        "source_currency",
        "target_currency",
        "rate_date",
        "rate_source",
    ]

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_currency = config.get("base_currency", "USD")
        self.target_currency = config.get("target_currency", "USD")
        self._use_live_rates = config.get("use_live_rates", True)

    @staticmethod
    def _build_api_params(api_url: str, base: str) -> Dict[str, str]:
        if "frankfurter" in api_url or "exchangerate.host" in api_url:
            return {"base": base}
        return {"from": base}

    async def _fetch_live_rates(self, base: str = "USD") -> Optional[Dict[str, float]]:
        """
        Fetch live exchange rates from API.

        Args:
            base: Base currency for rates

        Returns:
            Dictionary of currency -> rate mappings, or None if failed
        """
        global _RATES_CACHE

        cache_key = f"rates_{base}"
        cached = _RATES_CACHE.get(cache_key)
        if cached:
            cache_time = cached.get("_timestamp", 0)
            if time.time() - cache_time < _CACHE_TTL_SECONDS:
                rates = {k: v for k, v in cached.items() if k != "_timestamp"}
                return rates

        # Try httpx first (commonly available in FastAPI projects)
        try:
            import httpx
            return await self._fetch_with_httpx(base, cache_key)
        except ImportError:
            pass

        # Fall back to aiohttp
        try:
            import aiohttp
            return await self._fetch_with_aiohttp(base, cache_key)
        except ImportError:
            pass

        # Last resort: try synchronous requests
        try:
            import requests
            return self._fetch_with_requests_sync(base, cache_key)
        except ImportError:
            logger.warning("No HTTP library available for live rates")
            return None

    async def _fetch_with_httpx(self, base: str, cache_key: str) -> Optional[Dict[str, float]]:
        """Fetch rates using httpx (async)."""
        import httpx
        global _RATES_CACHE

        async with httpx.AsyncClient(timeout=10.0) as client:
            for api_url in EXCHANGE_API_URLS:
                try:
                    params = self._build_api_params(api_url, base)
                    response = await client.get(api_url, params=params)
                    if response.status_code == 200:
                        data = response.json()
                        rates = data.get("rates", {})
                        if rates:
                            _RATES_CACHE[cache_key] = {
                                **rates,
                                "_timestamp": time.time(),
                            }
                            logger.info(
                                f"Fetched live exchange rates from {api_url}",
                                extra={"currencies": len(rates), "base": base},
                            )
                            return rates
                except Exception as exc:
                    logger.debug(f"API {api_url} failed with httpx: {exc}")
                    continue

        logger.warning("All exchange rate APIs failed (httpx), using fallback rates")
        return None

    async def _fetch_with_aiohttp(self, base: str, cache_key: str) -> Optional[Dict[str, float]]:
        """Fetch rates using aiohttp."""
        import aiohttp
        global _RATES_CACHE

        for api_url in EXCHANGE_API_URLS:
            try:
                params = self._build_api_params(api_url, base)
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        api_url,
                        params=params,
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as response:
                        if response.status == 200:
                            data = await response.json()
                            rates = data.get("rates", {})
                            if rates:
                                _RATES_CACHE[cache_key] = {
                                    **rates,
                                    "_timestamp": time.time(),
                                }
                                logger.info(
                                    f"Fetched live exchange rates from {api_url}",
                                    extra={"currencies": len(rates), "base": base},
                                )
                                return rates
            except Exception as exc:
                logger.debug(f"API {api_url} failed with aiohttp: {exc}")
                continue

        logger.warning("All exchange rate APIs failed (aiohttp), using fallback rates")
        return None

    def _fetch_with_requests_sync(self, base: str, cache_key: str) -> Optional[Dict[str, float]]:
        """Fetch rates using requests (sync, last resort)."""
        import requests
        global _RATES_CACHE

        for api_url in EXCHANGE_API_URLS:
            try:
                params = self._build_api_params(api_url, base)
                response = requests.get(api_url, params=params, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    rates = data.get("rates", {})
                    if rates:
                        _RATES_CACHE[cache_key] = {
                            **rates,
                            "_timestamp": time.time(),
                        }
                        logger.info(
                            f"Fetched live exchange rates from {api_url} (sync)",
                            extra={"currencies": len(rates), "base": base},
                        )
                        return rates
            except Exception as exc:
                logger.debug(f"API {api_url} failed with requests: {exc}")
                continue

        logger.warning("All exchange rate APIs failed (requests), using fallback rates")
        return None

    async def lookup(self, value: Any) -> Optional[Dict[str, Any]]:
        """
        Convert currency amount.

        Args:
            value: Can be:
                - A number (uses configured currencies)
                - A dict with 'amount', 'from_currency', 'to_currency'
                - A string like "100 EUR" or "EUR 100"

        Returns:
            Dictionary with converted amount and rate info
        """
        if value is None:
            return None

        try:
            amount: float
            from_currency: str
            to_currency: str

            if isinstance(value, dict):
                amount = float(value.get("amount", 0))
                from_currency = value.get("from_currency", self.base_currency).upper()
                to_currency = value.get("to_currency", self.target_currency).upper()
            elif isinstance(value, (int, float)):
                amount = float(value)
                from_currency = self.base_currency
                to_currency = self.target_currency
            elif isinstance(value, str):
                # Parse string like "100 EUR" or "EUR 100" or "100|EUR"
                if "|" in value:
                    parts = value.strip().split("|")
                    amount = float(parts[0].replace(",", ""))
                    from_currency = parts[1].upper() if len(parts) > 1 else self.base_currency
                else:
                    parts = value.strip().split()
                    if len(parts) == 2:
                        if parts[0].replace(".", "").replace(",", "").replace("-", "").isdigit():
                            amount = float(parts[0].replace(",", ""))
                            from_currency = parts[1].upper()
                        else:
                            from_currency = parts[0].upper()
                            amount = float(parts[1].replace(",", ""))
                    else:
                        amount = float(value.replace(",", ""))
                        from_currency = self.base_currency
                to_currency = self.target_currency
            else:
                return None

            # Get exchange rate (live or fallback)
            rate, source = await self._get_rate_async(from_currency, to_currency)
            if rate is None:
                return None

            converted = amount * rate

            return {
                "converted_amount": round(converted, 2),
                "exchange_rate": round(rate, 6),
                "source_currency": from_currency,
                "target_currency": to_currency,
                "rate_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "rate_source": source,
            }

        except Exception as exc:
            logger.warning(f"Exchange rate lookup failed for '{value}': {exc}")
            return None

    async def _get_rate_async(
        self, from_currency: str, to_currency: str
    ) -> tuple[Optional[float], str]:
        """
        Get exchange rate between two currencies asynchronously.

        Returns:
            Tuple of (rate, source) where source is 'live' or 'fallback'
        """
        if from_currency == to_currency:
            return 1.0, "identity"

        # Try live rates first
        if self._use_live_rates:
            live_rates = await self._fetch_live_rates(from_currency)
            if live_rates:
                rate = live_rates.get(to_currency)
                if rate:
                    return float(rate), "live"
                # Try inverse lookup
                inverse_rates = await self._fetch_live_rates(to_currency)
                if inverse_rates:
                    inverse_rate = inverse_rates.get(from_currency)
                    if inverse_rate:
                        return 1.0 / float(inverse_rate), "live"

        # Fall back to hardcoded rates
        return self._get_fallback_rate(from_currency, to_currency), "fallback"

    def _get_fallback_rate(
        self, from_currency: str, to_currency: str
    ) -> Optional[float]:
        """Get exchange rate from fallback hardcoded rates."""
        if from_currency == to_currency:
            return 1.0

        try:
            if from_currency == "USD":
                rate = FALLBACK_RATES_USD.get(to_currency)
                if rate:
                    return rate
            elif to_currency == "USD":
                rate = FALLBACK_RATES_USD.get(from_currency)
                if rate:
                    return 1.0 / rate
            else:
                # Convert via USD
                from_usd = FALLBACK_RATES_USD.get(from_currency)
                to_usd = FALLBACK_RATES_USD.get(to_currency)
                if from_usd and to_usd:
                    return to_usd / from_usd

            logger.warning(f"No fallback rate found for {from_currency} -> {to_currency}")
            return None

        except Exception as exc:
            logger.error(f"Fallback rate calculation error: {exc}")
            return None

    def get_supported_fields(self) -> List[str]:
        return self.supported_fields

    def get_confidence(self, result: Dict[str, Any]) -> float:
        """
        Exchange rates confidence based on data source.

        Live rates get higher confidence than fallback rates.
        """
        if not result or not result.get("exchange_rate"):
            return 0.0

        rate_source = result.get("rate_source", "fallback")
        if rate_source == "live":
            return 0.99  # High confidence for live API rates
        elif rate_source == "identity":
            return 1.0  # Same currency conversion
        else:
            return 0.85  # Lower confidence for fallback rates

    def validate_config(self) -> bool:
        """Validate source configuration."""
        # No required config for exchange rates
        return True


def clear_exchange_rate_cache() -> None:
    """Clear the in-memory exchange rate cache."""
    global _RATES_CACHE
    _RATES_CACHE.clear()
    logger.info("Exchange rate cache cleared")


def get_exchange_rate_cache_status() -> Dict[str, Any]:
    """Get current exchange rate cache status for monitoring."""
    cache_info = {}
    for key, value in _RATES_CACHE.items():
        if isinstance(value, dict) and "_timestamp" in value:
            cache_info[key] = {
                "currencies": len(value) - 1,  # Exclude _timestamp
                "age_seconds": int(time.time() - value.get("_timestamp", 0)),
                "is_stale": time.time() - value.get("_timestamp", 0) > _CACHE_TTL_SECONDS,
            }
    return {
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
        "cached_bases": list(cache_info.keys()),
        "cache_details": cache_info,
        "fallback_currencies": len(FALLBACK_RATES_USD),
    }


def get_supported_currencies() -> List[str]:
    """Get list of all supported currency codes."""
    return ["USD"] + sorted(FALLBACK_RATES_USD.keys())


async def convert_currency(
    amount: float,
    from_currency: str,
    to_currency: str,
    use_live_rates: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Convenience function to convert currency amounts.

    Args:
        amount: Amount to convert
        from_currency: Source currency code (e.g., "USD")
        to_currency: Target currency code (e.g., "EUR")
        use_live_rates: Whether to try live API rates first

    Returns:
        Conversion result dict or None if failed
    """
    source = ExchangeRateSource({
        "base_currency": from_currency.upper(),
        "target_currency": to_currency.upper(),
        "use_live_rates": use_live_rates,
    })
    return await source.lookup(amount)
