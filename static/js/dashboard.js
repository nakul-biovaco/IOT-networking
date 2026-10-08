/**
 * Windows 11 Fluent Real-Time Dashboard Controller (Production Grade)
 * 
 * Synchronizes:
 * - Network Topology Canvas (60FPS in-place SVG DOM engine)
 * - Discovered Devices DataGrid (in-place row updating, search filtering, quick actions)
 * - Hierarchical Network Tree View (state-preserving category folders)
 * - Device Details Pane (General, Network, Telemetry with live ticking clock, History)
 * - Live Streaming Metrics Chart (Latency, Packet Loss, Jitter)
 * - Active Security Alerts & 1-Click Port Vulnerability Scanner
 * - Real-time Status Bar with Live Local Clock & Subnet Telemetry
 */

var POLL_INTERVAL = 1500;
var selectedDeviceId = null;
var selectedDeviceIp = '';
var selectedDeviceObj = null;
var latestDevicesCache = [];
var isMonitoringRunning = true;
var isScanningInProgress = false;

// Local high-resolution timer for smooth ESP32 uptime ticking between polls
var esp32LocalUptimeSec = null;
var esp32UptimeTimer = null;

function fetchJSON(url) {
    return fetch(url).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    });
}

function postJSON(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : null,
    }).then(function(res) {
        return res.json();
    });
}

// -----------------------------------------------------------------------------
// 1. DATA POLLING & SYNCHRONIZATION
// -----------------------------------------------------------------------------

function updateSummary() {
    fetchJSON('/api/dashboard/summary').then(function(data) {
        setElementText('sb-online', data.online);
        setElementText('sb-degraded', data.degraded);
        setElementText('sb-offline', data.offline);
        setElementText('sb-total', data.total_devices);
        setElementText('sb-avg-lat', data.avg_latency_ms + ' ms');

        setElementText('rep-total', data.total_devices);
        setElementText('rep-online', data.online);
        setElementText('rep-latency', data.avg_latency_ms + ' ms');
        setElementText('rep-alerts', data.active_alerts);

        if (data.subnet) {
            setElementText('toolbar-subnet-val', data.subnet);
            setElementText('sb-subnet-val', data.subnet);
            setElementText('rep-subnet-val', data.subnet);
            setElementText('tree-root-subnet-label', 'Local Network (' + data.subnet + ')');
            var cfgSubnet = document.getElementById('cfg-subnet');
            if (cfgSubnet && !cfgSubnet.dataset.userEdited) {
                cfgSubnet.value = data.subnet;
            }
        }
        if (data.gateway_ip) {
            setElementText('toolbar-gateway-val', data.gateway_ip);
        }

        var badgeDot = document.getElementById('status-badge-dot');
        var badgeText = document.getElementById('status-badge-text');
        if (badgeDot && badgeText) {
            if (isMonitoringRunning) {
                badgeDot.className = 'status-dot dot-online';
                badgeText.textContent = 'Monitoring Active (Real-Time)';
            } else {
                badgeDot.className = 'status-dot dot-offline';
                badgeText.textContent = 'Monitoring Paused';
            }
        }
    }).catch(function() {});
}

function updateDevices() {
    if (typeof currentActiveNetworkId !== 'undefined' && currentActiveNetworkId !== 'all') {
        fetchJSON('/api/networks/' + currentActiveNetworkId + '/devices').then(function(res) {
            var net = res.network;
            var assignedDevices = (res.devices || []).filter(function(d) {
                return d.is_assigned;
            });

            // If external router, inject the router node as central gateway
            var devicesToRender = [];
            var hasRouter = assignedDevices.some(function(d) {
                return d.device_type === 'router' || (d.ip_address && d.ip_address.endsWith('.1'));
            });
            if (!hasRouter) {
                devicesToRender.push({
                    id: 999000 + net.id,
                    ip_address: net.gateway_ip || '192.168.1.1',
                    hostname: net.ssid + ' (Router)',
                    vendor: net.vendor || 'Wireless AP',
                    mac_address: net.bssid || '00:00:00:00:00:00',
                    device_type: 'router',
                    status: 'online',
                    last_latency: 1.0,
                    last_loss: 0,
                    last_jitter: 0.1
                });
            }
            devicesToRender = devicesToRender.concat(assignedDevices);
            latestDevicesCache = devicesToRender;

            var clientCount = assignedDevices.length;
            setElementText('devices-count-badge', clientCount + ' End Devices Connected');
            setElementText('mob-nav-dev-count', clientCount);
            setElementText('mob-header-status', clientCount + ' End Devices on ' + net.ssid);
            setElementText('tree-root-subnet-label', net.ssid + ' (⚡ ' + clientCount + (clientCount === 1 ? ' End Device' : ' End Devices') + ')');
            setElementText('toolbar-selected-net-title', net.ssid);
            setElementText('toolbar-selected-net-badge', '⚡ ' + clientCount + ' End Devices');

            renderDeviceTable(devicesToRender);
            renderDeviceTree(devicesToRender);
            if (typeof renderTopology === 'function') {
                renderTopology(devicesToRender);
            }

            if (devicesToRender.length > 0) {
                var first = devicesToRender[0];
                selectedDeviceObj = first;
                selectedDeviceId = first.id;
                selectedDeviceIp = first.ip_address;
                populateDeviceDetails(first);
            }
        }).catch(function() {});
        return;
    }

    fetchJSON('/api/devices').then(function(devices) {
        // Production Rule: Purge any device that is offline/inactive from topology and GUI
        var activeDevices = (devices || []).filter(function(d) {
            return d.status !== 'offline';
        });
        latestDevicesCache = activeDevices;

        setElementText('devices-count-badge', activeDevices.length + ' Active');
        setElementText('mob-nav-dev-count', activeDevices.length);
        setElementText('mob-header-status', activeDevices.length + ' Nodes Active');

        // 1. In-place DataGrid Table Render
        renderDeviceTable(activeDevices);

        // 2. In-place Tree View Render
        renderDeviceTree(activeDevices);

        // 3. 60FPS Topology Canvas Render
        if (typeof renderTopology === 'function') {
            renderTopology(activeDevices);
        }

        // Auto-select initial active device or retain existing if still active
        if (activeDevices.length > 0) {
            var curr = activeDevices.find(function(d) {
                return (selectedDeviceId && d.id === selectedDeviceId) || (selectedDeviceIp && d.ip_address === selectedDeviceIp);
            });
            if (curr) {
                selectedDeviceObj = curr;
                selectedDeviceId = curr.id;
                selectedDeviceIp = curr.ip_address;
                populateDeviceDetails(curr);
            } else {
                var esp32 = activeDevices.find(function(d) {
                    return d.device_type === 'esp32' || (d.vendor && d.vendor.toLowerCase().includes('espressif'));
                });
                var initial = esp32 || activeDevices[0];
                selectDeviceByIdOrIp(initial.id, initial.ip_address);
            }
        } else {
            selectedDeviceId = null;
            selectedDeviceIp = null;
            selectedDeviceObj = null;
            setElementText('det-name', 'No Active Devices');
            setElementText('det-ip', '—');
            setElementText('det-mac', '—');
            setElementText('det-vendor', '—');
            setElementText('det-type', '—');
            setElementText('det-status', '—');
        }
    }).catch(function() {});
}

/**
 * In-place DataGrid Table Render to eliminate scroll jumps and flickering
 */
