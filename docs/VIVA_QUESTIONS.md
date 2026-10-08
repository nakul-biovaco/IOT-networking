# Viva Questions & Answers

## Q1. What is the purpose of this project?
To build a practical local-network monitoring system that discovers devices on
an IPv4 subnet, monitors their connectivity health using ICMP, collects IoT
telemetry from an ESP32 node, and detects basic security anomalies — all
displayed through a real-time web dashboard.

## Q2. How does device discovery work?
We perform a concurrent ICMP ping sweep across the /24 subnet using 25 threads
to populate the OS ARP cache. Then we parse the Windows `arp -a` command output
to extract IP-to-MAC address mappings. Only dynamic entries are considered.

## Q3. What is ARP and why do you use it?
ARP (Address Resolution Protocol) maps Layer 3 IP addresses to Layer 2 MAC
addresses within a broadcast domain. We read the ARP table to identify the
physical hardware address of each discovered device, which is essential for
vendor identification and detecting MAC spoofing.

## Q4. How do you calculate packet loss?
We send a 5-packet ICMP echo request burst to each device. Packet loss is
calculated as: ((Packets Sent - Packets Received) / Packets Sent) * 100.

## Q5. How do you determine device status?
Three-state classification based on packet loss percentage:
- Online: loss < 20% (device is healthy)
- Degraded: loss between 20% and 99% (connectivity issues)
- Offline: loss = 100% (device is unreachable)

## Q6. How is jitter calculated?
Jitter is estimated as the mean absolute difference between consecutive RTT
values. For RTTs [r1, r2, ..., rk], jitter = (1/(k-1)) * sum(|r(i+1) - r(i)|).
This measures the variation/instability in network delay.

## Q7. What does the ESP32 send to the server?
The ESP32 sends a JSON payload via HTTP POST containing: its IP address,
MAC address, Wi-Fi RSSI (signal strength in dBm), uptime in seconds, and
free heap memory in bytes. No sensor data — purely network telemetry.

## Q8. How does the ESP32 communicate with the backend?
Over HTTP REST API. The ESP32 makes a POST request to
/api/esp32/telemetry every 5 seconds with a JSON body. The Flask server
validates the payload and stores it in the SQLite database.

## Q9. What is RSSI and why is it important?
RSSI (Received Signal Strength Indicator) measures Wi-Fi signal strength in
dBm. Typical values: -30 (excellent), -50 (good), -70 (fair), -90 (poor).
Monitoring RSSI helps assess the IoT node's wireless link quality.

## Q10. How does security monitoring work?
Three mechanisms:
1. New Device Detection: flags devices whose MAC is not in the authorized whitelist
2. Port Scanning: checks 6 specific ports (22, 23, 80, 443, 1883, 8080) for unauthorized services
3. IP-MAC Conflict: detects when an IP address changes its associated MAC address

## Q11. Why only 6 ports? Why not scan all ports?
Scanning all 65535 ports is time-consuming and can trigger firewall alerts.
We focus on 6 security-relevant ports: SSH(22), Telnet(23), HTTP(80),
HTTPS(443), MQTT(1883), HTTP-Alt(8080). This targets common IoT attack
vectors without being invasive.

## Q12. Why SQLite and not MySQL/PostgreSQL?
SQLite is serverless, zero-configuration, file-based, and perfect for a
single-machine monitoring system. It requires no separate database service
installation. WAL mode enables concurrent reads and writes from multiple
threads.

## Q13. What is WAL mode in SQLite?
Write-Ahead Logging allows readers and writers to operate concurrently.
Without WAL, SQLite locks the entire database during writes. WAL writes
changes to a separate log file first, so read operations are not blocked.

## Q14. How do background workers run without blocking Flask?
We use Python daemon threads. Three threads (discovery, health, security)
run continuously with configurable intervals, using threading.Event.wait()
for sleep. They share the database via thread-local SQLite connections.

## Q15. What networking protocols does this project demonstrate?
- IPv4: Network layer addressing
- ARP: IP-to-MAC resolution
- ICMP: Ping for connectivity testing
- TCP/IP: Port scanning and HTTP communication
- HTTP: REST API between ESP32 and Flask server
- DNS: Reverse hostname lookup (optional)
