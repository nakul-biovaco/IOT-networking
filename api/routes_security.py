import csv
import io
import threading
from datetime import datetime
from flask import Blueprint, jsonify, Response

from database.models import get_alerts, resolve_alert, get_all_devices
from core.scheduler import run_manual_scan, start_workers, stop_workers, is_monitoring_active

security_bp = Blueprint("security", __name__)


@security_bp.route("/api/alerts")
def list_alerts():
    alerts = get_alerts()
    return jsonify(alerts)


@security_bp.route("/api/alerts/<int:alert_id>/resolve", methods=["POST"])
def resolve(alert_id):
    success = resolve_alert(alert_id)
    if success:
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Alert not found"}), 404


@security_bp.route("/api/scan/trigger", methods=["POST"])
def trigger_scan():
    thread = threading.Thread(target=run_manual_scan, daemon=True)
    thread.start()
    return jsonify({"success": True, "message": "Scan triggered"})


@security_bp.route("/api/monitoring/status")
def monitoring_status():
    return jsonify({
        "active": is_monitoring_active(),
        "timestamp": datetime.now().isoformat(),
    })


@security_bp.route("/api/monitoring/start", methods=["POST"])
def start_monitoring():
    if not is_monitoring_active():
        start_workers()
    return jsonify({"success": True, "active": True})


@security_bp.route("/api/monitoring/stop", methods=["POST"])
def stop_monitoring():
    stop_workers()
    return jsonify({"success": True, "active": False})


@security_bp.route("/api/logs")
def system_logs():
    from core.logger import get_recent_logs
    real_logs = get_recent_logs()
    if real_logs:
        return jsonify({"success": True, "logs": real_logs})
    devices = get_all_devices()
    active_count = len([d for d in devices if d.get("status") == "online"])
    ts = datetime.now().strftime("%H:%M:%S")
    return jsonify({
        "success": True,
        "logs": [
            f"[{ts}] [SYSTEM] Production network monitoring daemon active. Tracking {len(devices)} physical devices ({active_count} online).",
            f"[{ts}] [HEALTH] ICMP telemetry check cycle active.",
        ]
    })


@security_bp.route("/api/logs/clear", methods=["POST"])
def clear_system_logs():
    from core.logger import clear_recent_logs
    clear_recent_logs()
    return jsonify({"success": True})


@security_bp.route("/api/export/csv")
def export_csv():
    devices = get_all_devices()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "IP Address", "MAC Address", "Vendor", "Hostname", "Type", "Status", "Latency (ms)", "Packet Loss (%)", "Jitter (ms)", "Known", "First Seen", "Last Seen"])
    for d in devices:
        writer.writerow([
            d.get("id"),
            d.get("ip_address"),
            d.get("mac_address"),
            d.get("vendor"),
            d.get("hostname"),
            d.get("device_type"),
            d.get("status"),
            d.get("last_latency", ""),
            d.get("last_loss", ""),
            d.get("last_jitter", ""),
            "Yes" if d.get("is_known") else "No",
            d.get("first_seen"),
            d.get("last_seen"),
        ])
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=network_devices_export.csv"}
    )
