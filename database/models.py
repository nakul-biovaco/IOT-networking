from database.db import get_connection, db_write_lock
from config import HEALTH_HISTORY_LIMIT


def upsert_device(ip: str, mac: str, vendor: str = "Unknown",
                  hostname: str = "Unknown", device_type: str = "generic",
                  parent_device_id: int = None, mesh_layer: int = 0,
                  mesh_role: str = None, router_ssid: str = None, status: str = None) -> int:
    with db_write_lock:
        conn = get_connection()
        existing = conn.execute(
            "SELECT id, mac_address FROM devices WHERE ip_address = ?", (ip,)
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE devices SET mac_address = ?, vendor = ?, hostname = ?,
                   parent_device_id = COALESCE(?, parent_device_id),
                   mesh_layer = COALESCE(?, mesh_layer),
                   mesh_role = COALESCE(?, mesh_role),
                   router_ssid = COALESCE(?, router_ssid),
                   status = COALESCE(?, status),
                   last_seen = CURRENT_TIMESTAMP WHERE id = ?""",
                (mac, vendor, hostname, parent_device_id, mesh_layer, mesh_role, router_ssid, status, existing["id"]),
            )
            if device_type != "generic":
                conn.execute(
                    "UPDATE devices SET device_type = ? WHERE id = ?",
                    (device_type, existing["id"]),
                )
            conn.commit()
            return existing["id"]

        cursor = conn.execute(
            """INSERT INTO devices (ip_address, mac_address, vendor, hostname, device_type,
                                    parent_device_id, mesh_layer, mesh_role, router_ssid, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'online'))""",
            (ip, mac, vendor, hostname, device_type, parent_device_id, mesh_layer, mesh_role, router_ssid, status),
        )
        conn.commit()
        return cursor.lastrowid



def get_all_devices(active_only: bool = False) -> list:
    conn = get_connection()
    query = """
        SELECT d.*,
            (SELECT latency_ms FROM health_metrics
             WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1) as last_latency,
            (SELECT packet_loss_pct FROM health_metrics
             WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1) as last_loss,
            (SELECT jitter_ms FROM health_metrics
             WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1) as last_jitter
        FROM devices d
    """
    if active_only:
        query += " WHERE d.status != 'offline'"
    query += " ORDER BY d.last_seen DESC"
    rows = conn.execute(query).fetchall()
    return [dict(row) for row in rows]


def reset_all_system():
    """Completely flushes historical tables and stale device caches for full system reset."""
    with db_write_lock:
        conn = get_connection()
        conn.execute("DELETE FROM health_metrics")
        conn.execute("DELETE FROM security_alerts")
        conn.execute("DELETE FROM device_ports")
        conn.execute("DELETE FROM esp32_telemetry")
        conn.execute("DELETE FROM devices")
        conn.commit()


def get_device_by_id(device_id: int) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
    return dict(row) if row else None


def get_device_by_ip(ip: str) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM devices WHERE ip_address = ?", (ip,)).fetchone()
    return dict(row) if row else None


def update_device_status(device_id: int, status: str):
    with db_write_lock:
        conn = get_connection()
        if status != "offline":
            conn.execute(
                "UPDATE devices SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?",
                (status, device_id),
            )
        else:
            conn.execute(
                "UPDATE devices SET status = ? WHERE id = ?",
                (status, device_id),
            )
        conn.commit()


def whitelist_device(device_id: int) -> bool:
    with db_write_lock:
        conn = get_connection()
        cursor = conn.execute(
            "UPDATE devices SET is_known = 1 WHERE id = ?", (device_id,)
        )
        conn.commit()

        if cursor.rowcount > 0:
            conn.execute(
                """UPDATE security_alerts SET is_resolved = 1
                   WHERE device_id = ? AND alert_type = 'NEW_DEVICE' AND is_resolved = 0""",
                (device_id,),
            )
            conn.commit()
            return True
        return False


def insert_health_metric(device_id: int, latency: float, loss: float, jitter: float):
    with db_write_lock:
        conn = get_connection()
        try:
            conn.execute(
                """INSERT INTO health_metrics (device_id, latency_ms, packet_loss_pct, jitter_ms)
                   VALUES (?, ?, ?, ?)""",
                (device_id, latency, loss, jitter),
            )
            conn.commit()
        except Exception:
            pass


def get_device_health_history(device_id: int, limit: int = HEALTH_HISTORY_LIMIT) -> list:
    conn = get_connection()
    rows = conn.execute(
        """SELECT latency_ms, packet_loss_pct, jitter_ms, recorded_at
           FROM health_metrics WHERE device_id = ?
           ORDER BY recorded_at DESC LIMIT ?""",
        (device_id, limit),
    ).fetchall()
    return [dict(row) for row in reversed(rows)]


def insert_esp32_telemetry(device_id: int, rssi: int, free_heap: int, uptime_sec: int):
    with db_write_lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO esp32_telemetry (device_id, rssi, free_heap, uptime_sec)
               VALUES (?, ?, ?, ?)""",
            (device_id, rssi, free_heap, uptime_sec),
        )
        conn.commit()