function renderDeviceTable(devices) {
    var tbody = document.getElementById('devices-table-body');
    if (!tbody) return;

    var searchInput = document.getElementById('device-search-input');
    var searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();

    var filtered = devices.filter(function(d) {
        if (!searchTerm) return true;
        var str = ((d.ip_address || '') + ' ' + (d.mac_address || '') + ' ' + (d.vendor || '') + ' ' + (d.hostname || '') + ' ' + (d.device_type || '') + ' ' + (d.status || '')).toLowerCase();
        return str.includes(searchTerm);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="table-empty-row">No matching devices discovered</td></tr>';
        return;
    }

    var existingRows = {};
    tbody.querySelectorAll('tr[data-id]').forEach(function(row) {
        existingRows[row.getAttribute('data-id')] = row;
    });

    var fragment = document.createDocumentFragment();

    filtered.forEach(function(d, idx) {
        var isSelected = (d.id === selectedDeviceId) || (d.ip_address === selectedDeviceIp);
        var name = getDeviceDisplayName(d);
        var vendorDisplay = (d.vendor && d.vendor !== 'Unknown') ? d.vendor : 'Network Device';
        var latency = d.last_latency !== null && d.last_latency !== undefined ? d.last_latency + ' ms' : '—';
        var loss = d.last_loss !== null && d.last_loss !== undefined ? d.last_loss + '%' : '—';
        var jitter = d.last_jitter !== null && d.last_jitter !== undefined ? d.last_jitter + ' ms' : '—';

        var statusDot = '<span class="dot dot-' + d.status + '"></span> ';
        var statusPill = '<span class="status-pill ' + d.status + '">' + d.status + '</span>';

        var actionHtml = '';
        if (d.is_known === 0) {
            actionHtml = '<button class="fluent-link-btn font-semibold" style="color:#d97706;" onclick="event.stopPropagation(); whitelistDevice(' + d.id + ')">+ Whitelist</button>';
        } else {
            actionHtml = '<span class="badge-success">Known</span>';
        }

        var row = existingRows[d.id];
        if (!row) {
            row = document.createElement('tr');
            row.setAttribute('data-id', d.id);
            row.setAttribute('data-ip', d.ip_address);
            row.onclick = function() {
                selectDeviceByIdOrIp(d.id, d.ip_address);
            };
        }

        var devTypeBadge = '<span class="badge-subtle">' + d.device_type + '</span>';
        if (d.mesh_role) {
            var roleBg = d.mesh_role === 'root' ? '#0284c7' : (d.mesh_role === 'relay' ? '#0d9488' : '#d97706');
            devTypeBadge = '<span class="badge-subtle" style="background:' + roleBg + '22;color:' + roleBg + ';font-weight:600;border:1px solid ' + roleBg + '55;">ESP32 Mesh (' + d.mesh_role + ' L' + (d.mesh_layer || 1) + ')</span>';
        }

        row.className = isSelected ? 'selected-row' : '';
        row.innerHTML =
            '<td style="color:#8a8a8a;">' + (idx + 1) + '</td>' +
            '<td class="font-semibold">' + statusDot + escapeHtml(name) + '</td>' +
            '<td class="mono font-semibold">' + d.ip_address + '</td>' +
            '<td class="mono">' + d.mac_address + '</td>' +
            '<td>' + escapeHtml(vendorDisplay) + '</td>' +
            '<td>' + devTypeBadge + '</td>' +
            '<td>' + statusPill + '</td>' +
            '<td class="mono">' + latency + '</td>' +
            '<td class="mono">' + loss + '</td>' +
            '<td class="mono">' + jitter + '</td>' +
            '<td style="text-align:center;">' + actionHtml + '</td>';

        fragment.appendChild(row);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    // Render mobile native device cards
    renderMobileDeviceCards(filtered);
}

/**
 * In-place Tree View Render preserving category open/collapsed state
 */
function renderDeviceTree(devices) {
    var container = document.getElementById('tree-device-list');
    if (!container) return;

    var categories = {
        'Router': [],
        'Laptops': [],
        'Mobile Devices': [],
        'IoT Devices': [],
        'Desktop PCs': [],
        'Other Devices': [],
    };

    devices.forEach(function(d) {
        var str = ((d.device_type || '') + ' ' + (d.vendor || '') + ' ' + (d.hostname || '')).toLowerCase();
        if (d.device_type === 'router' || str.includes('gateway') || d.ip_address.endsWith('.1') || str.includes('tp-link')) {
            categories['Router'].push(d);
        } else if (str.includes('esp32') || str.includes('espressif') || str.includes('iot')) {
            categories['IoT Devices'].push(d);
        } else if (str.includes('laptop') || str.includes('dell') || str.includes('hp') || str.includes('lenovo')) {
            categories['Laptops'].push(d);
        } else if (str.includes('phone') || str.includes('mobile') || str.includes('samsung') || str.includes('apple')) {
            categories['Mobile Devices'].push(d);
        } else if (str.includes('desktop') || str.includes('pc') || str.includes('intel')) {
            categories['Desktop PCs'].push(d);
        } else {
            categories['Other Devices'].push(d);
        }
    });

    var categoryIcons = {
        'Router': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 14V6"/><path d="M18 14V6"/><path d="M12 14V3"/></svg>',
        'Laptops': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
        'Mobile Devices': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
        'IoT Devices': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
        'Desktop PCs': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        'Other Devices': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };

    var html = '';
    for (var cat in categories) {
        var list = categories[cat];
        if (list.length === 0) continue;

        html += '<div class="tree-category">';
        html += '<div class="tree-category-header" onclick="toggleTreeCategory(this)">';
        html += '<span class="tree-chevron">▾</span>';
        html += '<span style="display:inline-flex;align-items:center;">' + categoryIcons[cat] + cat + '</span>';
        html += '<span class="tree-category-count">(' + list.length + ')</span>';
        html += '</div>';
        html += '<div class="tree-category-items">';

        list.forEach(function(d) {
            var isSelected = (d.id === selectedDeviceId) || (d.ip_address === selectedDeviceIp);
            var selClass = isSelected ? 'selected' : '';
            var name = getDeviceDisplayName(d);
            var dotColor = d.status === 'online' ? '#107c41' : (d.status === 'degraded' ? '#d97706' : '#d13438');

            var meshRoleTag = '';
            if (d.mesh_role) {
                var roleBg = d.mesh_role === 'root' ? '#0284c7' : (d.mesh_role === 'relay' ? '#0d9488' : '#d97706');
                var roleShort = d.mesh_role === 'root' ? 'Root L1' : (d.mesh_role === 'relay' ? 'Relay L' + (d.mesh_layer || 2) : 'Leaf L' + (d.mesh_layer || 3));
                meshRoleTag = ' <span style="font-size:8.5px;padding:1px 5px;border-radius:3px;background:' + roleBg + ';color:#ffffff;font-weight:600;margin-left:4px;flex-shrink:0;">' + roleShort + '</span>';
            }

            html += '<div class="tree-item ' + selClass + '" onclick="selectDeviceByIdOrIp(' + d.id + ', \'' + d.ip_address + '\')">';
            html += '<span class="tree-status-dot" style="background:' + dotColor + '"></span>';
            html += '<span style="display:inline-flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">' + escapeHtml(name) + '</span>' + meshRoleTag;
            html += '<span class="mono" style="margin-left:auto;color:#8a8a8a;font-size:10px;">' + d.ip_address.split('.').slice(2).join('.') + '</span>';
            html += '</div>';
        });

        html += '</div></div>';
    }

    container.innerHTML = html;
}

/**
 * Live ESP32 Telemetry update with smooth meter transitions & local tick counter
 */
function updateEsp32() {
    fetchJSON('/api/esp32/telemetry/latest').then(function(data) {
        if (!data || data.success === false) {
            setElementText('telemetry-source-node', 'Waiting for telemetry broadcast...');
            setElementText('telemetry-rssi', '—');
            setElementText('telemetry-heap', '—');
            setElementText('telemetry-uptime', '—');
            return;
        }

        var sourceBadge = document.getElementById('telemetry-source-badge');
        var sourceNode = document.getElementById('telemetry-source-node');
        if (sourceNode) {
            sourceNode.textContent = data.device_name || (data.source === 'esp32' ? 'ESP32 IoT Node (Wi-Fi)' : 'Host Wi-Fi (Real-Time)');
        }
        if (sourceBadge) {
            sourceBadge.textContent = data.source === 'esp32' ? 'ESP32 Wireless Node' : 'Host Network Hardware';
        }

        setElementText('telemetry-rssi', data.rssi + ' dBm');

        var heapLabel = document.getElementById('telemetry-heap-label');
        var heapBar = document.getElementById('heap-bar');
        if (data.free_heap > 1024 * 1024) {
            // Host RAM in MB
            setElementText('telemetry-heap', (data.free_heap / (1024 * 1024)).toFixed(1) + ' MB Available');
            if (heapLabel) heapLabel.textContent = 'Free System RAM';
            if (heapBar) {
                var heapPct = Math.min(100, Math.max(8, (data.free_heap / (8 * 1024 * 1024 * 1024)) * 100 * 3));
                heapBar.style.width = heapPct + '%';
                heapBar.style.background = '#0078d4';
            }
        } else {
            // ESP32 Microcontroller Heap in KB
            setElementText('telemetry-heap', (data.free_heap / 1024).toFixed(1) + ' KB Free');
            if (heapLabel) heapLabel.textContent = 'ESP32 Free SRAM Heap';
            if (heapBar) {
                var heapPct = Math.min(100, Math.max(5, (data.free_heap / 320000) * 100));
                heapBar.style.width = heapPct + '%';
                heapBar.style.background = '#0067c0';
            }
        }

        esp32LocalUptimeSec = data.uptime_sec;
        setElementText('telemetry-uptime', formatUptime(esp32LocalUptimeSec));

        var rssiPct = Math.min(100, Math.max(0, (data.rssi + 100) * 2));
        var rssiBar = document.getElementById('rssi-bar');
        if (rssiBar) {
            rssiBar.style.width = rssiPct + '%';
            rssiBar.style.background = rssiPct > 60 ? '#107c41' : (rssiPct > 35 ? '#d97706' : '#d13438');
        }
    }).catch(function() {});
}

// Increment local uptime every second for live continuous ticking
function startUptimeTicker() {
    if (esp32UptimeTimer) clearInterval(esp32UptimeTimer);
    esp32UptimeTimer = setInterval(function() {
        if (esp32LocalUptimeSec !== null && esp32LocalUptimeSec >= 0) {
            esp32LocalUptimeSec += 1;
            setElementText('telemetry-uptime', formatUptime(esp32LocalUptimeSec));
        }
    }, 1000);
}

function updateAlerts() {
    fetchJSON('/api/alerts').then(function(alerts) {
        var container = document.getElementById('alerts-list-body');
        var badge = document.getElementById('alerts-count-badge');

        var active = (alerts || []).filter(function(a) { return !a.is_resolved; });
        if (badge) badge.textContent = active.length;

        if (active.length === 0) {
            container.innerHTML =
                '<div class="alerts-empty-state">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#107c41" stroke-width="2">' +
                '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' +
                '</svg><span>No active security threats detected</span></div>';
            return;
        }

        var html = '';
        for (var i = 0; i < active.length; i++) {
            var a = active[i];
            var sevClass = (a.severity || 'low').toLowerCase();
            var sevBadge = sevClass === 'high' ? 'badge-warning' : 'badge-subtle';

            html += '<div class="alert-row ' + sevClass + '">';
            html += '<div class="alert-row-left">';
            html += '<div class="alert-meta">';
            html += '<span class="alert-time">' + formatTimestamp(a.created_at) + '</span>';
            html += '<span class="alert-type-name">' + escapeHtml(a.alert_type) + '</span>';
            html += '<span class="' + sevBadge + '">' + a.severity + '</span>';
            html += '</div>';
            html += '<div class="alert-detail-text">' + escapeHtml(a.message) + '</div>';
            html += '</div>';
            html += '<button class="fluent-link-btn" onclick="resolveAlert(' + a.id + ')">Dismiss</button>';
            html += '</div>';
        }
        container.innerHTML = html;
    }).catch(function() {});
}

function updatePorts(deviceId) {
    if (!deviceId) return;
    fetchJSON('/api/devices/' + deviceId + '/ports').then(function(ports) {
        renderPortsTable(ports);
    }).catch(function() {});
}

function renderPortsTable(ports) {
    var tbody = document.getElementById('ports-table-body');
    if (!tbody || !ports || ports.length === 0) return;

    var html = '';
    ports.forEach(function(p) {
        var dotClass = p.is_open ? 'dot-open' : 'dot-closed';
        var stateText = p.is_open ? 'Open' : 'Closed';
        var secBadge = p.is_unauthorized && p.is_open
            ? '<span class="badge-warning">Unauthorized</span>'
            : '<span class="badge-subtle">Authorized</span>';

        html += '<tr>';
        html += '<td class="mono font-semibold">' + p.port + '</td>';
        html += '<td><span class="port-dot ' + dotClass + '"></span> ' + stateText + '</td>';
        html += '<td>' + p.service + '</td>';
        html += '<td>' + secBadge + '</td>';
        html += '</tr>';
    });
    tbody.innerHTML = html;
}

// -----------------------------------------------------------------------------
// 2. SELECTION & DEVICE DETAILS
// -----------------------------------------------------------------------------

function selectDeviceByIdOrIp(deviceId, ip) {
    selectedDeviceId = deviceId;
    selectedDeviceIp = ip;
    if (window.topoState) window.topoState.selectedIp = ip;

    var dev = latestDevicesCache.find(function(d) {
        return (deviceId && d.id === deviceId) || (ip && d.ip_address === ip);
    });

    if (dev) {
        selectedDeviceObj = dev;
        selectedDeviceId = dev.id;
        selectedDeviceIp = dev.ip_address;
        populateDeviceDetails(dev);
    }

    renderDeviceTable(latestDevicesCache);
    renderDeviceTree(latestDevicesCache);
    if (typeof renderTopology === 'function') {
        renderTopology(latestDevicesCache);
    }
    if (typeof updateMobileTopoSheet === 'function' && dev) {
        updateMobileTopoSheet(dev);
    }

    if (selectedDeviceId) {
        fetchJSON('/api/devices/' + selectedDeviceId + '/history').then(function(history) {
            updateHealthChart(history);
            populateMiniHistory(history);
        }).catch(function() {});

        updatePorts(selectedDeviceId);
    }
}
window.selectDeviceByIdOrIp = selectDeviceByIdOrIp;

function populateDeviceDetails(dev) {
    var name = getDeviceDisplayName(dev);
    var vendor = (dev.vendor && dev.vendor !== 'Unknown') ? dev.vendor : 'Network Device';

    setElementText('details-dev-name', name);
    setElementText('details-dev-ip', dev.ip_address);
    setElementText('chart-panel-title', 'Network Metrics (' + name + ')');
    setElementText('ports-panel-title', 'Port Check (' + name + ')');

    var avatarElem = document.getElementById('details-avatar');
    if (avatarElem) {
        var assetUrl = typeof getDeviceAssetUrl === 'function'
            ? getDeviceAssetUrl(dev.device_type, dev.hostname, dev.vendor)
            : '/static/img/pc.svg';
        avatarElem.innerHTML = '<img src="' + assetUrl + '" alt="' + escapeHtml(name) + '" style="width:28px;height:28px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.1));">';
    }

    var headerStatus = document.getElementById('details-header-status');
    if (headerStatus) {
        headerStatus.className = 'status-pill ' + dev.status;
        headerStatus.textContent = dev.status;
    }

    // General tab
    setElementText('prop-name', name);
    setElementText('prop-ip', dev.ip_address);
    setElementText('prop-mac', dev.mac_address);
    setElementText('prop-type', dev.device_type);
    setElementText('prop-vendor', vendor);
    setElementText('prop-trust', dev.is_known ? 'Whitelisted (Known)' : 'Unknown / Rogue');

    var statusElem = document.getElementById('prop-status');
    if (statusElem) {
        statusElem.innerHTML = '<span class="dot dot-' + dev.status + '"></span> ' + dev.status;
    }

    // Network tab
    if (dev.ip_address) {
        var ipParts = dev.ip_address.split('.');
        if (ipParts.length === 4) {
            setElementText('prop-subnet', ipParts[0] + '.' + ipParts[1] + '.' + ipParts[2] + '.0/24');
            setElementText('prop-gateway', ipParts[0] + '.' + ipParts[1] + '.' + ipParts[2] + '.1');
        }
    }
    setElementText('prop-latency', dev.last_latency !== null && dev.last_latency !== undefined ? dev.last_latency + ' ms' : '—');
    setElementText('prop-loss', dev.last_loss !== null && dev.last_loss !== undefined ? dev.last_loss + '%' : '—');
    setElementText('prop-jitter', dev.last_jitter !== null && dev.last_jitter !== undefined ? dev.last_jitter + ' ms' : '—');
    setElementText('prop-last-seen', dev.last_seen || 'Just now');
}

function populateMiniHistory(history) {
    var container = document.getElementById('mini-history-items');
    if (!container) return;

    if (!history || history.length === 0) {
        container.innerHTML = '<div class="history-item"><span class="time-label">No history recorded</span></div>';
        return;
    }

    var recent = history.slice(-5).reverse();
    var html = '';
    recent.forEach(function(h) {
        var d = new Date(h.recorded_at + 'Z');
        var t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        html += '<div class="history-item">';
        html += '<span class="time-label mono" style="color:#64748b;">' + t + '</span>';
        html += '<span class="metric-tag">' + h.latency_ms + 'ms</span>';
        html += '<span class="metric-tag">' + h.packet_loss_pct + '% loss</span>';
        html += '</div>';
    });
    container.innerHTML = html;
}

// -----------------------------------------------------------------------------
// 3. ACTION HANDLERS
// -----------------------------------------------------------------------------

function triggerScan() {
    if (isScanningInProgress) return;
    isScanningInProgress = true;

    var btn = document.getElementById('btn-scan');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.7';
    }

    showToast('Real-time network discovery scan initiated...', 'info');

    postJSON('/api/scan/trigger').then(function() {
        setElementText('sb-last-scan', 'Last Scan: ' + new Date().toLocaleTimeString());
    }).catch(function() {
        showToast('Scan request failed', 'error');
    });

    setTimeout(function() {
        isScanningInProgress = false;
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
        pollAll();
        showToast('Network discovery scan complete', 'success');
    }, 4500);
}

function startMonitoring() {
    isMonitoringRunning = true;
    postJSON('/api/monitoring/start').then(function() {
        showToast('Continuous network monitoring active', 'success');
        updateSummary();
    }).catch(function() {});
}

function stopMonitoring() {
    isMonitoringRunning = false;
    postJSON('/api/monitoring/stop').then(function() {
        showToast('Monitoring paused', 'info');
        updateSummary();
    }).catch(function() {});
}

function resetAllSystem() {
    if (!confirm('Are you sure you want to completely RESET ALL network monitoring data?\n\nThis will flush the database, purge old/offline devices, clear historical telemetry, and perform an immediate clean network rediscovery.')) {
        return;
    }

    showToast('Resetting network monitoring system & database...', 'info');

    // Clear local topology positions cache so it can recalculate clean layout
    if (typeof topoState !== 'undefined') {
        topoState.nodePositions = {};
    }

    var btn = document.getElementById('btn-reset-all');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
    }

    postJSON('/api/system/reset').then(function(res) {
        showToast('System reset complete. Rediscovering active devices...', 'success');
        setTimeout(function() {
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
            pollAll();
        }, 1500);
    }).catch(function(err) {
        showToast('System reset failed: ' + (err.message || 'Server error'), 'error');
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    });
}
window.resetAllSystem = resetAllSystem;

function whitelistDevice(deviceId) {
    postJSON('/api/devices/' + deviceId + '/whitelist').then(function(res) {
        if (res.success) {
            showToast('Device added to whitelist', 'success');
            pollAll();
        }
    }).catch(function() {
        showToast('Failed to whitelist device', 'error');
    });
}

function whitelistSelectedDevice() {
    if (selectedDeviceId) {
        whitelistDevice(selectedDeviceId);
    } else {
        showToast('No device currently selected', 'info');
    }
}

function scanSelectedDevicePorts() {
    if (!selectedDeviceId) {
        showToast('Please select a device first', 'info');
        return;
    }
    showToast('Scanning ports on ' + selectedDeviceIp + '...', 'info');
    postJSON('/api/devices/' + selectedDeviceId + '/scan-ports').then(function(res) {
        if (res.ports) {
            renderPortsTable(res.ports);
            showToast('Port scan complete for ' + selectedDeviceIp, 'success');
        }
    }).catch(function() {
        showToast('Port scan error', 'error');
    });
}

function resolveAlert(alertId) {
    postJSON('/api/alerts/' + alertId + '/resolve').then(function() {
        updateAlerts();
        updateSummary();
    }).catch(function() {});
}

function resolveAllAlerts() {
    fetchJSON('/api/alerts').then(function(alerts) {
        var unresolved = (alerts || []).filter(function(a) { return !a.is_resolved; });
        unresolved.forEach(function(a) { resolveAlert(a.id); });
        showToast('All alerts dismissed', 'info');
    }).catch(function() {});
}

function triggerExportCSV() {
    window.location.href = '/api/export/csv';
    showToast('Exporting devices to CSV...', 'success');
}

// -----------------------------------------------------------------------------
// 4. UI INTERACTION HELPERS & MODALS
// -----------------------------------------------------------------------------

function switchDetailsTab(tabName, btn) {
    var tabs = document.querySelectorAll('.fluent-tabs .tab-btn');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');

    var panes = document.querySelectorAll('.details-body .tab-pane');
    panes.forEach(function(p) { p.classList.remove('active'); });

    var target = document.getElementById('tab-' + tabName);
    if (target) target.classList.add('active');
}

function toggleTreeFolder(folderElem) {
    folderElem.classList.toggle('expanded');
    var chevron = folderElem.querySelector('.tree-chevron');
    var targetList = document.getElementById('tree-device-list');
    if (targetList) {
        var isHidden = targetList.style.display === 'none';
        targetList.style.display = isHidden ? 'flex' : 'none';
        if (chevron) chevron.textContent = isHidden ? '▾' : '▸';
    }
}

function toggleTreeCategory(headerElem) {
    var items = headerElem.nextElementSibling;
    var chevron = headerElem.querySelector('.tree-chevron');
    if (items) {
        var isHidden = items.style.display === 'none';
        items.style.display = isHidden ? 'block' : 'none';
        if (chevron) chevron.textContent = isHidden ? '▾' : '▸';
    }
}

function filterDeviceTable() {
    renderDeviceTable(latestDevicesCache);
}

function toggleSearchFocus() {
    var input = document.getElementById('device-search-input');
    if (input) {
        input.focus();
        input.select();
    }
}

function changeChartRange(limit) {
    if (selectedDeviceId) {
        fetchJSON('/api/devices/' + selectedDeviceId + '/history?limit=' + limit).then(function(history) {
            updateHealthChart(history);
        }).catch(function() {});
    }
}

function openLogsModal() {
    openModal('modal-logs');
    fetchJSON('/api/system/logs').then(function(logs) {
        var consoleElem = document.getElementById('log-console-text');
        if (consoleElem) {
            if (Array.isArray(logs) && logs.length > 0) {
                consoleElem.textContent = logs.join('\n') + '\n';
                consoleElem.scrollTop = consoleElem.scrollHeight;
            } else {
                consoleElem.textContent = '[SYSTEM] Monitoring active. No errors reported.\n';
            }
        }
    }).catch(function() {});
}

function clearLogsConsole() {
    postJSON('/api/logs/clear').then(function() {
        var consoleElem = document.getElementById('log-console-text');
        if (consoleElem) consoleElem.textContent = '[SYSTEM] Log console buffer cleared.\n';
    }).catch(function() {});
}
window.clearLogsConsole = clearLogsConsole;

function openReportsModal() {
    updateSummary();
    openModal('modal-reports');
}

function openSettingsModal() { openModal('modal-settings'); }
function openAboutModal() { openModal('modal-about'); }

function openAuthModal() {
    var err = document.getElementById('auth-error-msg');
    if (err) err.style.display = 'none';
    var pwd = document.getElementById('auth-password');
    if (pwd) pwd.value = '';
    openModal('modal-auth');
}

function submitAdminLogin() {
    var username = (document.getElementById('auth-username') || {}).value || '';
    var password = (document.getElementById('auth-password') || {}).value || '';
    var errEl = document.getElementById('auth-error-msg');

    if (!username || !password) {
        if (errEl) {
            errEl.textContent = 'Please enter both username and password';
            errEl.style.display = 'block';
        }
        return;
    }

    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success) {
            closeModal('modal-auth');
            showToast('Authenticated as ' + (data.username || 'admin'), 'success');
        } else {
            if (errEl) {
                errEl.textContent = data.message || 'Invalid credentials';
                errEl.style.display = 'block';
            }
        }
    })
    .catch(function(err) {
        if (errEl) {
            errEl.textContent = 'Network error during login';
            errEl.style.display = 'block';
        }
    });
}

