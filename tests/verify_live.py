import requests
import json

BASE = "http://127.0.0.1:5000"

print("=== Dashboard Summary ===")
r = requests.get(f"{BASE}/api/dashboard/summary")
print(json.dumps(r.json(), indent=2))

print("\n=== Discovered Devices ===")
r = requests.get(f"{BASE}/api/devices")
devices = r.json()
print(f"Total: {len(devices)}")
for d in devices:
    print(f"  {d['ip_address']} | {d['mac_address']} | {d['vendor']} | {d['status']} | known={d['is_known']}")

print("\n=== Security Alerts ===")
r = requests.get(f"{BASE}/api/alerts")
alerts = r.json()
print(f"Total: {len(alerts)}")
for a in alerts:
    print(f"  [{a['severity']}] {a['alert_type']}: {a['message']}")

if devices:
    dev_id = devices[0]["id"]
    print(f"\n=== Health History (Device {dev_id}) ===")
    r = requests.get(f"{BASE}/api/devices/{dev_id}/history")
    history = r.json()
    print(f"Records: {len(history)}")
    for h in history[-3:]:
        print(f"  Latency={h['latency_ms']}ms | Loss={h['packet_loss_pct']}% | Jitter={h['jitter_ms']}ms | {h['recorded_at']}")

print("\n=== ESP32 Telemetry Test ===")
payload = {
    "ip": "192.168.1.200",
    "mac": "24:6F:28:AA:BB:CC",
    "rssi": -58,
    "uptime_sec": 300,
    "free_heap": 245000
}
r = requests.post(f"{BASE}/api/esp32/telemetry", json=payload)
print(f"POST Response: {r.json()}")

r = requests.get(f"{BASE}/api/esp32/telemetry/latest")
print(f"Latest ESP32: {json.dumps(r.json(), indent=2)}")
