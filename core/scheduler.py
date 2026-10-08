import threading
import sys
import time

from core.logger import setup_logger
from network.discovery import discover_devices
from network.health import ping_burst
from network.port_scanner import scan_device_ports
from security.anomaly_detector import (
    check_new_device, check_ip_mac_conflict, check_unauthorized_ports,
)
from database.models import (
    upsert_device, get_all_devices, get_device_by_ip,
    update_device_status, insert_health_metric, upsert_device_port,
)
from config import (
    DISCOVERY_INTERVAL, HEALTH_CHECK_INTERVAL, SECURITY_SCAN_INTERVAL,
    DATA_CLEANUP_INTERVAL, DATA_RETENTION_HOURS, ALERT_RETENTION_DAYS,
)

logger = setup_logger("scheduler")

_stop_event = threading.Event()
_worker_threads = []


def _broadcast_safe(event_type, data):
    """Safely broadcast SSE events — no-op if SSE module isn't loaded yet."""
    try:
        from api.routes_realtime import broadcast_event
        broadcast_event(event_type, data)
    except Exception:
        pass


def discovery_worker():
    while not _stop_event.is_set():
        try:
            logger.info("Starting live real network discovery...")
            devices = discover_devices()
            for dev in devices:
                existing = get_device_by_ip(dev["ip_address"])

                if existing and existing["mac_address"] != dev["mac_address"]:
                    check_ip_mac_conflict(
                        existing["id"], dev["ip_address"],
                        existing["mac_address"], dev["mac_address"],
                    )

                device_id = upsert_device(
                    ip=dev["ip_address"],
                    mac=dev["mac_address"],
                    vendor=dev.get("vendor", "Unknown"),
                    hostname=dev.get("hostname", "Unknown"),
                    device_type=dev.get("device_type", "generic"),
                )

                is_known = existing["is_known"] if existing else 0
                check_new_device(device_id, dev["ip_address"], dev["mac_address"], is_known)

            logger.info(f"Discovery complete. Found {len(devices)} real active devices.")

            # Push discovery summary to dashboard
            _broadcast_safe("device_update", {
                "event": "discovery_complete",
                "device_count": len(devices),
            })
        except Exception as e:
            logger.error(f"Discovery error: {e}")
        _stop_event.wait(DISCOVERY_INTERVAL)


def health_worker():
    _stop_event.wait(2)
    while not _stop_event.is_set():
        try:
            devices = get_all_devices()
            for dev in devices:
                if _stop_event.is_set():
                    break
                # Real ICMP ping burst across physical network
                metrics = ping_burst(dev["ip_address"])
                try:
                    old_status = dev.get("status", "offline")
                    new_status = metrics["status"]
                    update_device_status(dev["id"], new_status)
                    insert_health_metric(
                        device_id=dev["id"],
                        latency=metrics["latency_ms"],
                        loss=metrics["packet_loss_pct"],
                        jitter=metrics["jitter_ms"],
                    )

                    # Push real-time health update to dashboard
                    _broadcast_safe("health", {
                        "device_id": dev["id"],
                        "ip": dev["ip_address"],
                        "status": new_status,
                        "latency_ms": metrics["latency_ms"],
                        "packet_loss_pct": metrics["packet_loss_pct"],
                        "jitter_ms": metrics["jitter_ms"],
                    })

                    # Push status change event if device went online/offline
                    if old_status != new_status:
                        _broadcast_safe("device_update", {
                            "event": "status_change",
                            "device_id": dev["id"],
                            "ip": dev["ip_address"],
                            "old_status": old_status,
                            "new_status": new_status,
                        })
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"Health check error: {e}")
        _stop_event.wait(HEALTH_CHECK_INTERVAL)


def security_worker():
    _stop_event.wait(10)
    while not _stop_event.is_set():
        try:
            devices = get_all_devices()
            for dev in devices:
                check_new_device(
                    dev["id"], dev["ip_address"],
                    dev["mac_address"], dev["is_known"],
                )
                if dev["status"] != "offline":
                    open_ports = scan_device_ports(dev["ip_address"])
                    for port_info in open_ports:
                        upsert_device_port(
                            device_id=dev["id"],
                            port=port_info["port_number"],
                            service=port_info["service_name"],
                        )
                    check_unauthorized_ports(dev["id"], dev["ip_address"], open_ports)
        except Exception as e:
            logger.error(f"Security scan error: {e}")
        _stop_event.wait(SECURITY_SCAN_INTERVAL)


