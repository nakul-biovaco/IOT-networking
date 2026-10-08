import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from network.health import parse_ping_output


def test_jitter_known_values():
    output = """
Reply from 192.168.1.1: bytes=32 time=10ms TTL=64
Reply from 192.168.1.1: bytes=32 time=15ms TTL=64
Reply from 192.168.1.1: bytes=32 time=12ms TTL=64
Reply from 192.168.1.1: bytes=32 time=18ms TTL=64
Reply from 192.168.1.1: bytes=32 time=14ms TTL=64
    """
    result = parse_ping_output(output, 5)

    assert result["latency_ms"] == round((10 + 15 + 12 + 18 + 14) / 5, 2)

    expected_jitter = round((abs(15 - 10) + abs(12 - 15) + abs(18 - 12) + abs(14 - 18)) / 4, 2)
    assert result["jitter_ms"] == expected_jitter
    assert result["packet_loss_pct"] == 0.0
    assert result["status"] == "online"
    print("[PASS] test_jitter_known_values")
    print(f"  RTTs: [10, 15, 12, 18, 14]")
    print(f"  Consecutive diffs: |15-10|=5, |12-15|=3, |18-12|=6, |14-18|=4")
    print(f"  Expected jitter: (5+3+6+4)/4 = {expected_jitter} ms")
    print(f"  Computed jitter: {result['jitter_ms']} ms")


def test_jitter_single_packet():
    output = "Reply from 192.168.1.1: bytes=32 time=5ms TTL=64\n"
    result = parse_ping_output(output, 1)
    assert result["jitter_ms"] == 0.0
    assert result["latency_ms"] == 5.0
    print("[PASS] test_jitter_single_packet (jitter = 0 when < 2 RTTs)")


def test_jitter_two_packets():
    output = """
Reply from 192.168.1.1: bytes=32 time=10ms TTL=64
Reply from 192.168.1.1: bytes=32 time=20ms TTL=64
    """
    result = parse_ping_output(output, 2)
    assert result["jitter_ms"] == 10.0
    assert result["latency_ms"] == 15.0
    print("[PASS] test_jitter_two_packets")


def test_zero_latency():
    output = """
Reply from 192.168.1.1: bytes=32 time<1ms TTL=128
Reply from 192.168.1.1: bytes=32 time<1ms TTL=128
Reply from 192.168.1.1: bytes=32 time<1ms TTL=128
    """
    result = parse_ping_output(output, 3)
    assert result["latency_ms"] == 1.0
    assert result["jitter_ms"] == 0.0
    assert result["packet_loss_pct"] == 0.0
    print("[PASS] test_zero_latency (time<1ms parsed as 1ms)")


def test_full_loss_metrics():
    output = """
Request timed out.
Request timed out.
Request timed out.
    """
    result = parse_ping_output(output, 3)
    assert result["latency_ms"] == 0.0
    assert result["jitter_ms"] == 0.0
    assert result["packet_loss_pct"] == 100.0
    print("[PASS] test_full_loss_metrics")


if __name__ == "__main__":
    test_jitter_known_values()
    test_jitter_single_packet()
    test_jitter_two_packets()
    test_zero_latency()
    test_full_loss_metrics()
    print("\nAll metric calculation tests passed.")