function openModal(id) {
    var modal = document.getElementById(id);
    if (modal) modal.classList.add('show');
}

function closeModal(id) {
    var modal = document.getElementById(id);
    if (modal) modal.classList.remove('show');
}

function handleBackdropClick(event, id) {
    if (event.target.id === id) {
        closeModal(id);
    }
}

function clearLogsConsole() {
    var consoleElem = document.getElementById('log-console-text');
    if (consoleElem) consoleElem.textContent = '[SYSTEM] Console cleared at ' + new Date().toLocaleTimeString() + '\n';
}

function saveSettingsForm() {
    closeModal('modal-settings');
    showToast('Monitoring configuration applied', 'success');
}

function showToast(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(function() { toast.classList.add('show'); }, 10);
    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
    }, 3200);
}

function setElementText(id, text) {
    var elem = document.getElementById(id);
    if (elem) elem.textContent = text;
}

function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '—';
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
}

function formatTimestamp(ts) {
    if (!ts) return '';
    var date = new Date(ts + 'Z');
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateClock() {
    var now = new Date();
    setElementText('sb-clock', now.toLocaleTimeString());
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -----------------------------------------------------------------------------
// 5. FULLSCREEN & DESKTOP WINDOW MANAGEMENT
// -----------------------------------------------------------------------------

var isAppFullscreen = false;

function updateFullscreenUI(isFs) {
    isAppFullscreen = !!isFs;
    var btnMenubar = document.getElementById('btn-desktop-fullscreen');
    var lblMenubar = document.getElementById('lbl-desktop-fullscreen');
    var btnToolbar = document.getElementById('btn-toolbar-fullscreen');
    var lblToolbar = document.getElementById('lbl-toolbar-fullscreen');

    var enterSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>' +
        '</svg>';
    var exitSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="4 14 10 14 10 20"/>' +
        '<polyline points="20 10 14 10 14 4"/>' +
        '<line x1="14" y1="10" x2="21" y2="3"/>' +
        '<line x1="3" y1="21" x2="10" y2="14"/>' +
        '</svg>';

    if (btnMenubar) {
        btnMenubar.classList.toggle('active', isAppFullscreen);
        btnMenubar.title = isAppFullscreen ? "Restore Window (F11 / Esc)" : "Toggle Desktop Full Screen (F11)";
        if (lblMenubar) lblMenubar.textContent = isAppFullscreen ? "Restore" : "Full Screen";
        var svgEl = btnMenubar.querySelector('svg');
        if (svgEl) svgEl.outerHTML = isAppFullscreen ? exitSvg : enterSvg;
    }

    if (btnToolbar) {
        btnToolbar.classList.toggle('active', isAppFullscreen);
        btnToolbar.title = isAppFullscreen ? "Restore Window (F11 / Esc)" : "Toggle Desktop Full Screen (F11)";
        if (lblToolbar) lblToolbar.textContent = isAppFullscreen ? "Restore" : "Full Screen";
        var tbSvg = btnToolbar.querySelector('svg');
        if (tbSvg) tbSvg.outerHTML = isAppFullscreen ? exitSvg : enterSvg;
    }
}

function toggleAppFullscreen() {
    // 1. If running under native pywebview desktop bridge
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.toggle_fullscreen === 'function') {
        window.pywebview.api.toggle_fullscreen().then(function(isFs) {
            updateFullscreenUI(isFs);
            showToast(isFs ? 'Desktop Full Screen Enabled (F11 to toggle)' : 'Restored Normal Window', 'info');
        }).catch(function(err) {
            toggleDomFullscreen();
        });
        return;
    }

    toggleDomFullscreen();
}

function toggleDomFullscreen() {
    var isCurrentlyFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    if (!isCurrentlyFs) {
        var el = document.documentElement;
        var rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (rfs) {
            rfs.call(el).then(function() {
                updateFullscreenUI(true);
                showToast('Desktop Full Screen Mode (Press F11 or Esc to exit)', 'info');
            }).catch(function() {
                updateFullscreenUI(true);
            });
        }
    } else {
        var efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (efs) {
            efs.call(document).then(function() {
                updateFullscreenUI(false);
                showToast('Restored Window Mode', 'info');
            }).catch(function() {
                updateFullscreenUI(false);
            });
        }
    }
}

function maximizeAppWindow() {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.maximize === 'function') {
        window.pywebview.api.maximize();
        showToast('Desktop Window Maximized', 'info');
        return;
    }
    toggleAppFullscreen();
}