def get_latest_esp32_telemetry() -> dict | None:
    conn = get_connection()
    row = conn.execute("""
        SELECT t.*, d.ip_address, d.mac_address, d.status
        FROM esp32_telemetry t
        JOIN devices d ON t.device_id = d.id
        WHERE d.device_type = 'esp32'
        ORDER BY t.recorded_at DESC LIMIT 1
    """).fetchone()
    return dict(row) if row else None


def upsert_device_port(device_id: int, port: int, service: str, authorized: int = 1):
    with db_write_lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO device_ports (device_id, port_number, service_name, is_authorized, last_checked)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(device_id, port_number) DO UPDATE SET
                   service_name = excluded.service_name,
                   last_checked = CURRENT_TIMESTAMP""",
            (device_id, port, service, authorized),
        )
        conn.commit()


def get_device_ports(device_id: int) -> list:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM device_ports WHERE device_id = ? ORDER BY port_number ASC",
        (device_id,),
    ).fetchall()
    return [dict(row) for row in rows]



def insert_alert(device_id: int, alert_type: str, severity: str, message: str):
    with db_write_lock:
        conn = get_connection()
        conn.execute(
            """INSERT INTO security_alerts (device_id, alert_type, severity, message)
               VALUES (?, ?, ?, ?)""",
            (device_id, alert_type, severity, message),
        )
        conn.commit()


def check_existing_alert(device_id: int, alert_type: str) -> bool:
    conn = get_connection()
    row = conn.execute(
        """SELECT id FROM security_alerts
           WHERE device_id = ? AND alert_type = ? AND is_resolved = 0""",
        (device_id, alert_type),
    ).fetchone()
    return row is not None


def get_alerts(resolved: int = None) -> list:
    conn = get_connection()
    if resolved is not None:
        rows = conn.execute(
            "SELECT * FROM security_alerts WHERE is_resolved = ? ORDER BY created_at DESC",
            (resolved,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM security_alerts ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def resolve_alert(alert_id: int) -> bool:
    with db_write_lock:
        conn = get_connection()
        cursor = conn.execute(
            "UPDATE security_alerts SET is_resolved = 1 WHERE id = ?", (alert_id,)
        )
        conn.commit()
        return cursor.rowcount > 0


def get_dashboard_summary() -> dict:
    conn = get_connection()
    total = conn.execute("SELECT COUNT(*) as count FROM devices").fetchone()["count"]
    online = conn.execute(
        "SELECT COUNT(*) as count FROM devices WHERE status = 'online'"
    ).fetchone()["count"]
    degraded = conn.execute(
        "SELECT COUNT(*) as count FROM devices WHERE status = 'degraded'"
    ).fetchone()["count"]
    offline = conn.execute(
        "SELECT COUNT(*) as count FROM devices WHERE status = 'offline'"
    ).fetchone()["count"]
    alerts = conn.execute(
        "SELECT COUNT(*) as count FROM security_alerts WHERE is_resolved = 0"
    ).fetchone()["count"]
    esp32 = conn.execute(
        "SELECT COUNT(*) as count FROM devices WHERE device_type = 'esp32' AND status = 'online'"
    ).fetchone()["count"]

    avg_row = conn.execute("""
        SELECT AVG(hm.latency_ms) as avg_latency
        FROM health_metrics hm
        JOIN devices d ON hm.device_id = d.id
        WHERE d.status = 'online'
        AND hm.id IN (SELECT MAX(id) FROM health_metrics GROUP BY device_id)
    """).fetchone()
    avg_latency = round(avg_row["avg_latency"], 2) if (avg_row and avg_row["avg_latency"] is not None) else 0.0

    from network.discovery import get_local_ip, get_default_gateway
    local_ip = get_local_ip()
    gateway_ip = get_default_gateway(local_ip)
    prefix = ".".join(local_ip.split(".")[:3])
    subnet = f"{prefix}.0/24"

    return {
        "total_devices": total,
        "online": online,
        "degraded": degraded,
        "offline": offline,
        "active_alerts": alerts,
        "esp32_connected": esp32 > 0,
        "avg_latency_ms": avg_latency,
        "subnet": subnet,
        "gateway_ip": gateway_ip,
        "local_ip": local_ip,
    }


# -----------------------------------------------------------------------------
# MULTI-NETWORK & USER-SELECTABLE ROUTER DEVICE MAPPING
# -----------------------------------------------------------------------------

def upsert_network(ssid: str, bssid: str = "", vendor: str = "Unknown",
                   signal_pct: int = 0, band: str = "2.4 GHz", channel: int = 1,
                   security_type: str = "WPA2-Personal", gateway_ip: str = None,
                   is_current_connected: int = 0, network_type: str = "in_range") -> int:
    with db_write_lock:
        conn = get_connection()
        existing = conn.execute(
            "SELECT id FROM networks WHERE ssid = ? AND (bssid = ? OR bssid IS NULL OR bssid = '')",
            (ssid, bssid)
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE networks SET vendor = ?, signal_pct = ?, band = ?,
                   channel = ?, security_type = ?, gateway_ip = COALESCE(?, gateway_ip),
                   is_current_connected = ?, network_type = ?, last_seen = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (vendor, signal_pct, band, channel, security_type, gateway_ip,
                 is_current_connected, network_type, existing["id"]),
            )
            conn.commit()
            return existing["id"]

        cursor = conn.execute(
            """INSERT INTO networks (ssid, bssid, vendor, signal_pct, band, channel,
                                     security_type, gateway_ip, is_current_connected, network_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ssid, bssid, vendor, signal_pct, band, channel, security_type,
             gateway_ip, is_current_connected, network_type),
        )
        conn.commit()
        return cursor.lastrowid


