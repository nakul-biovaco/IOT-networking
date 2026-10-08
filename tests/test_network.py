import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from network.discovery import normalize_mac, lookup_vendor, get_subnet_ips, parse_arp_table
from network.health import parse_ping_output, determine_status


def test_normalize_mac():
    assert normalize_mac("aa-bb-cc-dd-ee-ff") == "AA:BB:CC:DD:EE:FF"
    assert normalize_mac("AA:BB:CC:DD:EE:FF") == "AA:BB:CC:DD:EE:FF"
    assert normalize_mac("24-6f-28-aa-bb-cc") == "24:6F:28:AA:BB:CC"
    print("[PASS] test_normalize_mac")


def test_lookup_vendor():
    assert lookup_vendor("24:6F:28:AA:BB:CC") == "Espressif"
    assert lookup_vendor("14:CC:20:11:22:33") == "TP-Link"
    assert lookup_vendor("FF:FF:FF:FF:FF:FF") == "Unknown"
    print("[PASS] test_lookup_vendor")


def test_get_subnet_ips():
    ips = get_subnet_ips("192.168.1.100")
    assert len(ips) == 254
    assert "192.168.1.1" in ips
    assert "192.168.1.254" in ips
    assert "192.168.1.0" not in ips
    assert "192.168.1.255" not in ips
    print("[PASS] test_get_subnet_ips")


def test_parse_ping_windows_success():
    output = """
Pinging 192.168.1.1 with 32 bytes of data:
Reply from 192.168.1.1: bytes=32 time=2ms TTL=64
Reply from 192.168.1.1: bytes=32 time=3ms TTL=64
Reply from 192.168.1.1: bytes=32 time<1ms TTL=64
Reply from 192.168.1.1: bytes=32 time=5ms TTL=64
Reply from 192.168.1.1: bytes=32 time=2ms TTL=64

Ping statistics for 192.168.1.1:
    Packets: Sent = 5, Received = 5, Lost = 0 (0% loss),
    """
    result = parse_ping_output(output, 5)
    assert result["packet_loss_pct"] == 0.0
    assert result["status"] == "online"
    assert result["latency_ms"] > 0
    assert result["jitter_ms"] >= 0
    print("[PASS] test_parse_ping_windows_success")


def test_parse_ping_all_timeout():
    output = """
Pinging 192.168.1.200 with 32 bytes of data:
Request timed out.
Request timed out.
Request timed out.
Request timed out.
Request timed out.

Ping statistics for 192.168.1.200:
    Packets: Sent = 5, Received = 0, Lost = 5 (100% loss),
    """
    result = parse_ping_output(output, 5)
    assert result["packet_loss_pct"] == 100.0
    assert result["status"] == "offline"
    assert result["latency_ms"] == 0.0
    assert result["jitter_ms"] == 0.0
    print("[PASS] test_parse_ping_all_timeout")


def test_parse_ping_partial_loss():
    output = """
Reply from 192.168.1.5: bytes=32 time=10ms TTL=64
Request timed out.
Reply from 192.168.1.5: bytes=32 time=15ms TTL=64
Request timed out.
Request timed out.
    """
    result = parse_ping_output(output, 5)
    assert result["packet_loss_pct"] == 60.0
    assert result["status"] == "degraded"
    print("[PASS] test_parse_ping_partial_loss")


def test_determine_status():
    assert determine_status(0.0) == "online"
    assert determine_status(10.0) == "online"
    assert determine_status(19.9) == "online"
    assert determine_status(20.0) == "degraded"
    assert determine_status(50.0) == "degraded"
    assert determine_status(99.9) == "degraded"
    assert determine_status(100.0) == "offline"
    print("[PASS] test_determine_status")


if __name__ == "__main__":
    test_normalize_mac()
    test_lookup_vendor()
    test_get_subnet_ips()
    test_parse_ping_windows_success()
    test_parse_ping_all_timeout()
    test_parse_ping_partial_loss()
    test_determine_status()
    print("\nAll network tests passed.")
