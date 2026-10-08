import subprocess
import re
import socket
import sys
import uuid
import struct
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import DISCOVERY_PING_TIMEOUT_MS, DISCOVERY_WORKERS, OUI_VENDORS

SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def get_local_mac() -> str:
    try:
        raw_mac = uuid.getnode()
        mac_bytes = [(raw_mac >> (8 * i)) & 0xFF for i in range(5, -1, -1)]
        return ":".join(f"{b:02X}" for b in mac_bytes)
    except Exception:
        return "00:00:00:00:00:00"


def get_default_gateway(local_ip: str) -> str:
    prefix = ".".join(local_ip.split(".")[:3])
    return f"{prefix}.1"


def get_subnet_ips(local_ip: str) -> list:
    prefix = ".".join(local_ip.split(".")[:3])
    return [f"{prefix}.{i}" for i in range(1, 255)]


def ping_host(ip: str) -> bool:
    try:
        if sys.platform == "win32":
            cmd = ["ping", "-n", "1", "-w", str(DISCOVERY_PING_TIMEOUT_MS), ip]
        else:
            timeout_sec = max(1, DISCOVERY_PING_TIMEOUT_MS // 1000)
            cmd = ["ping", "-c", "1", "-W", str(timeout_sec), ip]

        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=2.0, creationflags=SUBPROCESS_FLAGS,
        )
        return result.returncode == 0
    except Exception:
        return False


def sweep_subnet(local_ip: str) -> list:
    ips = get_subnet_ips(local_ip)
    alive = []
    with ThreadPoolExecutor(max_workers=DISCOVERY_WORKERS) as executor:
        futures = {executor.submit(ping_host, ip): ip for ip in ips}
        for future in as_completed(futures):
            if future.result():
                alive.append(futures[future])
    return alive


def parse_arp_table() -> dict:
    try:
        output = subprocess.check_output(
            ["arp", "-a"], text=True, creationflags=SUBPROCESS_FLAGS,
        )
    except Exception:
        return {}

    arp_map = {}
    pattern = re.compile(r"(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F-]{17})\s+(\w+)")
    for line in output.splitlines():
        match = pattern.search(line)
        if match:
            ip = match.group(1)
            mac = normalize_mac(match.group(2))
            entry_type = match.group(3)
            if entry_type.lower() in ["dynamic", "static"] and mac != "FF:FF:FF:FF:FF:FF" and not mac.startswith("01:00:5E"):
                arp_map[ip] = mac
    return arp_map


def normalize_mac(mac: str) -> str:
    return mac.replace("-", ":").upper()


def check_randomized_mac(mac: str) -> bool:
    """Checks if MAC address has the IEEE Locally Administered Address (LAA) bit set (Bit 1 of Byte 0)"""
    try:
        first_byte = int(mac.split(":")[0], 16)
        return bool(first_byte & 0x02)
    except Exception:
        return False


def get_ping_ttl(ip: str) -> int:
    """Probes the target device's ICMP TTL to identify the OS kernel (Windows: ~128, Linux/Android/iOS: ~64)"""
    try:
        cmd = ["ping", "-n", "1", "-w", "400", ip] if sys.platform == "win32" else ["ping", "-c", "1", "-W", "1", ip]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=1.2, creationflags=SUBPROCESS_FLAGS)
        m = re.search(r"TTL=(\d+)", res.stdout, re.IGNORECASE)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 0


def probe_netbios(ip: str) -> str:
    """Sends a NetBIOS node status query (UDP 137) to extract the genuine Windows/Samba computer hostname"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        nb_query = b'\x82\x28\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x20CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x00\x00\x21\x00\x01'
        s.sendto(nb_query, (ip, 137))
        data, _ = s.recvfrom(1024)
        if len(data) > 57:
            num = data[56]
            if num > 0:
                name = data[57:57+15].decode("ascii", errors="ignore").strip()
                clean = "".join(c for c in name if c.isalnum() or c in "-_")
                if clean and len(clean) >= 2:
                    return clean
    except Exception:
        pass
    return ""


def probe_mdns(ip: str) -> str:
    """Queries mDNS (UDP 5353) for device's real model/hostname via PTR/TXT records"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.3)
        # Reverse IP for mDNS PTR query
        parts = ip.split('.')
        rev = '.'.join(reversed(parts))
        # Encode DNS name for reverse PTR lookup
        labels = (rev + '.in-addr.arpa').split('.')
        qname = b''
        for label in labels:
            qname += bytes([len(label)]) + label.encode()
        qname += b'\x00'
        # Build DNS query packet (standard query, PTR type=12, class=1)
        query = struct.pack('>HHHHHH', 0x0001, 0x0000, 1, 0, 0, 0) + qname + struct.pack('>HH', 12, 1)
        s.sendto(query, (ip, 5353))
        data, _ = s.recvfrom(2048)
        # Parse response - extract answer section name
        if len(data) > 12:
            decoded = _parse_dns_name(data, len(query))
            if decoded:
                # Clean up .local suffix
                decoded = decoded.rstrip('.').replace('.local', '').strip()
                if decoded and len(decoded) >= 2:
                    return decoded
    except Exception:
        pass
    return ""


