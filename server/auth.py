"""
POWERPLAY CLUB - Administrative Security & Authentication Layer
Protects staff endpoints with cryptographically secure token validation.
"""

import os
import hmac
import hashlib
import time
from typing import Optional
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

ADMIN_API_KEY = os.environ.get("POWERPLAY_ADMIN_KEY", "powerplay_secret_staff_key_2026")
TOKEN_EXPIRY_SECONDS = 3600 * 12  # 12 hours

security_bearer = HTTPBearer(auto_error=False)

OWNER_EMAIL    = os.environ.get("POWERPLAY_OWNER_EMAIL",    "admin@powerplayclub.in")
OWNER_PASSWORD = os.environ.get("POWERPLAY_OWNER_PASSWORD", "change_this_in_production")

def verify_admin_credentials(email: str, password: str) -> bool:
    """
    Validates owner Gmail + password using constant-time comparison.
    """
    if not email or not password:
        return False
    email_ok    = hmac.compare_digest(email.strip().lower(),    OWNER_EMAIL.lower())
    password_ok = hmac.compare_digest(password.strip(), OWNER_PASSWORD)
    return email_ok and password_ok

def verify_admin_token(token: str) -> bool:
    """
    Validates staff bearer token against configured server admin key or signed token.
    Uses constant-time comparison to prevent timing attacks.
    """
    if not token:
        return False
    if hmac.compare_digest(token.strip(), ADMIN_API_KEY.strip()):
        return True
    
    parts = token.split(":")
    if len(parts) == 2:
        try:
            ts = float(parts[0])
            sig = parts[1]
            if time.time() - ts > TOKEN_EXPIRY_SECONDS:
                return False
            expected_sig = hmac.new(
                ADMIN_API_KEY.encode("utf-8"),
                str(ts).encode("utf-8"),
                hashlib.sha256
            ).hexdigest()
            return hmac.compare_digest(sig, expected_sig)
        except Exception:
            return False

    return False

def generate_staff_session_token() -> str:
    """Generates a secure timestamped session token for authenticated staff."""
    ts = str(time.time())
    sig = hmac.new(
        ADMIN_API_KEY.encode("utf-8"),
        ts.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return f"{ts}:{sig}"

async def require_staff_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_bearer)
) -> str:
    """
    FastAPI dependency that enforces valid staff authorization.
    Rejects unauthorized access with HTTP 401.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Staff authentication required. Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    if not verify_admin_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired staff authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return token