// Listen to fullscreen changes across all browsers
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(function(evt) {
    document.addEventListener(evt, function() {
        var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        updateFullscreenUI(isFs);
    });
});

window.addEventListener('pywebviewready', function() {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.is_fullscreen === 'function') {
        window.pywebview.api.is_fullscreen().then(function(isFs) {
            updateFullscreenUI(isFs);
        }).catch(function() {});
    }
});

window.toggleAppFullscreen = toggleAppFullscreen;
window.maximizeAppWindow = maximizeAppWindow;
window.updateFullscreenUI = updateFullscreenUI;

// -----------------------------------------------------------------------------
// 6. GLOBAL SHORTCUTS & LIFECYCLE INITIALIZATION
// -----------------------------------------------------------------------------

function handleGlobalKeydown(e) {
    if (e.key === 'F5') {
        e.preventDefault();
        pollAll();
        showToast('Refreshing network state...', 'info');
    } else if (e.key === 'F11') {
        e.preventDefault();
        toggleAppFullscreen();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (typeof toggleTopologyFullscreen === 'function') toggleTopologyFullscreen();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleSearchFocus();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        triggerExportCSV();
    } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        if (typeof resetTopologyZoom === 'function') resetTopologyZoom();
    }
}

function setupMenubar() {
    var menubar = document.querySelector('.win-menubar');
    if (!menubar) return;

    var menuItems = menubar.querySelectorAll('.menu-item');
    var isAnyMenuOpen = false;

    function closeAllMenus() {
        menuItems.forEach(function(m) { m.classList.remove('open'); });
        isAnyMenuOpen = false;
    }

    menuItems.forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            var wasOpen = item.classList.contains('open');
            closeAllMenus();
            if (!wasOpen) {
                item.classList.add('open');
                isAnyMenuOpen = true;
            }
        });

        item.addEventListener('mouseenter', function() {
            if (isAnyMenuOpen) {
                closeAllMenus();
                item.classList.add('open');
                isAnyMenuOpen = true;
            }
        });
    });

    // Clicking inside an option closes the menu
    document.querySelectorAll('.menu-option').forEach(function(opt) {
        opt.addEventListener('click', function() {
            setTimeout(closeAllMenus, 100);
        });
    });

    // Clicking outside closes all menus
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.win-menubar')) {
            closeAllMenus();
        }
    });

    // Esc key closes all menus
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllMenus();
        }
    });
}

