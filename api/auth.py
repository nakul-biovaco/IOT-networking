"""
Production Authentication & Authorization Module.

Provides:
- Device API key validation (ESP32 → Server)
- Dashboard session-based login (Browser → Server)
- Decorator-based route protection
"""

import hashlib
import secrets
import functools
from flask import request, jsonify, session

from config import DEVICE_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD, DASHBOARD_SECRET_KEY
from core.logger import setup_logger

logger = setup_logger("auth")

# In-memory session tokens for stateless API auth (dashboard)
_active_tokens = {}


def _hash_password(password: str) -> str:
    """Simple SHA-256 hash for password comparison."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


# =============================================================================
# DEVICE AUTHENTICATION (ESP32 → Server)
# =============================================================================

def validate_device_token(token: str) -> bool:
    """Validates the X-Device-Token header sent by ESP32 devices."""
    if not token or not DEVICE_API_KEY:
        return False
    return secrets.compare_digest(token.strip(), DEVICE_API_KEY.strip())


def require_device_auth(f):
    """Decorator: Protects ESP32 API endpoints with device token validation."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        token = (
            request.headers.get("X-Device-Token", "") or
            request.headers.get("X-API-Key", "")
        )
        if not token and request.headers.get("Authorization", "").startswith("Bearer "):
            token = request.headers.get("Authorization", "")[7:]

        if not validate_device_token(token):
            logger.warning(
                f"Unauthorized device access attempt from {request.remote_addr} "
                f"to {request.path}"
            )
            return jsonify({
                "success": False,
                "message": "Unauthorized: Invalid or missing device token"
            }), 401
        return f(*args, **kwargs)
    return decorated


# =============================================================================
# DASHBOARD AUTHENTICATION (Browser → Server)
# =============================================================================

def authenticate_admin(username: str, password: str) -> str | None:
    """
    Validates admin credentials and returns a session token on success.
    Returns None on failure.
    """
    if not username or not password:
        return None

    if (secrets.compare_digest(username.strip(), ADMIN_USERNAME) and
            secrets.compare_digest(password.strip(), ADMIN_PASSWORD)):
        token = secrets.token_hex(32)
        _active_tokens[token] = username
        logger.info(f"Admin login successful from {request.remote_addr}")
        return token

    logger.warning(f"Failed admin login attempt from {request.remote_addr} (user: {username})")
    return None


def validate_dashboard_session() -> bool:
    """Checks if the current request has a valid dashboard session."""
    # Local loopback / desktop app is always trusted
    remote = (request.remote_addr or "").strip()
    if remote in ("127.0.0.1", "::1") or remote.startswith("127."):
        return True

    # Check session cookie first
    if session.get("authenticated"):
        return True

    # Check X-Dashboard-Token header (for API clients)
    token = request.headers.get("X-Dashboard-Token", "")
    if token and token in _active_tokens:
        return True

    return False


def logout_session(token: str = None):
    """Invalidates a dashboard session."""
    session.pop("authenticated", None)
    session.pop("username", None)
    if token and token in _active_tokens:
        del _active_tokens[token]


def require_dashboard_auth(f):
    """Decorator: Protects dashboard API endpoints with session validation."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not validate_dashboard_session():
            return jsonify({
                "success": False,
                "message": "Unauthorized: Please login to access the dashboard"
            }), 401
        return f(*args, **kwargs)
    return decorated


def is_local_network_request() -> bool:
    """Check if request comes from localhost or local subnet."""
    remote = request.remote_addr or ""
    return (
        remote in ("127.0.0.1", "::1") or
        remote.startswith("127.") or
        remote.startswith("192.168.") or
        remote.startswith("10.") or
        remote.startswith("172.16.") or
        remote.startswith("172.17.") or
        remote.startswith("172.18.") or
        remote.startswith("172.19.") or
        remote.startswith("172.20.") or
        remote.startswith("172.21.") or
        remote.startswith("172.22.") or
        remote.startswith("172.23.") or
        remote.startswith("172.24.") or
        remote.startswith("172.25.") or
        remote.startswith("172.26.") or
        remote.startswith("172.27.") or
        remote.startswith("172.28.") or
        remote.startswith("172.29.") or
        remote.startswith("172.30.") or
        remote.startswith("172.31.")
    )