def get_all_networks() -> list:
    conn = get_connection()
    rows = conn.execute("""
        SELECT n.*,
            (SELECT COUNT(*) FROM device_network_links WHERE network_id = n.id) as assigned_device_count
        FROM networks n
        ORDER BY n.is_current_connected DESC,
                 CASE WHEN n.network_type = 'in_range' THEN 1 ELSE 2 END,
                 n.signal_pct DESC,
                 n.ssid ASC
    """).fetchall()
    return [dict(r) for r in rows]


def get_network_by_id(network_id: int) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT * FROM networks WHERE id = ?", (network_id,)).fetchone()
    return dict(row) if row else None


def assign_devices_to_network(network_id: int, device_ids: list) -> bool:
    """Overwrites or sets the user-assigned devices connected to a specific router/network."""
    with db_write_lock:
        conn = get_connection()
        conn.execute("DELETE FROM device_network_links WHERE network_id = ?", (network_id,))
        for dev_id in device_ids:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO device_network_links (device_id, network_id, assigned_by) VALUES (?, ?, 'user')",
                    (dev_id, network_id)
                )
            except Exception:
                pass
        conn.commit()
        return True


def get_assigned_device_ids_for_network(network_id: int) -> list:
    conn = get_connection()
    rows = conn.execute(
        "SELECT device_id FROM device_network_links WHERE network_id = ?",
        (network_id,)
    ).fetchall()
    return [r["device_id"] for r in rows]


def get_devices_for_network(network_id: int) -> list:
    conn = get_connection()
    query = """
        SELECT d.*,
            (SELECT latency_ms FROM health_metrics WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1) as last_latency,
            (SELECT packet_loss_pct FROM health_metrics WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1) as last_loss,
            (SELECT jitter_ms FROM health_metrics WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1) as last_jitter
        FROM devices d
        JOIN device_network_links l ON d.id = l.device_id
        WHERE l.network_id = ?
        ORDER BY d.last_seen DESC
    """
    rows = conn.execute(query, (network_id,)).fetchall()
    return [dict(r) for r in rows]


def add_custom_network(ssid: str, vendor: str = "Custom Router", gateway_ip: str = "192.168.1.1") -> int:
    return upsert_network(
        ssid=ssid,
        bssid="",
        vendor=vendor,
        signal_pct=100,
        band="2.4 GHz / 5 GHz",
        channel=1,
        security_type="WPA2/WPA3",
        gateway_ip=gateway_ip,
        is_current_connected=0,
        network_type="custom"
    )