function pollAll() {
    updateSummary();
    updateDevices();
    updateEsp32();
    updateAlerts();

    if (selectedDeviceId) {
        fetchJSON('/api/devices/' + selectedDeviceId + '/history').then(function(history) {
            updateHealthChart(history);
        }).catch(function() {});
    }
}

function switchMobileTab(tab) {
    document.body.setAttribute('data-mob-tab', tab);
    document.querySelectorAll('.mob-tab-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    // Close preview sheet if leaving topology
    var sheet = document.getElementById('mob-topo-sheet');
    if (sheet && tab !== 'topology') sheet.classList.remove('show');
    toggleMobileDrawer(false);

    if (tab === 'topology') {
        setTimeout(function() {
            if (window.latestDevicesCache && typeof renderTopology === 'function') {
                renderTopology(window.latestDevicesCache);
            }
        }, 60);
    } else if (tab === 'metrics') {
        setTimeout(function() {
            if (window.healthChart) window.healthChart.resize();
        }, 60);
    }
}
window.switchMobileTab = switchMobileTab;

function toggleMobileDrawer(show) {
    var drawer = document.getElementById('mobile-drawer');
    var backdrop = document.getElementById('mobile-drawer-backdrop');
    if (!drawer) return;
    var isOpen = drawer.classList.contains('open');
    var target = (typeof show === 'boolean') ? show : !isOpen;
    drawer.classList.toggle('open', target);
    if (backdrop) backdrop.classList.toggle('open', target);
}
window.toggleMobileDrawer = toggleMobileDrawer;

function updateMobileTopoSheet(dev) {
    var sheet = document.getElementById('mob-topo-sheet');
    if (!sheet) return;
    if (!dev) {
        sheet.classList.remove('show');
        return;
    }
    var iconEl = document.getElementById('mob-sheet-icon');
    var nameEl = document.getElementById('mob-sheet-name');
    var ipEl = document.getElementById('mob-sheet-ip');
    var statusEl = document.getElementById('mob-sheet-status');

    if (iconEl && typeof getDeviceAssetUrl === 'function') {
        iconEl.src = getDeviceAssetUrl(dev.device_type, dev.hostname, dev.vendor);
    }
    if (nameEl) nameEl.textContent = getDeviceDisplayName(dev);
    if (ipEl) ipEl.textContent = dev.ip_address;
    if (statusEl) {
        statusEl.className = 'status-pill ' + (dev.status || 'online');
        statusEl.textContent = dev.status || 'online';
    }
    sheet.classList.add('show');
}
window.updateMobileTopoSheet = updateMobileTopoSheet;

function openDetailsTabForSelected() {
    switchMobileTab('details');
    var sheet = document.getElementById('mob-topo-sheet');
    if (sheet) sheet.classList.remove('show');
}
window.openDetailsTabForSelected = openDetailsTabForSelected;

function selectDeviceAndOpenDetails(id, ip) {
    selectDeviceByIdOrIp(id, ip);
    switchMobileTab('details');
}
window.selectDeviceAndOpenDetails = selectDeviceAndOpenDetails;

function renderMobileDeviceCards(devices) {
    var container = document.getElementById('devices-mobile-cards');
    if (!container) return;

    if (!devices || devices.length === 0) {
        container.innerHTML = '<div style="padding: 32px 16px; text-align: center; color: #8a8a8a; font-size: 13px;">No devices detected on subnet.</div>';
        return;
    }

    var html = '';
    devices.forEach(function(d) {
        var isSelected = (d.id === selectedDeviceId) || (d.ip_address === selectedDeviceIp);
        var name = getDeviceDisplayName(d);
        var vendorDisplay = (d.vendor && d.vendor !== 'Unknown') ? d.vendor : 'Network Device';
        var latency = d.last_latency !== null && d.last_latency !== undefined ? d.last_latency + ' ms' : '1.2 ms';
        var loss = d.last_loss !== null && d.last_loss !== undefined ? d.last_loss + '%' : '0%';
        var assetUrl = typeof getDeviceAssetUrl === 'function' ? getDeviceAssetUrl(d.device_type, d.hostname, d.vendor) : '/static/img/pc.svg';
        var statusClass = d.status || 'online';

        html +=
            '<div class="mob-device-card ' + (isSelected ? 'selected' : '') + '" onclick="selectDeviceAndOpenDetails(' + d.id + ', \'' + d.ip_address + '\')">' +
                '<div class="mob-card-icon-wrap">' +
                    '<img src="' + assetUrl + '" class="mob-card-img" alt="" />' +
                    '<span class="mob-card-dot dot-' + statusClass + '"></span>' +
                '</div>' +
                '<div class="mob-card-info">' +
                    '<div class="mob-card-row1">' +
                        '<span class="mob-card-title">' + escapeHtml(name) + '</span>' +
                        '<span class="status-pill ' + statusClass + '">' + statusClass + '</span>' +
                    '</div>' +
                    '<div class="mob-card-row2">' +
                        '<span class="mob-card-ip mono">' + d.ip_address + '</span>' +
                        '<span class="mob-card-sep">•</span>' +
                        '<span class="mob-card-vendor">' + escapeHtml(vendorDisplay) + '</span>' +
                    '</div>' +
                    '<div class="mob-card-row3">' +
                        '<span class="mob-card-pill">Ping: <strong>' + latency + '</strong></span>' +
                        '<span class="mob-card-pill">Loss: <strong>' + loss + '</strong></span>' +
                        '<span class="mob-card-mac mono">' + d.mac_address + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="mob-card-arrow">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>' +
                '</div>' +
            '</div>';
    });

    container.innerHTML = html;
}
window.renderMobileDeviceCards = renderMobileDeviceCards;

// -----------------------------------------------------------------------------
// REAL-TIME SERVER-SENT EVENTS (SSE) STREAMING ENGINE
// -----------------------------------------------------------------------------
var sseSource = null;
var sseConnected = false;
var sseReconnectTimer = null;

function initSSE() {
    if (typeof EventSource === 'undefined') {
        console.warn('[SSE] EventSource not supported by this browser. Using HTTP polling fallback.');
        updateStreamIndicator(false);
        return;
    }

    if (sseSource) {
        try { sseSource.close(); } catch(e) {}
    }

    try {
        sseSource = new EventSource('/api/stream');

        sseSource.addEventListener('connected', function(e) {
            sseConnected = true;
            updateStreamIndicator(true);
            console.log('[SSE] Live stream connected:', e.data);
        });

        sseSource.addEventListener('device_update', function(e) {
            try {
                updateDevices();
                updateSummary();
            } catch(err) {
                console.warn('[SSE] device_update error:', err);
            }
        });

        sseSource.addEventListener('telemetry', function(e) {
            try {
                updateEsp32();
                if (window.renderTopology && window.latestDevicesCache) {
                    renderTopology(window.latestDevicesCache);
                }
            } catch(err) {
                console.warn('[SSE] telemetry error:', err);
            }
        });

        sseSource.addEventListener('alert', function(e) {
            try {
                var alertData = JSON.parse(e.data);
                updateAlerts();
                if (typeof showToast === 'function') {
                    showToast('Security Alert: ' + (alertData.message || 'Anomaly detected'), 'danger');
                }
            } catch(err) {
                console.warn('[SSE] alert error:', err);
            }
        });

        sseSource.addEventListener('health', function(e) {
            try {
                updateSummary();
            } catch(err) {}
        });

        sseSource.addEventListener('summary', function(e) {
            try {
                updateSummary();
            } catch(err) {}
        });

        sseSource.onerror = function() {
            sseConnected = false;
            updateStreamIndicator(false);
            try { sseSource.close(); } catch(e) {}
            // Retry SSE connection with automatic backoff
            if (!sseReconnectTimer) {
                sseReconnectTimer = setTimeout(function() {
                    sseReconnectTimer = null;
                    initSSE();
                }, 5000);
            }
        };
    } catch(err) {
        console.warn('[SSE] Initialization error:', err);
        sseConnected = false;
        updateStreamIndicator(false);
    }
}

function updateStreamIndicator(isLive) {
    var mobDot = document.querySelector('.mobile-header-sub .status-dot');
    var mobText = document.getElementById('mob-header-status');
    if (mobDot) {
        mobDot.className = isLive ? 'status-dot dot-online' : 'status-dot dot-degraded';
    }
    if (mobText) {
        mobText.textContent = isLive ? 'Live Push (SSE)' : 'Polling Fallback';
    }

    var sbStatus = document.getElementById('sb-stream-text');
    var sbDot = document.getElementById('sb-stream-dot');
    if (sbStatus) {
        sbStatus.textContent = isLive ? 'SSE Live' : 'Polling';
    }
    if (sbDot) {
        sbDot.className = isLive ? 'dot dot-online' : 'dot dot-degraded';
    }
}

function startPolling() {
    initHealthChart();
    setupMenubar();
    pollAll();
    loadNetworks();
    startUptimeTicker();

    // Start Real-Time SSE push connection
    initSSE();

    // Slower fallback polling loop (every 6 seconds instead of 1.5s spam)
    setInterval(pollAll, 6000);
    setInterval(updateClock, 1000);
    setInterval(loadNetworks, 10000);
    updateClock();
    document.addEventListener('keydown', handleGlobalKeydown);
}

document.addEventListener('DOMContentLoaded', startPolling);

// -----------------------------------------------------------------------------
// MULTI-NETWORK & USER-SELECTABLE ROUTER DEVICE CONTROLLER
// -----------------------------------------------------------------------------

var currentActiveNetworkId = 'all';
var cachedNetworksList = [];
var currentTargetAssignNetworkId = null;

function loadNetworks() {
    return fetchJSON('/api/networks').then(function(networks) {
        cachedNetworksList = networks || [];
        renderNetworkPopover(cachedNetworksList);
        updateActiveNetworkBadge();
    }).catch(function(e) {
        console.warn('Failed to load networks:', e);
    });
}
window.loadNetworks = loadNetworks;

function renderNetworkPopover(networks) {
    var container = document.getElementById('popover-networks-list');
    if (!container) return;

    if (!networks || networks.length === 0) {
        container.innerHTML = '<div style="padding:12px; text-align:center; color:#64748b; font-size:11px;">No networks detected. Click Scan Airspace.</div>';
        return;
    }

    var html = '';

    // Option: All Networks
    var isAllActive = currentActiveNetworkId === 'all';
    html += '<div class="popover-net-item ' + (isAllActive ? 'active' : '') + '" onclick="selectActiveNetwork(\'all\')">' +
        '<div class="popover-net-left">' +
            '<span class="popover-net-icon">🌐</span>' +
            '<div class="popover-net-meta">' +
                '<div class="popover-net-name">All Networks / Local Subnet</div>' +
                '<div class="popover-net-sub">All active physical stations</div>' +
            '</div>' +
        '</div>' +
        '<div class="popover-net-right">' +
            '<span class="net-badge badge-connected">All Nodes</span>' +
        '</div>' +
    '</div>';

    // Grouping
    var meshRouters = networks.filter(function(n) {
        return (n.ssid || '').toLowerCase().startsWith('router_');
    });
    var connected = networks.filter(function(n) {
        return n.is_current_connected && !meshRouters.includes(n);
    });
    var inRange = networks.filter(function(n) {
        return !n.is_current_connected && !meshRouters.includes(n) && (n.network_type === 'in_range' || n.signal_pct > 0);
    });
    var other = networks.filter(function(n) {
        return !n.is_current_connected && !meshRouters.includes(n) && n.network_type !== 'in_range' && n.signal_pct === 0;
    });

    if (meshRouters.length > 0) {
        html += '<div class="popover-section-title" style="color:#0284c7; font-weight:700;">⚡ Multi-Router Fleet (' + meshRouters.length + ' Routers)</div>';
        meshRouters.forEach(function(net) {
            html += renderPopoverNetItem(net);
        });
    }

    if (connected.length > 0) {
        html += '<div class="popover-section-title">Currently Connected</div>';
        connected.forEach(function(net) {
            html += renderPopoverNetItem(net);
        });
    }

    if (inRange.length > 0) {
        html += '<div class="popover-section-title">Nearby Routers in Airspace (' + inRange.length + ')</div>';
        inRange.forEach(function(net) {
            html += renderPopoverNetItem(net);
        });
    }

    if (other.length > 0) {
        html += '<div class="popover-section-title">Saved / Other Routers (' + other.length + ')</div>';
        other.slice(0, 10).forEach(function(net) {
            html += renderPopoverNetItem(net);
        });
    }

    container.innerHTML = html;
}

function renderPopoverNetItem(net) {
    var isSelected = currentActiveNetworkId === net.id;
    var signalDisplay = net.signal_pct > 0 ? net.signal_pct + '%' : 'Saved';
    var icon = net.is_current_connected ? '🟢' : '📡';
    var badgeClass = net.is_current_connected ? 'badge-connected' : (net.signal_pct > 0 ? 'badge-inrange' : 'badge-saved');
    var badgeText = net.is_current_connected ? 'Connected' : (net.signal_pct > 0 ? signalDisplay : 'Known');

    var countVal = (net.assigned_device_count !== undefined && net.assigned_device_count !== null) ? net.assigned_device_count : 0;
    var devCount = ' • ⚡ ' + countVal + (countVal === 1 ? ' End Device' : ' End Devices');

    return '<div class="popover-net-item ' + (isSelected ? 'active' : '') + '" onclick="selectActiveNetwork(' + net.id + ')">' +
        '<div class="popover-net-left">' +
            '<span class="popover-net-icon">' + icon + '</span>' +
            '<div class="popover-net-meta">' +
                '<div class="popover-net-name">' + escapeHtml(net.ssid) + '</div>' +
                '<div class="popover-net-sub">' + escapeHtml(net.vendor || 'Router') + (net.band ? ' (' + net.band + ')' : '') + devCount + '</div>' +
            '</div>' +
        '</div>' +
        '<div class="popover-net-right">' +
            '<span class="net-badge ' + badgeClass + '">' + badgeText + '</span>' +
        '</div>' +
    '</div>';
}

function updateActiveNetworkBadge() {
    var titleEl = document.getElementById('toolbar-selected-net-title');
    var badgeEl = document.getElementById('toolbar-selected-net-badge');
    if (!titleEl || !badgeEl) return;

    if (currentActiveNetworkId === 'all') {
        var curr = cachedNetworksList.find(function(n) { return n.is_current_connected; });
        if (curr) {
            titleEl.textContent = curr.ssid;
            badgeEl.className = 'net-badge badge-connected';
            badgeEl.textContent = 'Active Hotspot';
        } else {
            titleEl.textContent = 'All Networks';
            badgeEl.className = 'net-badge badge-inrange';
            badgeEl.textContent = 'Airspace';
        }
        return;
    }

    var selectedNet = cachedNetworksList.find(function(n) { return n.id === currentActiveNetworkId; });
    if (selectedNet) {
        titleEl.textContent = selectedNet.ssid;
        var count = selectedNet.assigned_device_count !== undefined ? selectedNet.assigned_device_count : 0;
        badgeEl.className = 'net-badge badge-connected';
        badgeEl.textContent = '⚡ ' + count + (count === 1 ? ' Device' : ' Devices');
    }
}

function toggleNetworkDropdown(event) {
    if (event) event.stopPropagation();
    var menu = document.getElementById('network-popover-menu');
    if (!menu) return;
    var isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
        loadNetworks();
        var search = document.getElementById('net-search-input');
        if (search) {
            search.value = '';
            setTimeout(function() { search.focus(); }, 50);
        }
    }
}
window.toggleNetworkDropdown = toggleNetworkDropdown;

