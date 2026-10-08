"""
Dashboard Authentication Routes.

Provides login/logout endpoints and session management for the dashboard UI.
"""

from flask import Blueprint, request, jsonify, session

from api.auth import authenticate_admin, logout_session, validate_dashboard_session
from core.logger import setup_logger

logger = setup_logger("auth_routes")

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    """Authenticates admin user and creates a session."""
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if not username or not password:
        return jsonify({
            "success": False,
            "message": "Username and password are required"
        }), 400

    token = authenticate_admin(username, password)
    if token:
        session["authenticated"] = True
        session["username"] = username
        session["token"] = token
        return jsonify({
            "success": True,
            "message": "Login successful",
            "username": username,
            "token": token,
        })

    return jsonify({
        "success": False,
        "message": "Invalid username or password"
    }), 401


@auth_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    """Logs out the current user and destroys the session."""
    token = session.get("token")
    logout_session(token)
    return jsonify({"success": True, "message": "Logged out successfully"})


@auth_bp.route("/api/auth/status")
def auth_status():
    """Returns current authentication status."""
    is_auth = validate_dashboard_session()
    return jsonify({
        "authenticated": is_auth,
        "username": session.get("username", None) if is_auth else None,
    })