def data_cleanup_worker():
    """Periodically prunes old health metrics, telemetry, and resolved alerts."""
    _stop_event.wait(30)  # Wait for system to stabilize
    while not _stop_event.is_set():
        try:
            from database.db import get_connection, db_write_lock
            with db_write_lock:
                conn = get_connection()

                # Prune health_metrics older than DATA_RETENTION_HOURS
                conn.execute(
                    "DELETE FROM health_metrics WHERE recorded_at < datetime('now', ?)",
                    (f"-{DATA_RETENTION_HOURS} hours",)
                )

                # Prune esp32_telemetry older than DATA_RETENTION_HOURS
                conn.execute(
                    "DELETE FROM esp32_telemetry WHERE recorded_at < datetime('now', ?)",
                    (f"-{DATA_RETENTION_HOURS} hours",)
                )

                # Prune resolved security_alerts older than ALERT_RETENTION_DAYS
                conn.execute(
                    "DELETE FROM security_alerts WHERE is_resolved = 1 AND created_at < datetime('now', ?)",
                    (f"-{ALERT_RETENTION_DAYS} days",)
                )

                conn.commit()

            logger.info(
                f"Data cleanup complete: Pruned records older than "
                f"{DATA_RETENTION_HOURS}h (metrics/telemetry), {ALERT_RETENTION_DAYS}d (resolved alerts)"
            )
        except Exception as e:
            logger.error(f"Data cleanup error: {e}")
        _stop_event.wait(DATA_CLEANUP_INTERVAL)


def run_manual_scan():
    try:
        logger.info("Manual real network scan triggered.")
        devices = discover_devices()
        for dev in devices:
            existing = get_device_by_ip(dev["ip_address"])

            if existing and existing["mac_address"] != dev["mac_address"]:
                check_ip_mac_conflict(
                    existing["id"], dev["ip_address"],
                    existing["mac_address"], dev["mac_address"],
                )

            device_id = upsert_device(
                ip=dev["ip_address"],
                mac=dev["mac_address"],
                vendor=dev.get("vendor", "Unknown"),
                hostname=dev.get("hostname", "Unknown"),
                device_type=dev.get("device_type", "generic"),
            )

            is_known = existing["is_known"] if existing else 0
            check_new_device(device_id, dev["ip_address"], dev["mac_address"], is_known)

        logger.info(f"Manual scan complete. Found {len(devices)} real active devices.")
    except Exception as e:
        logger.error(f"Manual scan error: {e}")


def _resilient_worker(target_fn, worker_name):
    """Wraps a worker function with crash recovery — auto-restarts on failure."""
    while not _stop_event.is_set():
        try:
            target_fn()
        except Exception as e:
            logger.error(f"Worker '{worker_name}' crashed: {e}. Auto-restarting in 5s...")
            _stop_event.wait(5)
            if not _stop_event.is_set():
                logger.info(f"Worker '{worker_name}' restarting after crash recovery.")


def start_workers():
    global _worker_threads
    _stop_event.clear()

    worker_specs = [
        (discovery_worker, "discovery"),
        (health_worker, "health"),
        (security_worker, "security"),
        (data_cleanup_worker, "data_cleanup"),
    ]

    _worker_threads = []
    for fn, name in worker_specs:
        t = threading.Thread(
            target=_resilient_worker,
            args=(fn, name),
            daemon=True,
            name=name,
        )
        t.start()
        _worker_threads.append(t)

    logger.info(f"All {len(_worker_threads)} production monitoring workers started (with crash recovery).")
    return _worker_threads


def stop_workers():
    _stop_event.set()
    logger.info("Stop signal sent to all workers.")


def is_monitoring_active() -> bool:
    return not _stop_event.is_set()


def get_worker_status() -> list:
    """Returns health status of all worker threads."""
    statuses = []
    for t in _worker_threads:
        statuses.append({
            "name": t.name,
            "alive": t.is_alive(),
        })
    return statuses