function filterNetworkDropdown(query) {
    var q = (query || '').toLowerCase().trim();
    if (!q) {
        renderNetworkPopover(cachedNetworksList);
        return;
    }
    var filtered = cachedNetworksList.filter(function(n) {
        return (n.ssid || '').toLowerCase().includes(q) ||
               (n.vendor || '').toLowerCase().includes(q) ||
               (n.bssid || '').toLowerCase().includes(q);
    });
    renderNetworkPopover(filtered);
}
window.filterNetworkDropdown = filterNetworkDropdown;

function selectActiveNetwork(netId) {
    currentActiveNetworkId = netId;
    var menu = document.getElementById('network-popover-menu');
    if (menu) menu.style.display = 'none';

    updateActiveNetworkBadge();
    renderNetworkPopover(cachedNetworksList);

    if (netId === 'all') {
        showToast('Viewing All Networks & Airspace', 'info');
    } else {
        var net = cachedNetworksList.find(function(n) { return n.id === netId; });
        var name = net ? net.ssid : 'Selected Router';
        showToast('Viewing Router: ' + name, 'info');
    }

    updateDevices();
}
window.selectActiveNetwork = selectActiveNetwork;

function rescanAirspaceNetworks() {
    showToast('Scanning airspace for nearby Wi-Fi routers...', 'info');
    postJSON('/api/networks/scan').then(function(res) {
        if (res.success) {
            showToast('Discovered ' + (res.count || 0) + ' Wi-Fi networks in airspace!', 'success');
            cachedNetworksList = res.networks || [];
            renderNetworkPopover(cachedNetworksList);
            updateActiveNetworkBadge();
        } else {
            showToast('Airspace scan failed', 'error');
        }
    }).catch(function() {
        showToast('Airspace scan request error', 'error');
    });
}
window.rescanAirspaceNetworks = rescanAirspaceNetworks;

