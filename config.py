import os

# Load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATABASE_PATH = os.path.join(BASE_DIR, "network_monitor.db")

FLASK_HOST = os.environ.get("FLASK_HOST", "0.0.0.0")
FLASK_PORT = int(os.environ.get("FLASK_PORT", 5000))
FLASK_DEBUG = False

# =============================================================================
# AUTHENTICATION & SECURITY
# =============================================================================
# Device API Key — ESP32 devices must send this in the X-Device-Token header
DEVICE_API_KEY = os.environ.get("DEVICE_API_KEY", "iot-prod-device-key-2026")

# Dashboard secret key for session signing
DASHBOARD_SECRET_KEY = os.environ.get("DASHBOARD_SECRET_KEY", "iot-dashboard-secret-change-me")

# Admin credentials for dashboard login
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# =============================================================================
# DATA RETENTION & CLEANUP
# =============================================================================
DATA_RETENTION_HOURS = int(os.environ.get("DATA_RETENTION_HOURS", 72))
ALERT_RETENTION_DAYS = int(os.environ.get("ALERT_RETENTION_DAYS", 30))

# =============================================================================
# MDNS SERVICE DISCOVERY
# =============================================================================
MDNS_SERVICE_NAME = os.environ.get("MDNS_SERVICE_NAME", "iot-monitor")

# =============================================================================
# MONITORING INTERVALS (seconds)
# =============================================================================
DISCOVERY_INTERVAL = 8
HEALTH_CHECK_INTERVAL = 6
SECURITY_SCAN_INTERVAL = 120
DATA_CLEANUP_INTERVAL = 3600  # Run data cleanup every hour

# =============================================================================
# NETWORK SCANNING
# =============================================================================
PING_COUNT = 4
PING_TIMEOUT_MS = 800
DISCOVERY_PING_TIMEOUT_MS = 150
DISCOVERY_WORKERS = 50

PACKET_LOSS_ONLINE_THRESHOLD = 20.0
PACKET_LOSS_OFFLINE_THRESHOLD = 100.0

MONITORED_PORTS = [22, 23, 80, 443, 1883, 8080]
PORT_SCAN_TIMEOUT = 0.5

UNAUTHORIZED_PORTS = [23]

PORT_SERVICE_MAP = {
    22: "SSH",
    23: "Telnet",
    80: "HTTP",
    443: "HTTPS",
    1883: "MQTT",
    8080: "HTTP-Alt",
}

# =============================================================================
# LIMITS & HISTORY
# =============================================================================
HEALTH_HISTORY_LIMIT = 50
ESP32_TELEMETRY_LIMIT = 100

DASHBOARD_POLL_INTERVAL_MS = 1500

# =============================================================================
# OUI VENDOR DATABASE (MAC Address → Manufacturer)
# =============================================================================
OUI_VENDORS = {
    "24:6F:28": "Espressif",
    "30:AE:A4": "Espressif",
    "A4:CF:12": "Espressif",
    "AC:67:B2": "Espressif",
    "B4:E6:2D": "Espressif",
    "CC:50:E3": "Espressif",
    "EC:FA:BC": "Espressif",
    "08:3A:F2": "Espressif",
    "DC:4F:22": "Espressif",
    "80:7D:3A": "Espressif",
    "48:E7:29": "Espressif",
    "7C:DF:A1": "Espressif",
    "3C:71:BF": "Espressif",
    "D8:BF:C0": "Espressif",
    "94:B5:55": "Espressif",
    "F8:1E:DF": "Apple",
    "A8:5C:2C": "Apple",
    "3C:22:FB": "Apple",
    "DC:A6:32": "Raspberry Pi",
    "B8:27:EB": "Raspberry Pi",
    "00:50:56": "VMware",
    "00:0C:29": "VMware",
    "08:00:27": "VirtualBox",
    "00:1E:C9": "Dell",
    "F0:1F:AF": "Dell",
    "D4:5D:64": "Asus",
    "00:25:9C": "Cisco",
    "C8:D7:19": "Cisco",
    "14:CC:20": "TP-Link",
    "50:C7:BF": "TP-Link",
    "60:E3:27": "TP-Link",
    "C0:25:E9": "TP-Link",
    "EC:08:6B": "TP-Link",
    "30:B5:C2": "TP-Link",
    "C8:3A:35": "Tenda",
    "00:1A:79": "Samsung",
    "8C:F5:A3": "Samsung",
    "64:16:66": "Samsung",
    "E8:50:8B": "Samsung",
    "3C:5A:B4": "Google",
    "F4:F5:D8": "Google",
    "18:B4:30": "Nest",
    "74:DA:38": "Edimax",
    "00:1E:58": "D-Link",
    "28:10:7B": "D-Link",
    "FC:75:16": "D-Link",
    "00:18:0A": "Intel",
    "00:1B:21": "Intel",
    "00:1C:BF": "Intel",
    "F4:8E:38": "Intel",
    "3C:A9:F4": "Intel",
    "68:05:CA": "Intel",
    "B0:3C:DC": "Intel",
    "A4:4C:C8": "Intel",
    "5C:87:9C": "Intel",
    "48:51:B7": "Intel",
    "34:13:E8": "Intel",
    "40:22:D8": "Espressif",
    "68:B6:B3": "Espressif",
    "84:F7:03": "Espressif",
    "A0:B7:65": "Espressif",
    "C4:4F:33": "Espressif",
    "E0:E2:E6": "Espressif",
    "F0:08:D1": "Espressif",
    "28:CF:DA": "Apple",
    "40:A6:D9": "Apple",
    "44:D8:84": "Apple",
    "4C:32:75": "Apple",
    "60:03:08": "Apple",
    "64:20:0C": "Apple",
    "70:11:24": "Apple",
    "78:31:C1": "Apple",
    "8C:85:90": "Apple",
    "90:FD:61": "Apple",
    "A4:C3:61": "Apple",
    "AC:87:A3": "Apple",
    "B8:17:C2": "Apple",
    "C4:2C:03": "Apple",
    "D0:03:4B": "Apple",
    "D8:96:95": "Apple",
    "E0:66:78": "Apple",
    "E8:80:2E": "Apple",
    "F4:0F:24": "Apple",
    "18:67:B0": "Samsung",
    "34:23:87": "Samsung",
    "50:B7:C3": "Samsung",
    "70:2C:1F": "Samsung",
    "90:18:7C": "Samsung",
    "B0:C4:E7": "Samsung",
    "D8:57:EF": "Samsung",
    "18:59:36": "Xiaomi",
    "28:6C:07": "Xiaomi",
    "34:CE:00": "Xiaomi",
    "64:09:80": "Xiaomi",
    "74:51:BA": "Xiaomi",
    "88:C3:97": "Xiaomi",
    "AC:F6:F7": "Xiaomi",
    "98:0C:A5": "OnePlus",
    "A0:93:47": "OnePlus",
    "C0:EE:FB": "OnePlus",
    "30:10:E4": "Vivo",
    "50:8F:4C": "Vivo",
    "64:CC:2E": "Vivo",
    "04:79:70": "Oppo",
    "2C:59:8A": "Oppo",
    "48:D7:05": "Oppo",
    "20:76:93": "Lenovo",
    "38:BA:F8": "Lenovo",
    "44:39:C4": "Lenovo",
    "80:2B:F9": "Lenovo",
    "00:14:22": "Dell",
    "74:86:7A": "Dell",
    "C8:1F:66": "Dell",
    "00:11:0A": "HP",
    "38:EA:A7": "HP",
    "70:5A:0F": "HP",
    "B4:99:BA": "HP",
}
