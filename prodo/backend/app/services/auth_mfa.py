# mypy: ignore-errors
"""
Multi-Factor Authentication (MFA) service using TOTP (merged from V1 auth_mfa.py).

Provides:
- TOTP secret generation and QR code URIs
- TOTP code verification (RFC 6238)
- Recovery codes generation and validation
- MFAService for enrollment and verification
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

logger = logging.getLogger("neura.auth.mfa")

TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_ALGORITHM = "sha1"
TOTP_ISSUER = "NeuraReport"
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_LENGTH = 8


@dataclass
class MFAEnrollment:
    secret: str
    provisioning_uri: str
    recovery_codes: list[str]


@dataclass
class MFAVerification:
    valid: bool
    method: str
    recovery_code_used: Optional[str] = None


def generate_secret(length: int = 32) -> str:
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def generate_provisioning_uri(secret: str, user_email: str, issuer: str = TOTP_ISSUER) -> str:
    label = quote(f"{issuer}:{user_email}", safe="")
    params = f"secret={secret}&issuer={quote(issuer)}&algorithm={TOTP_ALGORITHM.upper()}&digits={TOTP_DIGITS}&period={TOTP_PERIOD}"
    return f"otpauth://totp/{label}?{params}"


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT, length: int = RECOVERY_CODE_LENGTH) -> list[str]:
    codes = []
    for _ in range(count):
        code = secrets.token_hex(length // 2).upper()
        codes.append(f"{code[:4]}-{code[4:]}")
    return codes


def _decode_secret(secret: str) -> bytes:
    padding = (8 - len(secret) % 8) % 8
    return base64.b32decode((secret + "=" * padding).upper())


def _hotp(secret_bytes: bytes, counter: int) -> str:
    counter_bytes = counter.to_bytes(8, byteorder="big")
    mac = hmac.new(secret_bytes, counter_bytes, hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    truncated = ((mac[offset] & 0x7F) << 24) | ((mac[offset + 1] & 0xFF) << 16) | ((mac[offset + 2] & 0xFF) << 8) | (mac[offset + 3] & 0xFF)
    return str(truncated % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def generate_totp(secret: str, timestamp: Optional[float] = None) -> str:
    ts = timestamp or time.time()
    return _hotp(_decode_secret(secret), int(ts) // TOTP_PERIOD)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    if not code or not secret:
        return False
    code = code.strip().replace(" ", "").replace("-", "")
    if len(code) != TOTP_DIGITS:
        return False
    current_counter = int(time.time()) // TOTP_PERIOD
    for offset in range(-window, window + 1):
        if hmac.compare_digest(code, generate_totp(secret, (current_counter + offset) * TOTP_PERIOD)):
            return True
    return False


def verify_recovery_code(code: str, stored_codes: list[str]) -> tuple[bool, Optional[str]]:
    normalized = code.strip().upper().replace(" ", "")
    for stored in stored_codes:
        if hmac.compare_digest(normalized, stored.strip().upper().replace(" ", "")):
            return True, stored
    return False, None


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().replace(" ", "").encode()).hexdigest()


class MFAService:
    def __init__(self) -> None:
        self._logger = logging.getLogger("neura.auth.mfa.service")

    def enroll(self, user_id: str, user_email: str) -> MFAEnrollment:
        """Enroll a user in MFA (RFC 6238 TOTP)."""
        secret = generate_secret()
        enrollment = MFAEnrollment(
            secret=secret,
            provisioning_uri=generate_provisioning_uri(secret, user_email),
            recovery_codes=generate_recovery_codes(),
        )
        self._logger.info("mfa_enrolled", extra={
            "event": "mfa_enrolled", "user_id": user_id,
        })
        return enrollment

    def verify(self, secret: str, code: str, recovery_codes: Optional[list[str]] = None) -> MFAVerification:
        """Verify a TOTP code or recovery code."""
        if verify_totp(secret, code):
            return MFAVerification(valid=True, method="totp")
        if recovery_codes:
            valid, used = verify_recovery_code(code, recovery_codes)
            if valid:
                self._logger.info("mfa_recovery_code_used", extra={
                    "event": "mfa_recovery_code_used",
                })
                return MFAVerification(valid=True, method="recovery", recovery_code_used=used)
        return MFAVerification(valid=False, method="none")

    def regenerate_recovery_codes(self, user_id: str) -> list[str]:
        """Regenerate recovery codes for a user."""
        codes = generate_recovery_codes()
        self._logger.info("mfa_recovery_codes_regenerated", extra={
            "event": "mfa_recovery_codes_regenerated", "user_id": user_id,
        })
        return codes


def get_mfa_service() -> MFAService:
    return MFAService()
