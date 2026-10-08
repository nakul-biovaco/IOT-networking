from database.models import insert_alert, check_existing_alert
from config import UNAUTHORIZED_PORTS


def _broadcast_alert_safe(device_id, alert_type, severity, message):
    """Push new alert to dashboard via SSE."""
    try:
        from api.routes_realtime import broadcast_event
        broadcast_event("alert", {
            "device_id": device_id,
            "alert_type": alert_type,
            "severity": severity,
            "message": message,
        })
    except Exception:
        pass


def check_new_device(device_id: int, ip: str, mac: str, is_known: int):
    if is_known == 0:
        if not check_existing_alert(device_id, "NEW_DEVICE"):
            msg = f"Unrecognized device detected: {ip} ({mac})"
            insert_alert(
                device_id=device_id,
                alert_type="NEW_DEVICE",
                severity="WARNING",
                message=msg,
            )
            _broadcast_alert_safe(device_id, "NEW_DEVICE", "WARNING", msg)


def check_ip_mac_conflict(device_id: int, ip: str, old_mac: str, new_mac: str):
    if not old_mac or not new_mac or old_mac == new_mac:
        return
    invalid_patterns = ("PENDING", "DYNAMIC", "00:00:00:00:00", "UNKNOWN")
    if any(p in old_mac.upper() for p in invalid_patterns) or any(p in new_mac.upper() for p in invalid_patterns):
        return

    if not check_existing_alert(device_id, "IP_CONFLICT"):
        msg = f"IP {ip} changed MAC address from {old_mac} to {new_mac} (Potential ARP Spoofing / IP Conflict)"
        insert_alert(
            device_id=device_id,
            alert_type="IP_CONFLICT",
            severity="CRITICAL",
            message=msg,
        )
        _broadcast_alert_safe(device_id, "IP_CONFLICT", "CRITICAL", msg)


def check_unauthorized_ports(device_id: int, ip: str, open_ports: list):
    for port_info in open_ports:
        port = port_info["port_number"]
        if port in UNAUTHORIZED_PORTS:
            if not check_existing_alert(device_id, "UNAUTHORIZED_PORT"):
                msg = f"Dangerous port {port} ({port_info['service_name']}) open on {ip}"
                insert_alert(
                    device_id=device_id,
                    alert_type="UNAUTHORIZED_PORT",
                    severity="CRITICAL",
                    message=msg,
                )
                _broadcast_alert_safe(device_id, "UNAUTHORIZED_PORT", "CRITICAL", msg)
