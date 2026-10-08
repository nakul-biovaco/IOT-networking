import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import get_connection, init_db

from database.models import (
    upsert_device, insert_health_metric, insert_esp32_telemetry,
    upsert_device_port, insert_alert,
)


def seed_demo_data():
    init_db()
    conn = get_connection()


    # 1. Gateway Router
    r_id = upsert_device(
        ip="192.168.1.1",
        mac="T4:3D:7E:12:9A:01",
        vendor="TP-Link",
        hostname="Wi-Fi Router",
        device_type="router",
    )
    conn.execute("UPDATE devices SET is_known = 1, status = 'online' WHERE id = ?", (r_id,))
    insert_health_metric(r_id, latency=2.1, loss=0.0, jitter=0.4)
    upsert_device_port(r_id, 80, "HTTP", authorized=1)
    upsert_device_port(r_id, 443, "HTTPS", authorized=1)

    # 2. Laptop-1 (Dell)
    l1_id = upsert_device(
        ip="192.168.1.10",
        mac="3C:52:82:1A:4F:9D",
        vendor="Dell Inc.",
        hostname="Laptop-1",
        device_type="laptop",
    )
    conn.execute("UPDATE devices SET is_known = 1, status = 'online' WHERE id = ?", (l1_id,))
    insert_health_metric(l1_id, latency=12.4, loss=0.0, jitter=1.1)

    # 3. Laptop-2 (HP)
    l2_id = upsert_device(
        ip="192.168.1.11",
        mac="8C:16:45:6D:3B:1A",
        vendor="HP",
        hostname="Laptop-2",
        device_type="laptop",
    )
    conn.execute("UPDATE devices SET is_known = 1, status = 'online' WHERE id = ?", (l2_id,))
    insert_health_metric(l2_id, latency=14.1, loss=0.0, jitter=1.5)

    # 4. Phone-1 (Samsung)
    p1_id = upsert_device(
        ip="192.168.1.12",
        mac="A0:B4:5C:9D:2E:8F",
        vendor="Samsung",
        hostname="Phone-1",
        device_type="mobile",
    )
    conn.execute("UPDATE devices SET is_known = 1, status = 'online' WHERE id = ?", (p1_id,))
    insert_health_metric(p1_id, latency=18.3, loss=0.0, jitter=2.2)

    # 5. ESP32 Node
    esp_id = upsert_device(
        ip="192.168.1.50",
        mac="24:6F:28:3A:7C:91",
        vendor="Espressif",
        hostname="ESP32 Node",
        device_type="esp32",
    )
    conn.execute("UPDATE devices SET is_known = 1, status = 'online' WHERE id = ?", (esp_id,))
    # Add multiple health metric samples for health chart
    for lat in [12.0, 11.5, 10.8, 10.2, 10.6, 11.1, 10.9, 10.6]:
        insert_health_metric(esp_id, latency=lat, loss=0.0, jitter=0.8)
    insert_esp32_telemetry(esp_id, rssi=-52, free_heap=178392, uptime_sec=15432)
    upsert_device_port(esp_id, 23, "Telnet", authorized=0)
    upsert_device_port(esp_id, 80, "HTTP", authorized=1)
    upsert_device_port(esp_id, 8080, "HTTP-Alt", authorized=1)

    # 6. PC-1 (Intel Desktop)
    pc_id = upsert_device(
        ip="192.168.1.13",
        mac="5C:96:9D:4E:2B:77",
        vendor="Intel",
        hostname="PC-1",
        device_type="desktop",
    )
    conn.execute("UPDATE devices SET is_known = 1, status = 'online' WHERE id = ?", (pc_id,))
    insert_health_metric(pc_id, latency=11.9, loss=0.0, jitter=0.9)

    # 7. Unknown / Rogue Device
    unk_id = upsert_device(
        ip="192.168.1.15",
        mac="D4:AB:CD:91:6E:3F",
        vendor="Unknown",
        hostname="Unknown-1",
        device_type="generic",
    )
    conn.execute("UPDATE devices SET is_known = 0, status = 'degraded' WHERE id = ?", (unk_id,))
    insert_health_metric(unk_id, latency=45.2, loss=20.0, jitter=8.4)

    # Security Alerts
    insert_alert(unk_id, "NEW_DEVICE", "High", "Device 192.168.1.15 (D4:AB:CD:91:6E:3F) not in whitelist")
    insert_alert(esp_id, "UNAUTHORIZED_PORT", "Medium", "Port 23 (Telnet) open on 192.168.1.50 (ESP32)")
    insert_alert(p1_id, "IP_MAC_CONFLICT", "Low", "MAC address changed for 192.168.1.12")

    conn.commit()


if __name__ == "__main__":
    seed_demo_data()
    print("Demo seed data created successfully.")
