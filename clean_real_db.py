import os
import sys

from database.db import get_connection
from database.models import get_all_devices, get_dashboard_summary, upsert_device
from network.discovery import discover_devices, get_local_ip

local_ip = get_local_ip()
prefix = ".".join(local_ip.split(".")[:3]) + ".%"

conn = get_connection()
conn.execute("DELETE FROM health_metrics WHERE device_id IN (SELECT id FROM devices WHERE ip_address NOT LIKE ?)", (prefix,))
conn.execute("DELETE FROM security_alerts WHERE device_id IN (SELECT id FROM devices WHERE ip_address NOT LIKE ?)", (prefix,))
conn.execute("DELETE FROM device_ports WHERE device_id IN (SELECT id FROM devices WHERE ip_address NOT LIKE ?)", (prefix,))
conn.execute("DELETE FROM esp32_telemetry WHERE device_id IN (SELECT id FROM devices WHERE ip_address NOT LIKE ?)", (prefix,))
conn.execute("DELETE FROM devices WHERE ip_address NOT LIKE ?", (prefix,))
conn.execute("UPDATE devices SET hostname = 'Smartphone', vendor = 'Mobile Phone (Hotspot Client)', device_type = 'mobile' WHERE hostname LIKE 'Host-%' OR hostname = 'Unknown'")
conn.commit()

print("Cleaned non-real records from database.")
print("Running forceful device discovery...")
devices = discover_devices()
for dev in devices:
    upsert_device(
        ip=dev["ip_address"],
        mac=dev["mac_address"],
        vendor=dev.get("vendor", "Unknown"),
        hostname=dev.get("hostname", "Unknown"),
        device_type=dev.get("device_type", "generic"),
    )

devs = get_all_devices()
print(f"Total Real Active Devices in DB: {len(devs)}")
for d in devs:
    print(f"  -> {d['ip_address']} | {d['hostname']} | {d['device_type']} | {d['status']} | Vendor: {d['vendor']} | MAC: {d['mac_address']}")
print("Summary:", get_dashboard_summary())