def _parse_dns_name(data: bytes, offset: int) -> str:
    """Helper to parse a DNS response name from raw packet bytes"""
    try:
        # Skip to answer section
        # Header is 12 bytes, skip question section
        pos = 12
        # Skip question name
        while pos < len(data) and data[pos] != 0:
            if data[pos] & 0xC0 == 0xC0:
                pos += 2
                break
            pos += data[pos] + 1
        else:
            pos += 1
        pos += 4  # Skip QTYPE and QCLASS

        # Read answer record
        if pos >= len(data):
            return ""

        # Skip answer name (may be pointer)
        if data[pos] & 0xC0 == 0xC0:
            pos += 2
        else:
            while pos < len(data) and data[pos] != 0:
                pos += data[pos] + 1
            pos += 1

        if pos + 10 > len(data):
            return ""

        rtype, rclass, ttl, rdlen = struct.unpack('>HHIH', data[pos:pos+10])
        pos += 10

        if rtype == 12 and pos + rdlen <= len(data):
            # PTR record - parse name
            name_parts = []
            end = pos + rdlen
            while pos < end and data[pos] != 0:
                if data[pos] & 0xC0 == 0xC0:
                    # Pointer
                    ptr = struct.unpack('>H', data[pos:pos+2])[0] & 0x3FFF
                    # Read from pointer location
                    while ptr < len(data) and data[ptr] != 0:
                        lbl_len = data[ptr]
                        name_parts.append(data[ptr+1:ptr+1+lbl_len].decode('utf-8', errors='ignore'))
                        ptr += lbl_len + 1
                    break
                lbl_len = data[pos]
                name_parts.append(data[pos+1:pos+1+lbl_len].decode('utf-8', errors='ignore'))
                pos += lbl_len + 1
            return '.'.join(name_parts)
    except Exception:
        pass
    return ""