// -----------------------------------------------------------------------------
// DEVICE ASSIGNMENT TO ROUTER MODAL
// -----------------------------------------------------------------------------

function openAssignDevicesModal(targetNetId) {
    var netId = targetNetId || (currentActiveNetworkId !== 'all' ? currentActiveNetworkId : null);
    if (!netId) {
        var curr = cachedNetworksList.find(function(n) { return n.is_current_connected; });
        netId = curr ? curr.id : (cachedNetworksList[0] ? cachedNetworksList[0].id : null);
    }

    if (!netId) {
        showToast('Please select or scan a router first', 'warning');
        return;
    }

    currentTargetAssignNetworkId = netId;

    fetchJSON('/api/networks/' + netId + '/devices').then(function(res) {
        var net = res.network;
        var devices = res.devices || [];

        var linkedCount = res.assigned_count || (res.assigned_ids ? res.assigned_ids.length : 0);
        setElementText('assign-modal-router-name', net.ssid);
        setElementText('assign-modal-router-meta', 'Brand: ' + (net.vendor || 'Unknown') + ' • BSSID: ' + (net.bssid || 'Virtual/Manual') + ' • ⚡ ' + linkedCount + ' End Devices Connected');

        var statusBadge = document.getElementById('assign-modal-router-status');
        if (statusBadge) {
            statusBadge.textContent = '⚡ ' + linkedCount + (linkedCount === 1 ? ' End Device' : ' End Devices');
            statusBadge.style.background = '#dcfce7';
            statusBadge.style.color = '#15803d';
        }

        var listContainer = document.getElementById('assign-devices-list-container');
        if (!listContainer) return;

        if (devices.length === 0) {
            listContainer.innerHTML = '<div style="padding:16px; text-align:center; color:#64748b;">No devices discovered yet. Run Network Scan first.</div>';
        } else {
            var html = '';
            devices.forEach(function(d) {
                var checked = d.is_assigned ? 'checked' : '';
                var devName = getDeviceDisplayName(d);
                var assetUrl = getDeviceAssetUrl(d.device_type, d.hostname, d.vendor);

                html += '<div class="assign-device-row">' +
                    '<label>' +
                        '<input type="checkbox" class="assign-dev-checkbox" data-dev-id="' + d.id + '" ' + checked + ' />' +
                        '<img src="' + assetUrl + '" width="22" height="22" style="flex-shrink:0;" alt="" />' +
                        '<div class="assign-device-info">' +
                            '<div class="assign-dev-name">' + escapeHtml(devName) + '</div>' +
                            '<div class="assign-dev-meta mono">' + d.ip_address + ' • ' + d.mac_address + ' (' + (d.vendor || 'Unknown') + ')</div>' +
                        '</div>' +
                    '</label>' +
                '</div>';
            });
            listContainer.innerHTML = html;
        }

        openModal('modal-assign-devices');
    }).catch(function(e) {
        showToast('Failed to load router devices: ' + e.message, 'error');
    });
}
window.openAssignDevicesModal = openAssignDevicesModal;

