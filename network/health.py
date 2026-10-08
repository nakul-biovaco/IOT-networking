import subprocess
import re
import sys

from config import (
    PING_COUNT, PING_TIMEOUT_MS,
    PACKET_LOSS_ONLINE_THRESHOLD, PACKET_LOSS_OFFLINE_THRESHOLD,
)

SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def ping_burst(ip: str) -> dict:
    try:
        if sys.platform == "win32":
            cmd = ["ping", "-n", str(PING_COUNT), "-w", str(PING_TIMEOUT_MS), ip]
        else:
            timeout_sec = max(1, PING_TIMEOUT_MS // 1000)
            cmd = ["ping", "-c", str(PING_COUNT), "-W", str(timeout_sec), ip]

        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=PING_COUNT * (PING_TIMEOUT_MS / 1000) + 5,
            creationflags=SUBPROCESS_FLAGS,
        )
        return parse_ping_output(result.stdout, PING_COUNT)
    except Exception:
        return {
            "latency_ms": 0.0,
            "packet_loss_pct": 100.0,
            "jitter_ms": 0.0,
            "status": "offline",
        }


def parse_ping_output(output: str, transmitted: int) -> dict:
    rtt_pattern = re.compile(r"time[=<]\s*(\d+\.?\d*)\s*ms", re.IGNORECASE)
    rtts = [float(m.group(1)) for m in rtt_pattern.finditer(output)]

    received = len(rtts)
    if transmitted > 0:
        packet_loss = ((transmitted - received) / transmitted) * 100
    else:
        packet_loss = 100.0

    latency = sum(rtts) / received if received > 0 else 0.0

    jitter = 0.0
    if len(rtts) >= 2:
        diffs = [abs(rtts[i + 1] - rtts[i]) for i in range(len(rtts) - 1)]
        jitter = sum(diffs) / len(diffs)

    status = determine_status(packet_loss)

    return {
        "latency_ms": round(latency, 2),
        "packet_loss_pct": round(packet_loss, 2),
        "jitter_ms": round(jitter, 2),
        "status": status,
    }


def determine_status(packet_loss: float) -> str:
    if packet_loss >= PACKET_LOSS_OFFLINE_THRESHOLD:
        return "offline"
    elif packet_loss >= PACKET_LOSS_ONLINE_THRESHOLD:
        return "degraded"
    return "online"
