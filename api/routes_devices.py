from flask import Blueprint, jsonify, request

from config import MONITORED_PORTS, PORT_SERVICE_MAP, UNAUTHORIZED_PORTS
from database.models import (
    get_all_devices, get_device_by_id, get_device_health_history,
    whitelist_device, get_dashboard_summary, get_device_ports,
    upsert_device_port,
)
from network.port_scanner import scan_device_ports
from security.anomaly_detector import check_unauthorized_ports

devices_bp = Blueprint("devices", __name__)


@devices_bp.route("/api/dashboard/summary")
def dashboard_summary():
    try:
        summary = get_dashboard_summary()

        # Add production monitoring metadata
        try:
            from core.scheduler import get_worker_status
            summary["workers"] = get_worker_status()
        except Exception:
            pass

        try:
            from api.routes_realtime import get_connected_client_count
            summary["sse_clients"] = get_connected_client_count()
        except Exception:
            pass

        return jsonify(summary)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "total_devices": 0, "online": 0, "degraded": 0, "offline": 0, "active_alerts": 0, "avg_latency_ms": 0.0}), 200


@devices_bp.route("/api/devices")
def list_devices():
    try:
        include_offline = request.args.get("include_offline", "0") == "1"
        devices = get_all_devices(active_only=not include_offline)
        return jsonify(devices)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify([])


@devices_bp.route("/api/system/reset", methods=["POST"])
def system_reset():
    """Flushes all stale/offline records and rediscovers live physical network from scratch."""
    try:
        from database.models import reset_all_system, upsert_device, update_device_status
        from network.discovery import discover_devices
        from network.health import ping_burst
        import threading

        # 1. Atomically wipe all tables
        reset_all_system()

        # 2. Rediscover active physical network in background daemon
        def bg_rediscover():
            try:
                devices = discover_devices()
                for dev in devices:
                    dev_id = upsert_device(
                        ip=dev["ip_address"],
                        mac=dev["mac_address"],
                        vendor=dev.get("vendor", "Unknown"),
                        hostname=dev.get("hostname", "Unknown"),
                        device_type=dev.get("device_type", "generic"),
                    )
                    res = ping_burst(dev["ip_address"])
                    update_device_status(dev_id, res["status"])
            except Exception as ex:
                print(f"[SYSTEM_RESET_BG_ERROR] {ex}")

        threading.Thread(target=bg_rediscover, daemon=True).start()

        return jsonify({
            "success": True,
            "message": "Entire monitoring system reset successfully. Active physical network rediscovery initiated.",
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@devices_bp.route("/api/devices/<int:device_id>/history")
def device_history(device_id):
    try:
        history = get_device_health_history(device_id)
        return jsonify(history)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify([])


@devices_bp.route("/api/devices/<int:device_id>/whitelist", methods=["POST"])
def whitelist(device_id):
    success = whitelist_device(device_id)
    if success:
        return jsonify({"success": True, "is_known": 1})
    return jsonify({"success": False, "message": "Device not found"}), 404


@devices_bp.route("/api/devices/<int:device_id>/ports")
def device_ports(device_id):
    dev = get_device_by_id(device_id)
    if not dev:
        return jsonify({"success": False, "message": "Device not found"}), 404

    db_ports = {p["port_number"]: p for p in get_device_ports(device_id)}
    results = []
    for port in MONITORED_PORTS:
        service = PORT_SERVICE_MAP.get(port, "Unknown")
        is_unauth = port in UNAUTHORIZED_PORTS
        is_open = port in db_ports
        results.append({
            "port": port,
            "service": service,
            "is_open": is_open,
            "is_unauthorized": is_unauth,
            "last_checked": db_ports[port]["last_checked"] if is_open else None,
        })
    return jsonify(results)


@devices_bp.route("/api/devices/<int:device_id>/scan-ports", methods=["POST"])
def scan_ports(device_id):
    dev = get_device_by_id(device_id)
    if not dev:
        return jsonify({"success": False, "message": "Device not found"}), 404

    open_ports = scan_device_ports(dev["ip_address"])
    for port_info in open_ports:
        upsert_device_port(
            device_id=dev["id"],
            port=port_info["port_number"],
            service=port_info["service_name"],
        )
    check_unauthorized_ports(dev["id"], dev["ip_address"], open_ports)

    open_port_nums = {p["port_number"] for p in open_ports}
    results = []
    for port in MONITORED_PORTS:
        results.append({
            "port": port,
            "service": PORT_SERVICE_MAP.get(port, "Unknown"),
            "is_open": port in open_port_nums,
            "is_unauthorized": port in UNAUTHORIZED_PORTS,
        })
    return jsonify({"success": True, "ports": results})


@devices_bp.route("/api/system/logs", methods=["GET"])
def get_system_logs():
    from core.logger import get_recent_logs
    return jsonify(get_recent_logs())
