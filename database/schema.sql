CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT UNIQUE NOT NULL,
    mac_address TEXT NOT NULL,
    vendor TEXT DEFAULT 'Unknown',
    hostname TEXT DEFAULT 'Unknown',
    device_type TEXT DEFAULT 'generic',
    is_known INTEGER DEFAULT 0,
    status TEXT DEFAULT 'offline',
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    latency_ms REAL NOT NULL,
    packet_loss_pct REAL NOT NULL,
    jitter_ms REAL NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS esp32_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    rssi INTEGER NOT NULL,
    free_heap INTEGER NOT NULL,
    uptime_sec INTEGER NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    service_name TEXT,
    is_authorized INTEGER DEFAULT 1,
    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
    UNIQUE(device_id, port_number)
);

CREATE TABLE IF NOT EXISTS security_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    is_resolved INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_device_time ON health_metrics(device_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON esp32_telemetry(device_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON security_alerts(is_resolved, created_at);

CREATE TABLE IF NOT EXISTS networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ssid TEXT NOT NULL,
    bssid TEXT,
    vendor TEXT DEFAULT 'Unknown',
    signal_pct INTEGER DEFAULT 0,
    band TEXT DEFAULT '2.4 GHz',
    channel INTEGER DEFAULT 0,
    security_type TEXT DEFAULT 'WPA2-Personal',
    gateway_ip TEXT DEFAULT NULL,
    is_current_connected INTEGER DEFAULT 0,
    network_type TEXT DEFAULT 'in_range',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ssid, bssid)
);

CREATE TABLE IF NOT EXISTS device_network_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    network_id INTEGER NOT NULL,
    assigned_by TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY(network_id) REFERENCES networks(id) ON DELETE CASCADE,
    UNIQUE(device_id, network_id)
);

CREATE INDEX IF NOT EXISTS idx_device_network_links ON device_network_links(network_id, device_id);