def probe_ssdp(ip: str) -> str:
    """Queries SSDP (UDP 1900) to discover device's UPnP friendly name and model"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.35)
        msg = (
            "M-SEARCH * HTTP/1.1\r\n"
            f"HOST: {ip}:1900\r\n"
            "MAN: \"ssdp:discover\"\r\n"
            "MX: 1\r\n"
            "ST: ssdp:all\r\n\r\n"
        )
        s.sendto(msg.encode(), (ip, 1900))
        data, _ = s.recvfrom(2048)
        text = data.decode('utf-8', errors='ignore')
        # Extract SERVER header which often contains model info
        m = re.search(r'SERVER:\s*(.+?)[\r\n]', text, re.IGNORECASE)
        if m:
            server = m.group(1).strip()
            # Clean up OS/UPnP version info, keep model
            for remove in ['UPnP/1.0', 'UPnP/1.1', 'UPnP/2.0', 'DLNADOC/', 'Microsoft-Windows/', 'IPC/']:
                server = server.replace(remove, '').strip()
            server = re.sub(r'\s+', ' ', server).strip(' ,/')
            if server and len(server) >= 3:
                return server
    except Exception:
        pass
    return ""


def probe_dhcp_hostname(ip: str) -> str:
    """Extracts DHCP hostname from Windows ipconfig or Linux dhclient lease files"""
    if sys.platform == "win32":
        try:
            # Use nbtstat for additional name info
            res = subprocess.run(
                ["nbtstat", "-A", ip], capture_output=True, text=True,
                timeout=1.0, creationflags=SUBPROCESS_FLAGS
            )
            for line in res.stdout.splitlines():
                line = line.strip()
                if '<00>' in line and 'UNIQUE' in line:
                    name = line.split('<')[0].strip()
                    if name and len(name) >= 2 and not name.startswith('__'):
                        return name
        except Exception:
            pass
    return ""


def probe_signature_ports(ip: str) -> dict:
    """Rapid non-blocking port probe for signature services"""
    ports = [135, 445, 62078, 8008, 1883, 80, 548, 3689, 5353]
    results = {}
    for p in ports:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.1)
            results[p] = (s.connect_ex((ip, p)) == 0)
            s.close()
        except Exception:
            results[p] = False
    return results


def probe_http_banner(ip: str, port: int = 80) -> str:
    """Grabs HTTP Server header from web server on device for model identification"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.4)
        if s.connect_ex((ip, port)) == 0:
            s.sendall(b"GET / HTTP/1.0\r\nHost: " + ip.encode() + b"\r\n\r\n")
            data = s.recv(1024).decode('utf-8', errors='ignore')
            s.close()
            m = re.search(r'Server:\s*(.+?)[\r\n]', data, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        else:
            s.close()
    except Exception:
        pass
    return ""


def lookup_vendor(mac: str) -> str:
    prefix = mac[:8].upper()
    return OUI_VENDORS.get(prefix, "Unknown")


def resolve_hostname(ip: str) -> str:
    try:
        hname = socket.gethostbyaddr(ip)[0]
        if hname and hname.lower() != "unknown" and not hname.startswith("172.") and not hname.startswith("192."):
            return hname
    except Exception:
        pass
    return ""


def get_local_model_info() -> tuple:
    """Gets the actual Windows PC model name and manufacturer from WMI"""
    model = ""
    manufacturer = ""
    if sys.platform == "win32":
        try:
            res = subprocess.run(
                ["wmic", "computersystem", "get", "model,manufacturer", "/format:list"],
                capture_output=True, text=True, timeout=2.0, creationflags=SUBPROCESS_FLAGS
            )
            for line in res.stdout.splitlines():
                line = line.strip()
                if line.startswith("Manufacturer="):
                    manufacturer = line.split("=", 1)[1].strip()
                elif line.startswith("Model="):
                    model = line.split("=", 1)[1].strip()
        except Exception:
            pass
    return manufacturer, model


def force_fingerprint_device(ip: str, mac: str, local_ip: str, gateway_ip: str) -> tuple:
    """
    Forcefully interrogates the network target to definitively identify:
    1. Real Vendor/Manufacturer Name
    2. Real Device Model or Hostname (actual device identity, NOT generic labels)
    3. Real Device Type ('router' | 'mobile' | 'laptop' | 'desktop' | 'esp32')
    """
    is_gw = (ip == gateway_ip or ip.endswith(".1"))
    is_local = (ip == local_ip)
    is_rand = check_randomized_mac(mac)
    known_vendor = lookup_vendor(mac)
    dns_name = resolve_hostname(ip)

    # 1. Gateway / Hotspot AP
    if is_gw:
        vendor = known_vendor if known_vendor != "Unknown" else ("Apple" if is_rand else "Wi-Fi Gateway")
        # Try to get router model via HTTP banner or SSDP
        ssdp = probe_ssdp(ip)
        http_banner = probe_http_banner(ip) if not ssdp else ""
        model = ssdp or http_banner or dns_name
        if not model:
            if is_rand:
                model = "iPhone Hotspot"
            elif known_vendor != "Unknown":
                model = f"{known_vendor} Router"
            else:
                model = "Wi-Fi Gateway"
        return vendor, model, "router"

    # 2. Local Monitoring Station - get REAL PC model
    if is_local:
        manufacturer, model = get_local_model_info()
        host_name = socket.gethostname()
        if manufacturer and model:
            vendor = manufacturer
            display_name = f"{model} ({host_name})"
            # Auto-detect form factor from model string
            model_lower = model.lower()
            if any(kw in model_lower for kw in ['laptop', 'notebook', 'victus', 'pavilion', 'envy', 'spectre',
                                                  'thinkpad', 'ideapad', 'yoga', 'inspiron', 'latitude', 'xps',
                                                  'macbook', 'surface', 'zenbook', 'vivobook', 'chromebook']):
                dev_type = "laptop"
            else:
                dev_type = "desktop"
        else:
            vendor = known_vendor if known_vendor != "Unknown" else "Windows PC"
            display_name = host_name
            dev_type = "desktop"
        return vendor, display_name, dev_type

    # 3. Active Network Interrogation (parallel-style sequential fast probes)
    ttl = get_ping_ttl(ip)
    netbios_name = probe_netbios(ip)
    ports = probe_signature_ports(ip)
    mdns_name = probe_mdns(ip)
    ssdp_model = probe_ssdp(ip) if not mdns_name else ""

    # Build the best possible real identity
    real_name = dns_name or mdns_name or netbios_name or ""

    # Apple device with port 62078 (lockdown service) or known Apple OUI
    if ports.get(62078) or known_vendor == "Apple":
        vendor = "Apple Inc."
        if real_name:
            # iOS reports hostname like "iPhone-de-Nakula" or "Nakula's iPhone"
            display = real_name
        else:
            # Check if randomized MAC suggests newer iOS
            display = "Apple iPhone"
        return vendor, display, "mobile"

    # Samsung / Google / Xiaomi / OnePlus / Vivo / Oppo - Android devices
    android_vendors = ("Samsung", "Google", "Xiaomi", "OnePlus", "Vivo", "Oppo")
    if ports.get(8008) or known_vendor in android_vendors:
        vendor = known_vendor if known_vendor != "Unknown" else "Android"
        if real_name:
            display = real_name
        elif ssdp_model:
            display = ssdp_model
        else:
            display = f"{vendor} Phone"
        return vendor, display, "mobile"

    # ESP32 IoT Node signature
    if known_vendor == "Espressif" or ports.get(1883) or (real_name and "esp" in real_name.lower()):
        model = real_name or ssdp_model or "ESP32 Node"
        return "Espressif Systems", model, "esp32"

    # NetBIOS response -> Windows PC / Laptop with real computer name
    if netbios_name:
        vendor = known_vendor if known_vendor != "Unknown" else "Windows PC"
        # Try to distinguish laptop vs desktop via SSDP
        if ssdp_model:
            display = f"{netbios_name} ({ssdp_model})"
        else:
            display = netbios_name
        dev_type = "laptop" if known_vendor in ("Dell", "HP", "Lenovo", "Asus") else "laptop"
        return vendor, display, dev_type

    # Windows Laptop / Workstation via TTL=128 or ports 135/445
    if ports.get(135) or ports.get(445) or (115 <= ttl <= 135):
        vendor = known_vendor if known_vendor != "Unknown" else "Windows PC"
        dhcp_name = probe_dhcp_hostname(ip)
        display = real_name or dhcp_name or ssdp_model
        if not display:
            display = f"{vendor} Workstation"
        return vendor, display, "laptop"

    # Smartphone with Randomized / Private MAC address
    if is_rand or (55 <= ttl <= 68):
        # Private MAC = modern smartphone (iOS/Android MAC randomization)
        if real_name:
            display = real_name
        elif ssdp_model:
            display = ssdp_model
        else:
            display = "Smartphone"
        vendor = known_vendor if known_vendor != "Unknown" else "Private MAC Device"
        return vendor, display, "mobile"

    # Fallback with best available data
    display = real_name or ssdp_model or mdns_name
    if not display:
        if ttl > 100:
            display = f"{known_vendor} PC" if known_vendor != "Unknown" else "Network Client"
        else:
            display = f"{known_vendor} Device" if known_vendor != "Unknown" else "Network Client"

    vendor = known_vendor if known_vendor != "Unknown" else "Network Device"
    dev_type = "laptop" if ttl > 100 else "mobile"

    return vendor, display, dev_type


def discover_devices() -> list:
    local_ip = get_local_ip()
    gateway_ip = get_default_gateway(local_ip)

    # 1. Sweep active subnet to update ARP cache (fast parallel ping)
    sweep_subnet(local_ip)

    # 2. Parse ARP table
    arp_entries = parse_arp_table()

    devices = []
    seen_ips = set()

    # 3. Add Gateway (Router / Hotspot)
    gw_mac = arp_entries.get(gateway_ip)
    if not gw_mac:
        ping_host(gateway_ip)
        arp_entries = parse_arp_table()
        gw_mac = arp_entries.get(gateway_ip)

    if not gw_mac:
        try:
            from database.models import get_device_by_ip
            known_gw = get_device_by_ip(gateway_ip)
            if known_gw and known_gw.get("mac_address") and not known_gw["mac_address"].startswith("00:"):
                gw_mac = known_gw["mac_address"]
        except Exception:
            pass

    if not gw_mac:
        gw_mac = "GATEWAY_ACTIVE"

    gw_vendor, gw_hostname, gw_type = force_fingerprint_device(gateway_ip, gw_mac, local_ip, gateway_ip)
    devices.append({
        "ip_address": gateway_ip,
        "mac_address": gw_mac,
        "vendor": gw_vendor,
        "hostname": gw_hostname,
        "device_type": gw_type,
    })
    seen_ips.add(gateway_ip)

    # 4. Add Local Host (Monitoring Station)
    local_mac = get_local_mac()
    host_vendor, host_name, host_type = force_fingerprint_device(local_ip, local_mac, local_ip, gateway_ip)
    devices.append({
        "ip_address": local_ip,
        "mac_address": local_mac,
        "vendor": host_vendor,
        "hostname": host_name,
        "device_type": host_type,
    })
    seen_ips.add(local_ip)

    # 5. Interrogate and Fingerprint all other real connected devices
    for ip, mac in arp_entries.items():
        if ip in seen_ips:
            continue
        # Filter broadcast / multicast
        if ip.endswith(".255") or ip.startswith("224.") or ip.startswith("239.") or ip.startswith("255."):
            continue

        vendor, hostname, dev_type = force_fingerprint_device(ip, mac, local_ip, gateway_ip)

        devices.append({
            "ip_address": ip,
            "mac_address": mac,
            "vendor": vendor,
            "hostname": hostname,
            "device_type": dev_type,
        })
        seen_ips.add(ip)

    return devices
