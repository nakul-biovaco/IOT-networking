# IoT Network Health & Security Monitoring System

## Architecture Overview

This system monitors devices on a local IPv4 subnet, tracks their connectivity
health, collects telemetry from an ESP32 IoT node, and detects basic network
security anomalies — all presented through a real-time web dashboard.

## System Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     LOCAL IPv4 SUBNET                       │
 │  [Router/Gateway] [Phones/Laptops] [ESP32 IoT Node]         │
 └────────────┬────────────────┬────────────────┬──────────────┘
              │ ICMP/ARP       │ ICMP/ARP       │ HTTP POST
              ▼                ▼                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    HOST PC / LAPTOP                         │
 │                                                             │
 │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
 │  │ Discovery    │  │ Health       │  │ Security     │       │
 │  │ Worker (60s) │  │ Worker (10s) │  │ Worker (120s)│       │
 │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
 │         │                 │                 │               │
 │         ▼                 ▼                 ▼               │
 │  ┌──────────────────────────────────────────────────┐       │
 │  │              SQLite Database (WAL)               │       │
 │  │  devices | health_metrics | esp32_telemetry      │       │
 │  │  device_ports | security_alerts                  │       │
 │  └──────────────────────┬───────────────────────────┘       │
 │                         │                                   │
 │                         ▼                                   │
 │  ┌──────────────────────────────────────────────────┐       │
 │  │             Flask REST API (Port 5000)           │       │
 │  │  /api/devices  /api/esp32  /api/alerts  /api/scan│       │
 │  └──────────────────────┬───────────────────────────┘       │
 │                         │                                   │
 │                         ▼                                   │
 │  ┌──────────────────────────────────────────────────┐       │
 │  │          Web Dashboard (HTML/CSS/JS)             │       │
 │  │  Device Table | Health Charts | ESP32 Panel      │       │
 │  │  Security Alerts | Network Stats                 │       │
 │  └──────────────────────────────────────────────────┘       │
 └─────────────────────────────────────────────────────────────┘
```

## Core Networking Concepts Used

### ARP (Address Resolution Protocol)
- Maps IPv4 addresses to MAC (hardware) addresses within a broadcast domain
- We parse the Windows ARP cache (`arp -a`) after a ping sweep to discover devices

### ICMP (Internet Control Message Protocol)
- Used for ping (Echo Request / Echo Reply) to test host reachability
- We send 5-packet bursts and measure Round-Trip Time from the responses

### TCP/IP
- TCP SYN/Connect checks on specific ports to detect running services
- ESP32 communicates over HTTP (TCP port 80/5000)

### QoS Metrics
- **Latency (RTT):** Average round-trip time from ping responses
- **Packet Loss:** Percentage of ICMP packets that received no reply
- **Jitter Estimate:** Mean absolute difference between consecutive RTT values

### Device Status (3-State)
- **Online:** Packet loss < 20%
- **Degraded:** Packet loss between 20% and 99%
- **Offline:** Packet loss = 100%

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.10+, Flask |
| Database | SQLite with WAL mode |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Charts | Chart.js 4.x (CDN) |
| Hardware | ESP32 (Arduino framework) |
| Protocols | IPv4, ARP, ICMP, TCP, HTTP |

## Project Structure

```
IOT/
├── app.py                    Flask entry point
├── config.py                 Configuration constants
├── requirements.txt          Python dependencies
├── core/
│   ├── scheduler.py          Background thread workers
│   └── logger.py             Logging utility
├── network/
│   ├── discovery.py          ARP + ping sweep device discovery
│   ├── health.py             ICMP health monitoring + jitter
│   └── port_scanner.py       Targeted 6-port TCP scanner
├── security/
│   ├── anomaly_detector.py   New device / conflict / port alerts
│   └── alert_manager.py      Alert CRUD operations
├── database/
│   ├── db.py                 SQLite connection manager
│   ├── schema.sql            Table definitions
│   └── models.py             Data access queries
├── api/
│   ├── routes_devices.py     Device & dashboard endpoints
│   ├── routes_esp32.py       ESP32 telemetry endpoint
│   └── routes_security.py    Alerts & scan endpoints
├── static/
│   ├── css/style.css         Dashboard styling
│   └── js/
│       ├── dashboard.js      Polling & DOM updates
│       └── charts.js         Chart.js configuration
├── templates/
│   └── index.html            Dashboard page
├── esp32/
│   └── esp32_telemetry.ino   ESP32 Arduino firmware
├── tests/
│   ├── test_network.py       Network module tests
│   ├── test_metrics.py       Jitter calculation tests
│   └── test_api.py           API endpoint tests
└── docs/
    ├── ARCHITECTURE.md       This file
    └── VIVA_QUESTIONS.md     Viva preparation
```

## Database Schema

Five tables with foreign key relationships:

- **devices** — Master inventory (IP, MAC, vendor, status, type)
- **health_metrics** — Time-series QoS data (latency, loss, jitter)
- **esp32_telemetry** — IoT node metrics (RSSI, heap, uptime)
- **device_ports** — Port scan results
- **security_alerts** — Generated anomaly alerts

## Running the Project

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the monitoring system
python app.py

# 3. Open dashboard
# http://localhost:5000

# 4. Flash ESP32
# Open esp32/esp32_telemetry.ino in Arduino IDE
# Update WIFI_SSID, WIFI_PASSWORD, SERVER_URL
# Upload to ESP32

# 5. Run tests
python tests/test_network.py
python tests/test_metrics.py
python tests/test_api.py
```

## Security Considerations

- Port scanning is restricted to 6 specific ports only
- All scanning is limited to the local authorized network
- No aggressive or intrusive scanning techniques are used
- The system is designed for educational/academic use
