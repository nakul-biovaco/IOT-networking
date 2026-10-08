import subprocess
import re
import sys
from config import OUI_VENDORS

SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def get_current_wifi_connection() -> dict:
    """Returns the currently connected Wi-Fi SSID, BSSID, and signal if connected."""
    if sys.platform != "win32":
        return {}
    try:
        output = subprocess.check_output(
            ["netsh", "wlan", "show", "interfaces"],
            text=True, creationflags=SUBPROCESS_FLAGS, stderr=subprocess.DEVNULL
        )
        current = {}
        for line in output.splitlines():
            line = line.strip()
            if line.startswith("SSID") and not line.startswith("BSSID"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    current["ssid"] = parts[1].strip()
            elif line.startswith("BSSID"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    current["bssid"] = parts[1].strip().upper()
            elif line.startswith("State"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    current["state"] = parts[1].strip()
            elif line.startswith("Signal"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    val = re.search(r"(\d+)", parts[1])
                    if val:
                        current["signal_pct"] = int(val.group(1))
        return current
    except Exception:
        return {}


def get_saved_wifi_profiles() -> list:
    """Returns list of saved Wi-Fi network profile names."""
    if sys.platform != "win32":
        return []
    try:
        output = subprocess.check_output(
            ["netsh", "wlan", "show", "profiles"],
            text=True, creationflags=SUBPROCESS_FLAGS, stderr=subprocess.DEVNULL
        )
        profiles = []
        for line in output.splitlines():
            line = line.strip()
            if "All User Profile" in line or "User Profile" in line:
                parts = line.split(":", 1)
                if len(parts) == 2:
                    pname = parts[1].strip()
                    if pname and pname not in profiles:
                        profiles.append(pname)
        return profiles
    except Exception:
        return []


def resolve_router_vendor(bssid: str, ssid: str = "") -> str:
    """Resolves vendor name from BSSID MAC OUI and SSID hints."""
    if not bssid:
        bssid = ""
    norm_mac = bssid.replace("-", ":").upper()
    prefix = ":".join(norm_mac.split(":")[:3])
    vendor = OUI_VENDORS.get(prefix)
    if vendor:
        return vendor

    # Fallback to SSID hints
    lower_ssid = ssid.lower()
    if "iphone" in lower_ssid or "apple" in lower_ssid:
        return "Apple"
    if "d-link" in lower_ssid or "dir-" in lower_ssid:
        return "D-Link"
    if "tp-link" in lower_ssid or "archer" in lower_ssid:
        return "TP-Link"
    if "airtel" in lower_ssid:
        return "Airtel Broadband"
    if "jio" in lower_ssid:
        return "Jio Fiber"
    if "redmi" in lower_ssid or "xiaomi" in lower_ssid or "mi " in lower_ssid:
        return "Xiaomi"
    if "vivo" in lower_ssid:
        return "Vivo"
    if "samsung" in lower_ssid or "galaxy" in lower_ssid:
        return "Samsung"
    if "asus" in lower_ssid:
        return "ASUS"
    if "netgear" in lower_ssid:
        return "Netgear"
    if "tenda" in lower_ssid:
        return "Tenda"
    if "oppo" in lower_ssid or "oneplus" in lower_ssid:
        return "BBK Electronics"
    if "cisco" in lower_ssid or "rcoem" in lower_ssid or "center" in lower_ssid:
        return "Enterprise Cisco/Campus AP"

    return "Wireless Router"


def scan_all_available_networks() -> list:
    """Scans visible Wi-Fi access points and merges with saved router profiles."""
    if sys.platform != "win32":
        return []

    curr_conn = get_current_wifi_connection()
    curr_ssid = curr_conn.get("ssid", "")
    curr_bssid = curr_conn.get("bssid", "")

    networks_by_ssid = {}

    # 1. Parse real-time visible BSSIDs
    try:
        output = subprocess.check_output(
            ["netsh", "wlan", "show", "networks", "mode=bssid"],
            text=True, creationflags=SUBPROCESS_FLAGS, stderr=subprocess.DEVNULL
        )
        current_net = None
        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue

            ssid_match = re.match(r"^SSID\s+\d+\s*:\s*(.*)$", line)
            if ssid_match:
                if current_net and current_net.get("ssid"):
                    networks_by_ssid[current_net["ssid"]] = current_net
                ssid_name = ssid_match.group(1).strip()
                if not ssid_name:
                    ssid_name = "Hidden Network"
                current_net = {
                    "ssid": ssid_name,
                    "bssid": "",
                    "vendor": resolve_router_vendor("", ssid_name),
                    "signal_pct": 50,
                    "band": "2.4 GHz",
                    "channel": 1,
                    "security_type": "WPA2-Personal",
                    "is_current_connected": 1 if ssid_name == curr_ssid else 0,
                    "network_type": "connected" if ssid_name == curr_ssid else "in_range",
                }
                continue

            if not current_net:
                continue

            if line.startswith("Authentication"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    current_net["security_type"] = parts[1].strip()

            bssid_match = re.match(r"^BSSID\s+\d+\s*:\s*([0-9a-fA-F:-]+)", line)
            if bssid_match:
                bssid_val = bssid_match.group(1).replace("-", ":").upper()
                if not current_net["bssid"]:
                    current_net["bssid"] = bssid_val
                    current_net["vendor"] = resolve_router_vendor(bssid_val, current_net["ssid"])
                    if curr_bssid and bssid_val == curr_bssid:
                        current_net["is_current_connected"] = 1
                        current_net["network_type"] = "connected"

            if line.startswith("Signal"):
                sig_match = re.search(r"(\d+)%", line)
                if sig_match:
                    current_net["signal_pct"] = int(sig_match.group(1))

            if line.startswith("Band"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    current_net["band"] = parts[1].strip()

            if line.startswith("Channel"):
                chan_match = re.search(r"(\d+)", line)
                if chan_match:
                    current_net["channel"] = int(chan_match.group(1))

        if current_net and current_net.get("ssid"):
            networks_by_ssid[current_net["ssid"]] = current_net
    except Exception as e:
        print(f"[WIFI_SCAN] Error running netsh show networks: {e}")

    # 2. Merge current connected network if not already present
    if curr_ssid and curr_ssid not in networks_by_ssid:
        networks_by_ssid[curr_ssid] = {
            "ssid": curr_ssid,
            "bssid": curr_bssid,
            "vendor": resolve_router_vendor(curr_bssid, curr_ssid),
            "signal_pct": curr_conn.get("signal_pct", 95),
            "band": "5 GHz",
            "channel": 149,
            "security_type": "WPA2/WPA3",
            "is_current_connected": 1,
            "network_type": "connected",
        }

    # 3. Add known saved profiles so user can select/manage other routers anytime!
    saved_profiles = get_saved_wifi_profiles()
    for prof in saved_profiles:
        if prof not in networks_by_ssid:
            networks_by_ssid[prof] = {
                "ssid": prof,
                "bssid": "",
                "vendor": resolve_router_vendor("", prof),
                "signal_pct": 0,
                "band": "2.4 GHz / 5 GHz",
                "channel": 0,
                "security_type": "WPA2-Personal",
                "is_current_connected": 0,
                "network_type": "saved",
            }

    # Convert to list and sort:
    # 1st: Currently connected
    # 2nd: In-range networks by signal
    # 3rd: Saved known routers
    result = list(networks_by_ssid.values())
    result.sort(
        key=lambda n: (
            1 if n.get("is_current_connected") else 0,
            1 if n.get("network_type") == "in_range" else 0,
            n.get("signal_pct", 0)
        ),
        reverse=True
    )
    return result
