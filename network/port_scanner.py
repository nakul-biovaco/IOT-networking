import socket
from concurrent.futures import ThreadPoolExecutor

from config import MONITORED_PORTS, PORT_SCAN_TIMEOUT, PORT_SERVICE_MAP


def scan_port(ip: str, port: int) -> dict | None:
    try:
        sock = socket.create_connection((ip, port), timeout=PORT_SCAN_TIMEOUT)
        sock.close()
        return {
            "port_number": port,
            "service_name": PORT_SERVICE_MAP.get(port, "Unknown"),
            "is_open": True,
        }
    except (socket.timeout, ConnectionRefusedError, OSError):
        return None


def scan_device_ports(ip: str) -> list:
    open_ports = []
    with ThreadPoolExecutor(max_workers=len(MONITORED_PORTS)) as executor:
        futures = {
            executor.submit(scan_port, ip, port): port
            for port in MONITORED_PORTS
        }
        for future in futures:
            result = future.result()
            if result:
                open_ports.append(result)
    return open_ports
