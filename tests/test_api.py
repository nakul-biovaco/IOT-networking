import sys
import os
import json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("TESTING", "1")

from config import DATABASE_PATH
from database.db import init_db, get_connection
from app import app


TEST_DB = DATABASE_PATH.replace(".db", "_test.db")


def setup_test():
    import config
    config.DATABASE_PATH = TEST_DB
    import database.db
    database.db.DATABASE_PATH = TEST_DB
    if hasattr(database.db._local, "connection"):
        database.db._local.connection = None
    init_db()


def teardown_test():
    from database.db import close_connection
    close_connection()
    for path in [TEST_DB, TEST_DB + "-wal", TEST_DB + "-shm"]:
        try:
            if os.path.exists(path):
                os.remove(path)
        except PermissionError:
            pass


def test_dashboard_summary():
    client = app.test_client()
    resp = client.get("/api/dashboard/summary")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "total_devices" in data
    assert "online" in data
    assert "active_alerts" in data
    print("[PASS] test_dashboard_summary")


def test_devices_empty():
    client = app.test_client()
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    print("[PASS] test_devices_empty")


def test_esp32_telemetry_valid():
    client = app.test_client()
    payload = {
        "ip": "192.168.1.150",
        "mac": "24:6F:28:AA:BB:CC",
        "rssi": -55,
        "uptime_sec": 120,
        "free_heap": 240000,
    }
    resp = client.post(
        "/api/esp32/telemetry",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    print("[PASS] test_esp32_telemetry_valid")


def test_esp32_telemetry_missing_field():
    client = app.test_client()
    payload = {"mac": "24:6F:28:AA:BB:CC", "rssi": -55}
    resp = client.post(
        "/api/esp32/telemetry",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["success"] is False
    print("[PASS] test_esp32_telemetry_missing_field")


def test_esp32_telemetry_invalid_json():
    client = app.test_client()
    resp = client.post(
        "/api/esp32/telemetry",
        data="not json",
        content_type="application/json",
    )
    assert resp.status_code == 400
    print("[PASS] test_esp32_telemetry_invalid_json")


def test_esp32_latest_no_data():
    client = app.test_client()
    resp = client.get("/api/esp32/telemetry/latest")
    assert resp.status_code in [200, 404]
    print("[PASS] test_esp32_latest_no_data")


def test_whitelist_nonexistent():
    client = app.test_client()
    resp = client.post("/api/devices/9999/whitelist")
    assert resp.status_code == 404
    print("[PASS] test_whitelist_nonexistent")


def test_resolve_nonexistent_alert():
    client = app.test_client()
    resp = client.post("/api/alerts/9999/resolve")
    assert resp.status_code == 404
    print("[PASS] test_resolve_nonexistent_alert")


def test_scan_trigger():
    client = app.test_client()
    resp = client.post("/api/scan/trigger")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    print("[PASS] test_scan_trigger")


def test_alerts_list():
    client = app.test_client()
    resp = client.get("/api/alerts")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    print("[PASS] test_alerts_list")


if __name__ == "__main__":
    setup_test()
    try:
        test_dashboard_summary()
        test_devices_empty()
        test_esp32_telemetry_valid()
        test_esp32_telemetry_missing_field()
        test_esp32_telemetry_invalid_json()
        test_esp32_latest_no_data()
        test_whitelist_nonexistent()
        test_resolve_nonexistent_alert()
        test_scan_trigger()
        test_alerts_list()
        print("\nAll API tests passed.")
    finally:
        teardown_test()
