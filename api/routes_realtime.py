"""
Server-Sent Events (SSE) Real-Time Streaming Module.

Replaces HTTP polling with push-based live updates for the dashboard.
Supports multiple concurrent SSE clients with thread-safe event broadcasting.
"""

import json
import time
import queue
import threading
from flask import Blueprint, Response, stream_with_context

from core.logger import setup_logger

logger = setup_logger("sse")

realtime_bp = Blueprint("realtime", __name__)

# Thread-safe set of client queues
_clients = []
_clients_lock = threading.Lock()


def broadcast_event(event_type: str, data: dict):
    """
    Broadcasts an SSE event to all connected dashboard clients.
    
    Event types:
        - device_update: Device status changed (online/offline/degraded)
        - telemetry: New ESP32 telemetry received
        - alert: New security alert created
        - health: Health metrics updated
        - summary: Dashboard summary stats updated
    """
    event_data = json.dumps(data, default=str)
    message = f"event: {event_type}\ndata: {event_data}\n\n"

    dead_clients = []
    with _clients_lock:
        for client_queue in _clients:
            try:
                client_queue.put_nowait(message)
            except queue.Full:
                dead_clients.append(client_queue)

        for dead in dead_clients:
            try:
                _clients.remove(dead)
            except ValueError:
                pass


def _sse_stream():
    """Generator that yields SSE events for a single client connection."""
    client_queue = queue.Queue(maxsize=100)

    with _clients_lock:
        _clients.append(client_queue)

    logger.info(f"SSE client connected. Total clients: {len(_clients)}")

    try:
        # Send initial connection confirmation
        yield f"event: connected\ndata: {{\"status\": \"ok\", \"timestamp\": \"{time.strftime('%Y-%m-%d %H:%M:%S')}\"}}\n\n"

        while True:
            try:
                # Wait up to 30s for an event, then send keepalive
                message = client_queue.get(timeout=30)
                yield message
            except queue.Empty:
                # Send keepalive comment to prevent connection timeout
                yield ": keepalive\n\n"
    except GeneratorExit:
        pass
    finally:
        with _clients_lock:
            try:
                _clients.remove(client_queue)
            except ValueError:
                pass
        logger.info(f"SSE client disconnected. Remaining clients: {len(_clients)}")


@realtime_bp.route("/api/stream")
def sse_stream():
    """SSE endpoint — dashboard connects here for real-time push updates."""
    response = Response(
        stream_with_context(_sse_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )
    return response


def get_connected_client_count() -> int:
    """Returns the number of currently connected SSE clients."""
    with _clients_lock:
        return len(_clients)