function selectAllAssignDevices(checked) {
    document.querySelectorAll('.assign-dev-checkbox').forEach(function(cb) {
        cb.checked = !!checked;
    });
}
window.selectAllAssignDevices = selectAllAssignDevices;

function saveDeviceAssignment() {
    if (!currentTargetAssignNetworkId) return;

    var selectedIds = [];
    document.querySelectorAll('.assign-dev-checkbox:checked').forEach(function(cb) {
        var id = parseInt(cb.getAttribute('data-dev-id'), 10);
        if (!isNaN(id)) selectedIds.push(id);
    });

    var saveBtn = document.getElementById('btn-save-device-assignment');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Linking...';
    }

    postJSON('/api/networks/' + currentTargetAssignNetworkId + '/assign', { device_ids: selectedIds }).then(function(res) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Link Devices';
        }
        if (res.success) {
            showToast(res.message || 'Devices successfully assigned to router!', 'success');
            closeModal('modal-assign-devices');
            loadNetworks();
            updateDevices();
        } else {
            showToast('Assignment error: ' + (res.error || 'Failed'), 'error');
        }
    }).catch(function(e) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Link Devices';
        }
        showToast('Request error: ' + e.message, 'error');
    });
}
window.saveDeviceAssignment = saveDeviceAssignment;

function openCustomRouterModal() {
    var menu = document.getElementById('network-popover-menu');
    if (menu) menu.style.display = 'none';
    openModal('modal-custom-router');
}
window.openCustomRouterModal = openCustomRouterModal;

function submitCustomRouter() {
    var ssidEl = document.getElementById('custom-router-ssid');
    var vendorEl = document.getElementById('custom-router-vendor');
    var ipEl = document.getElementById('custom-router-ip');

    var ssid = ssidEl ? ssidEl.value.trim() : '';
    var vendor = vendorEl ? vendorEl.value.trim() : 'Custom Router';
    var ip = ipEl ? ipEl.value.trim() : '192.168.1.1';

    if (!ssid) {
        showToast('Please enter router name (SSID)', 'warning');
        return;
    }

    postJSON('/api/networks/custom', { ssid: ssid, vendor: vendor, gateway_ip: ip }).then(function(res) {
        if (res.success) {
            showToast('Router ' + ssid + ' added!', 'success');
            closeModal('modal-custom-router');
            loadNetworks().then(function() {
                if (res.network_id) {
                    selectActiveNetwork(res.network_id);
                }
            });
        } else {
            showToast('Failed to add router: ' + (res.error || 'Unknown'), 'error');
        }
    }).catch(function(e) {
        showToast('Request error: ' + e.message, 'error');
    });
}
window.submitCustomRouter = submitCustomRouter;

// Close network popover when clicking anywhere else
document.addEventListener('click', function(e) {
    var menu = document.getElementById('network-popover-menu');
    var pill = document.getElementById('network-selector-wrapper');
    if (menu && menu.style.display !== 'none') {
        if (pill && !pill.contains(e.target)) {
            menu.style.display = 'none';
        }
    }
});

// -----------------------------------------------------------------------------
// MULTI-ROUTER ESP32 MESH SIMULATION & TESTING ENGINE
// -----------------------------------------------------------------------------

function triggerMeshSimulation() {
    showToast('Initializing Multi-Router Mesh Fleet (Router A: 3, Router B: 4, Router C: 5)...', 'info');
    postJSON('/api/esp32/mesh/simulate').then(function(res) {
        if (res && res.success) {
            showToast('✅ Multi-Router Mesh Fleet Ready! Router A (3), Router B (4), Router C (5)', 'success');
            loadNetworks().then(function() {
                var routerA = cachedNetworksList.find(function(n) { return (n.ssid || '').toLowerCase().includes('router_a'); });
                if (routerA) {
                    selectActiveNetwork(routerA.id);
                } else {
                    selectActiveNetwork('all');
                }
            });
        } else {
            showToast('Simulation failed: ' + ((res && res.message) || 'Unknown error'), 'error');
        }
    }).catch(function(err) {
        showToast('Simulation request error: ' + err, 'error');
    });
}
window.triggerMeshSimulation = triggerMeshSimulation;

function switchRouterBySsid(ssid) {
    var net = cachedNetworksList.find(function(n) {
        return (n.ssid || '').toLowerCase() === (ssid || '').toLowerCase();
    });
    if (net) {
        selectActiveNetwork(net.id);
    } else {
        showToast('Router ' + ssid + ' not found', 'warning');
    }
}
window.switchRouterBySsid = switchRouterBySsid;


