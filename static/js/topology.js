/**
 * Windows 11 Fluent Dynamic Network Topology Engine (Production Grade 60FPS)
 * 
 * Built for Real-Time Network Health & Security Monitoring:
 * - Standalone Clean SVG Nodes (NO box cards, NO dashed circle halos on selection)
 * - Adaptive Situation-Aware Network Architecture (Auto-detects Wi-Fi AP / Hotspot BSS, STAs, IoT nodes)
 * - Multi-Device Dynamic Scaling (Router/Hotspot, Laptops, Mobile Phones, ESP32)
 * - Full Screen Viewport with Esc Key Exit & Auto Responsive Layout
 * - High-Performance 60FPS Direct-Transform Dragging (Zero DOM lag)
 * - In-Place SVG DOM Syncing (Zero flickering during telemetry polling)
 * - Live Traffic Flow Particle Animations (Speed scaled by RTT latency)
 */

var topoState = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    mode: 'select', // 'select' | 'pan'
    topologyType: 'auto', // 'auto' | 'star' | 'mesh' | 'ring' | 'bus' | 'tree'
    isFullscreen: false,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    activePointerId: null,
    draggedNodeId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    hasMovedDuringClick: false,
    selectedIp: null,
    nodePositions: {}, // ip -> { x, y, data, isRouter, isCustom }
    rafId: null,
};

var DEVICE_ASSETS = {
    router: '/static/img/router.svg',
    esp32: '/static/img/esp32.svg',
    phone: '/static/img/phone.svg',
    mobile: '/static/img/phone.svg',
    pc: '/static/img/pc.svg',
    desktop: '/static/img/pc.svg',
    laptop: '/static/img/laptop.svg',
    generic: '/static/img/pc.svg',
};

function getDeviceAssetUrl(type, hostname, vendor) {
    var str = ((type || '') + ' ' + (hostname || '') + ' ' + (vendor || '')).toLowerCase();
    if (str.includes('esp32') || str.includes('espressif')) {
        return DEVICE_ASSETS.esp32;
    }
    if (str.includes('router') || str.includes('gateway') || str.includes('tp-link') || str.includes('hotspot')) {
        return DEVICE_ASSETS.router;
    }
    if (str.includes('phone') || str.includes('mobile') || str.includes('samsung') || str.includes('apple') || str.includes('android') || str.includes('iphone')) {
        return DEVICE_ASSETS.phone;
    }
    if (str.includes('laptop') || str.includes('dell') || str.includes('hp') || str.includes('lenovo') || str.includes('thinkpad')) {
        return DEVICE_ASSETS.laptop;
    }
    if (str.includes('desktop') || str.includes('pc') || str.includes('workstation') || str.includes('host') || str.includes('intel')) {
        return DEVICE_ASSETS.pc;
    }
    return DEVICE_ASSETS.generic;
}

// -----------------------------------------------------------------------------
// ADAPTIVE SITUATION-AWARE TOPOLOGY COMPUTATION & ARCHITECTURE REFERENCE
// -----------------------------------------------------------------------------

function getActiveTopologyDetails(devices, router, clients) {
    var total = devices ? devices.length : 0;
    var clientCount = clients ? clients.length : (total > 0 ? total - 1 : 0);
    var routerTitle = router ? (router.hostname || router.ssid || 'Router') : 'Gateway';
    var currentType = topoState.topologyType || 'auto';

    if (currentType === 'star' || currentType === 'auto') {
        return {
            type: 'Star Topology (Infrastructure)',
            standard: 'Central Gateway Access Point with Connected Stations',
            shortName: 'Star Topology',
            status: 'Active Live Network',
            medium: 'Local Subnet (Wi-Fi / Ethernet)',
            desc: 'The central gateway router (' + (router ? router.ip_address : 'Gateway') + ') serves as the network hub with ' + clientCount + ' active connected stations.',
            badgeLabel: routerTitle + ' (⚡ ' + clientCount + (clientCount === 1 ? ' End Device' : ' End Devices') + ')'
        };
    }

    if (currentType === 'tree') {
        return {
            type: 'Tree (Hierarchical) Topology',
            standard: 'Multi-Tiered Subnet Distribution',
            shortName: 'Tree Topology',
            status: 'Layout View',
            medium: 'Tiered Station Distribution',
            desc: 'Gateway router at root level with workstations and IoT telemetry nodes in hierarchical distribution tiers.',
            badgeLabel: 'Tree Topology (' + total + ' Nodes)'
        };
    }

    if (currentType === 'mesh') {
        return {
            type: 'Mesh Topology',
            standard: 'Peer-to-Peer Interconnect Model',
            shortName: 'Mesh Topology',
            status: 'Layout View',
            medium: 'Multi-Path Peer Interconnect',
            desc: 'Station-to-station interconnect layout providing direct and redundant communication links.',
            badgeLabel: 'Mesh Topology (' + total + ' Nodes)'
        };
    }

    if (currentType === 'ring') {
        return {
            type: 'Ring Topology',
            standard: 'Sequential Station Loop',
            shortName: 'Ring Topology',
            status: 'Layout View',
            medium: 'Circular Station Sequence',
            desc: 'Sequential closed loop mapping data flow between neighboring active nodes.',
            badgeLabel: 'Ring Topology (' + total + ' Nodes)'
        };
    }

    if (currentType === 'bus') {
        return {
            type: 'Bus Topology',
            standard: 'Shared Backbone Cable Model',
            shortName: 'Bus Topology',
            status: 'Layout View',
            medium: 'Shared Backbone with Station Drops',
            desc: 'Shared transmission trunk layout with dedicated drop lines connecting each network node.',
            badgeLabel: 'Bus Topology (' + total + ' Nodes)'
        };
    }

    return {
        type: 'Star Topology (Infrastructure)',
        standard: 'Central Gateway with Connected Stations',
        shortName: 'Star Topology',
        status: 'Active Live Network',
        medium: 'Local Subnet',
        desc: 'Gateway router coordinates traffic and communicates with all active client stations.',
        badgeLabel: 'Star Topology (' + total + ' Nodes)'
    };
}

function computeAdaptiveTopology(devices, width, height) {
    if (!devices || devices.length === 0) return {};

    var router = null;
    var clients = [];

    // Classify devices into Gateway (AP/Hotspot) vs Connected Stations (STAs)
    devices.forEach(function(d) {
        var str = ((d.device_type || '') + ' ' + (d.vendor || '') + ' ' + (d.hostname || '')).toLowerCase();
        var isGw = d.ip_address.endsWith('.1') || d.device_type === 'router' || str.includes('gateway') || str.includes('router') || str.includes('hotspot');
        if (isGw && !router) {
            router = d;
        } else {
            clients.push(d);
        }
    });

    if (!router && devices.length > 0) {
        router = devices[0];
        clients = devices.slice(1);
    }

    // Update Adaptive Status Badge & Reference Modal
    updateTopologyBadge(devices, router, clients);

    var currentType = topoState.topologyType || 'auto';
    if (currentType === 'star' || (currentType === 'auto')) {
        return computeStarLayout(router, clients, width, height);
    } else if (currentType === 'tree') {
        return computeTreeLayout(router, clients, width, height);
    } else if (currentType === 'mesh') {
        return computeMeshLayout(router, clients, width, height);
    } else if (currentType === 'ring') {
        return computeRingLayout(router, clients, width, height);
    } else if (currentType === 'bus') {
        return computeBusLayout(router, clients, width, height);
    }

    return computeStarLayout(router, clients, width, height);
}

// 1. STAR TOPOLOGY (IEEE 802.11 Infrastructure BSS Star Layout)
// FORCEFULLY place the central hub / router / switch at the EXACT CENTER (cx, cy)
function computeStarLayout(router, clients, width, height) {
    var positions = {};
    var cx = Math.round(width / 2);
    var cy = Math.round(height / 2);
    var clientCount = clients.length;

    // The Central Hub / Switch / Gateway is FORCEFULLY in the EXACT CENTER
    positions[router.ip_address] = {
        x: cx,
        y: cy,
        data: router,
        isRouter: true,
    };

    if (clientCount === 0) return positions;

    // Adaptive radial distances so nodes fit comfortably within canvas
    var rx = Math.min(width * 0.38, 230);
    var ry = Math.min(height * 0.38, 140);
    rx = Math.max(90, Math.min(rx, (width / 2) - 50));
    ry = Math.max(65, Math.min(ry, (height / 2) - 40));

    if (clientCount === 1) {
        var c = clients[0];
        positions[c.ip_address] = {
            x: Math.round(cx + rx),
            y: cy,
            data: c,
            isRouter: false,
        };
    } else if (clientCount === 2) {
        positions[clients[0].ip_address] = {
            x: Math.round(cx - rx),
            y: cy,
            data: clients[0],
            isRouter: false,
        };
        positions[clients[1].ip_address] = {
            x: Math.round(cx + rx),
            y: cy,
            data: clients[1],
            isRouter: false,
        };
    } else {
        // 3 or more clients arranged radially in a balanced star circle around the center hub
        clients.forEach(function(c, i) {
            var angle = (i / clientCount) * 2 * Math.PI - (Math.PI / 2);
            positions[c.ip_address] = {
                x: Math.round(cx + rx * Math.cos(angle)),
                y: Math.round(cy + ry * Math.sin(angle)),
                data: c,
                isRouter: false,
            };
        });
    }
    return positions;
}

// 2. TREE TOPOLOGY (Hierarchical 3-Tier)
function computeTreeLayout(router, clients, width, height) {
    var positions = {};
    var cx = width / 2;
    positions[router.ip_address] = { x: cx, y: Math.max(45, height * 0.18), data: router, isRouter: true };

    var tier2 = [];
    var tier3 = [];
    clients.forEach(function(c) {
        var str = ((c.device_type || '') + ' ' + (c.vendor || '')).toLowerCase();
        if (str.includes('esp') || str.includes('iot')) {
            tier3.push(c);
        } else {
            tier2.push(c);
        }
    });

    if (tier2.length === 0 && tier3.length > 0) {
        tier2 = tier3.splice(0, Math.ceil(tier3.length / 2));
    } else if (tier3.length === 0 && tier2.length > 1) {
        tier3 = tier2.splice(Math.ceil(tier2.length / 2));
    }

    var y2 = Math.round(height * 0.48);
    var y3 = Math.round(height * 0.82);

    if (tier2.length > 0) {
        var spacing2 = Math.min(180, (width - 120) / Math.max(1, tier2.length));
        var start2 = cx - ((tier2.length - 1) * spacing2) / 2;
        tier2.forEach(function(c, i) {
            positions[c.ip_address] = { x: Math.round(start2 + i * spacing2), y: y2, data: c, isRouter: false, tier: 2 };
        });
    }

    if (tier3.length > 0) {
        var spacing3 = Math.min(140, (width - 100) / Math.max(1, tier3.length));
        var start3 = cx - ((tier3.length - 1) * spacing3) / 2;
        tier3.forEach(function(c, i) {
            positions[c.ip_address] = { x: Math.round(start3 + i * spacing3), y: y3, data: c, isRouter: false, tier: 3 };
        });
    }

    return positions;
}

// 3. MESH TOPOLOGY (Interconnected Polygon)
function computeMeshLayout(router, clients, width, height) {
    var all = [router].concat(clients);
    var positions = {};
    var cx = width / 2;
    var cy = height / 2;
    var radius = Math.min(width, height) * 0.36;
    var count = all.length;

    all.forEach(function(d, i) {
        var angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        positions[d.ip_address] = {
            x: Math.round(cx + radius * Math.cos(angle)),
            y: Math.round(cy + radius * Math.sin(angle)),
            data: d,
            isRouter: d === router,
        };
    });
    return positions;
}

// 4. RING TOPOLOGY (Closed Circular Loop)
function computeRingLayout(router, clients, width, height) {
    var all = [router].concat(clients);
    var positions = {};
    var cx = width / 2;
    var cy = height / 2;
    var radius = Math.min(width, height) * 0.37;
    var count = all.length;

    all.forEach(function(d, i) {
        var angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        positions[d.ip_address] = {
            x: Math.round(cx + radius * Math.cos(angle)),
            y: Math.round(cy + radius * Math.sin(angle)),
            data: d,
            isRouter: d === router,
            ringIndex: i,
        };
    });
    return positions;
}

// 5. BUS TOPOLOGY (Common Backbone Trunk)
function computeBusLayout(router, clients, width, height) {
    var all = [router].concat(clients);
    var positions = {};
    var count = all.length;
    var cx = width / 2;
    var busY = height * 0.5;
    var availableWidth = Math.max(300, width - 140);
    var spacing = availableWidth / Math.max(1, count - 1);
    var startX = cx - ((count - 1) * spacing) / 2;

    all.forEach(function(d, i) {
        var isTop = (i % 2 === 0);
        var nodeY = isTop ? Math.max(45, busY - 75) : Math.min(height - 50, busY + 75);
        positions[d.ip_address] = {
            x: Math.round(startX + i * spacing),
            y: Math.round(nodeY),
            data: d,
            isRouter: d === router,
            busX: Math.round(startX + i * spacing),
            busY: Math.round(busY),
        };
    });
    return positions;
}

function updateTopologyBadge(devices, router, clients) {
    var textElem = document.getElementById('topo-adaptive-text');
    var badge = document.getElementById('topo-adaptive-badge');
    var mobStatus = document.getElementById('mob-header-status');
    if (!badge && !textElem) return;

    var info = getActiveTopologyDetails(devices, router, clients);

    if (textElem) {
        textElem.textContent = info.badgeLabel;
    } else if (badge) {
        badge.textContent = info.badgeLabel;
    }

    if (mobStatus) {
        mobStatus.textContent = info.shortName + ' (' + devices.length + ' Nodes)';
    }

    // Update details in the Reference Modal if open
    var mType = document.getElementById('ref-modal-type');
    var mStandard = document.getElementById('ref-modal-standard');
    var mHub = document.getElementById('ref-modal-hub');
    var mClients = document.getElementById('ref-modal-clients');
    var mMedium = document.getElementById('ref-modal-medium');
    var mDesc = document.getElementById('ref-modal-desc');

    if (mType) mType.textContent = info.type;
    if (mStandard) mStandard.textContent = info.standard;
    if (mHub) mHub.textContent = router ? (router.ip_address + ' (' + (router.hostname || router.vendor || 'Gateway') + ')') : '—';
    if (mClients) mClients.textContent = (clients ? clients.length : 0) + ' Active Client Nodes';
    if (mMedium) mMedium.textContent = info.medium;
    if (mDesc) mDesc.innerHTML = info.desc;
}

function toggleTopologyRefModal(show) {
    var modal = document.getElementById('topo-ref-modal');
    if (!modal) return;
    if (show === undefined) {
        modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
    } else {
        modal.style.display = show ? 'flex' : 'none';
    }
}

function switchTopologyType(type) {
    topoState.topologyType = type;

    // Update pill buttons in modal
    var btns = document.querySelectorAll('.topo-pill-btn');
    btns.forEach(function(b) {
        b.classList.remove('active');
        if (b.id === 'btn-topoview-' + type) {
            b.classList.add('active');
        }
    });

    // Clear custom dragged coordinates to allow smooth dynamic layout recalculation
    topoState.nodePositions = {};
    if (window.latestDeviceList) {
        renderTopology(window.latestDeviceList);
    }
}

// -----------------------------------------------------------------------------
// RENDER ENGINE (IN-PLACE DOM SYNCING)
// -----------------------------------------------------------------------------

function renderTopology(devices) {
    var svg = document.getElementById('topology-svg');
    if (!svg) return;

    var container = document.getElementById('topology-viewport');
    var width = container.clientWidth || 650;
    var height = container.clientHeight || 270;

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    var rootGroup = document.getElementById('topo-root-group');
    if (!rootGroup) {
        svg.innerHTML =
            '<defs>' +
                '<linearGradient id="link-grad-active" x1="0%" y1="0%" x2="0%" y2="100%">' +
                    '<stop offset="0%" stop-color="#0067c0" stop-opacity="0.85"/>' +
                    '<stop offset="100%" stop-color="#0078d4" stop-opacity="0.55"/>' +
                '</linearGradient>' +
                '<linearGradient id="link-grad-selected" x1="0%" y1="0%" x2="0%" y2="100%">' +
                    '<stop offset="0%" stop-color="#0067c0" stop-opacity="1"/>' +
                    '<stop offset="100%" stop-color="#004e8c" stop-opacity="0.95"/>' +
                '</linearGradient>' +
            '</defs>' +
            '<g id="topo-root-group">' +
                '<g id="topo-links-layer"></g>' +
                '<g id="topo-nodes-layer"></g>' +
            '</g>';
        rootGroup = document.getElementById('topo-root-group');
    }

    rootGroup.setAttribute('transform', 'translate(' + topoState.panX + ',' + topoState.panY + ') scale(' + topoState.zoom + ')');

    // Filter strictly for ACTIVE devices (online or degraded): offline devices are completely removed
    var activeDevices = (devices || []).filter(function(d) {
        return d && d.status !== 'offline';
    });

    if (activeDevices.length === 0) {
        document.getElementById('topo-links-layer').innerHTML = '';
        document.getElementById('topo-nodes-layer').innerHTML =
            '<text x="' + (width / 2) + '" y="' + (height / 2) + '" font-family="Segoe UI, sans-serif" font-size="12" fill="#8a8a8a" text-anchor="middle">Scanning network for active physical devices...</text>';
        topoState.nodePositions = {};
        return;
    }

    var defaultPos = computeAdaptiveTopology(activeDevices, width, height);

    // Merge positions (preserve custom coords only for devices that are still active)
    for (var ip in defaultPos) {
        if (!topoState.nodePositions[ip]) {
            topoState.nodePositions[ip] = defaultPos[ip];
        } else {
            if (!topoState.nodePositions[ip].isCustom && topoState.draggedNodeId !== ip) {
                topoState.nodePositions[ip].x = defaultPos[ip].x;
                topoState.nodePositions[ip].y = defaultPos[ip].y;
            }
            topoState.nodePositions[ip].data = defaultPos[ip].data;
            topoState.nodePositions[ip].isRouter = defaultPos[ip].isRouter;
        }
    }

    // Forcefully PURGE any IP from topoState.nodePositions that is NOT in defaultPos (offline/stale devices)
    for (var existingIp in topoState.nodePositions) {
        if (!defaultPos[existingIp]) {
            delete topoState.nodePositions[existingIp];
        }
    }

    var nodesLayer = document.getElementById('topo-nodes-layer');
    var linksLayer = document.getElementById('topo-links-layer');

    // In-place sync nodes (zero DOM recreation, 60fps, removes offline SVG nodes immediately)
    syncNodes(nodesLayer, activeDevices);

    // In-place sync links and packet animations
    syncTopologyLinks(linksLayer, width, height);
}

/**
 * Sync Nodes with clean standalone icons (NO card box, NO circle halo)
 */
function syncNodes(nodesLayer, devices) {
    var existingNodes = {};
    nodesLayer.querySelectorAll('.topo-node').forEach(function(el) {
        existingNodes[el.getAttribute('data-ip')] = el;
    });

    var activeIps = {};

    for (var ip in topoState.nodePositions) {
        activeIps[ip] = true;
        var node = topoState.nodePositions[ip];
        var dev = node.data;
        if (!dev) continue;

        var isSelected = (topoState.selectedIp === ip) || (window.selectedDeviceId && dev.id === window.selectedDeviceId);
        var existingElem = existingNodes[ip];

        if (existingElem) {
            existingElem.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
            existingElem.classList.toggle('selected', isSelected);

            var statusColor = dev.status === 'online' ? '#107c41' : (dev.status === 'degraded' ? '#d97706' : '#d13438');
            var dot = existingElem.querySelector('.node-status-dot');
            if (dot) dot.setAttribute('fill', statusColor);
        } else {
            var newElem = createCleanNodeElement(node, dev, isSelected);
            nodesLayer.appendChild(newElem);
        }
    }

    // Clean up removed/offline nodes from DOM immediately
    for (var oldIp in existingNodes) {
        if (!activeIps[oldIp]) {
            existingNodes[oldIp].remove();
            delete topoState.nodePositions[oldIp];
        }
    }
}

/**
 * Creates Clean Standalone Node with direct SVG artwork, status dot, and labels
 * STRICT DESIGN RULE: Zero card boxes, zero circular halo outlines. Simple, clean, standalone.
 */
function createCleanNodeElement(node, dev, isSelected) {
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'topo-node' + (isSelected ? ' selected' : ''));
    g.setAttribute('data-ip', dev.ip_address);
    g.setAttribute('data-id', dev.id || '0');
    g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');

    g.addEventListener('pointerdown', function(e) {
        startNodePointerDrag(e, dev.ip_address);
    });

    g.addEventListener('mouseenter', function(e) {
        showNodeTooltip(e, dev);
    });

    g.addEventListener('mouseleave', function() {
        hideNodeTooltip();
    });

    var isRouter = node.isRouter;
    var imgW = isRouter ? 56 : (dev.device_type === 'mobile' ? 42 : 48);
    var imgH = imgW;
    var imgX = -(imgW / 2);
    var imgY = -(imgH / 2) - 10;

    var statusColor = dev.status === 'online' ? '#107c41' : (dev.status === 'degraded' ? '#d97706' : '#d13438');
    var assetUrl = getDeviceAssetUrl(dev.device_type, dev.hostname, dev.vendor);
    var name = getDeviceDisplayName(dev);
    var displayStr = truncateStr(name, 18);
    var vendorStr = (dev.vendor && dev.vendor !== 'Unknown' && dev.vendor !== 'Network Device') ? truncateStr(dev.vendor, 16) : '';

    // Coordinate math: ensure labels have clear vertical clearance below image
    var labelBaseY = Math.round(imgH / 2 + 5);
    var vendorBaseY = labelBaseY + 12;
    var ipBaseY = vendorStr ? (vendorBaseY + 12) : (labelBaseY + 13);

    var badgeSvg = '';
    if (isRouter) {
        var clientNodes = Object.keys(topoState.nodePositions || {}).filter(function(k) {
            return !topoState.nodePositions[k].isRouter;
        });
        var clientCount = clientNodes.length;
        var badgeY = ipBaseY + 6;
        var badgeLabel = '⚡ ' + clientCount + (clientCount === 1 ? ' End Device' : ' End Devices');
        var badgeW = Math.max(92, badgeLabel.length * 6.5 + 16);
        var badgeX = -Math.round(badgeW / 2);
        badgeSvg =
            '<g class="router-devices-badge">' +
                '<rect x="' + badgeX + '" y="' + badgeY + '" width="' + badgeW + '" height="18" rx="9" fill="#0067c0" />' +
                '<text x="0" y="' + (badgeY + 12.5) + '" font-family="Segoe UI Variable Text, Segoe UI, sans-serif" font-size="9.5" font-weight="700" fill="#ffffff" text-anchor="middle" style="pointer-events: none;">' + badgeLabel + '</text>' +
            '</g>';
    } else if (dev.mesh_role || (dev.mesh_layer && dev.mesh_layer > 0)) {
        var roleLabel = dev.mesh_role === 'root' ? 'Root Bridge (L1)' : (dev.mesh_role === 'relay' ? 'Mesh Relay (L' + dev.mesh_layer + ')' : (dev.mesh_role === 'leaf' ? 'Mesh Leaf (L' + dev.mesh_layer + ')' : 'Mesh Node'));
        var roleColor = dev.mesh_role === 'root' ? '#0284c7' : (dev.mesh_role === 'relay' ? '#0d9488' : '#d97706');
        var roleBadgeY = ipBaseY + 4;
        var rBadgeW = Math.max(76, roleLabel.length * 5.8 + 12);
        var rBadgeX = -Math.round(rBadgeW / 2);
        badgeSvg =
            '<g class="mesh-role-badge">' +
                '<rect x="' + rBadgeX + '" y="' + roleBadgeY + '" width="' + rBadgeW + '" height="15" rx="7.5" fill="' + roleColor + '" />' +
                '<text x="0" y="' + (roleBadgeY + 10.5) + '" font-family="Segoe UI Variable Text, Segoe UI, sans-serif" font-size="8.5" font-weight="600" fill="#ffffff" text-anchor="middle" style="pointer-events: none;">' + roleLabel + '</text>' +
            '</g>';
    }

    g.innerHTML =
        // Standalone SVG artwork
        '<image href="' + assetUrl + '" x="' + imgX + '" y="' + imgY + '" width="' + imgW + '" height="' + imgH + '" preserveAspectRatio="xMidYMid meet" style="pointer-events: none;"/>' +
        // Status dot
        '<circle class="node-status-dot" cx="' + (-Math.min(38, displayStr.length * 3 + 6)) + '" cy="' + (labelBaseY - 3.5) + '" r="3" fill="' + statusColor + '"/>' +
        // Device Name (Model / Hostname)
        '<text class="node-hostname" x="2" y="' + labelBaseY + '" font-family="Segoe UI, sans-serif" font-size="10.5" font-weight="600" fill="#1c1c1c" text-anchor="middle" style="pointer-events: none;">' + escapeXml(displayStr) + '</text>' +
        // Vendor / Manufacturer (if available)
        (vendorStr ? '<text class="node-vendor" x="0" y="' + vendorBaseY + '" font-family="Segoe UI, sans-serif" font-size="8.5" fill="#888" text-anchor="middle" style="pointer-events: none;">' + escapeXml(vendorStr) + '</text>' : '') +
        // IP Address
        '<text class="node-ip" x="0" y="' + ipBaseY + '" font-family="JetBrains Mono, monospace" font-size="9" text-anchor="middle" fill="#64748b" font-weight="500" style="pointer-events: none;">' + dev.ip_address + '</text>' +
        // Connected End Devices Badge on Router
        badgeSvg;

    return g;
}

/**
 * Dynamic Links Generation for Adaptive Infrastructure & Live Packet Flow
 */
function syncTopologyLinks(linksLayer, width, height) {
    var nodesList = [];
    var routerNode = null;

    for (var ip in topoState.nodePositions) {
        var n = topoState.nodePositions[ip];
        nodesList.push(n);
        if (n.isRouter || ip.endsWith('.1')) {
            routerNode = n;
        }
    }

    if (!routerNode && nodesList.length > 0) routerNode = nodesList[0];
    if (nodesList.length < 2) {
        linksLayer.innerHTML = '';
        return;
    }

    var linksHtml = '';
    var currentType = topoState.topologyType || 'auto';

    function createLink(startX, startY, endX, endY, dev, isCurved) {
        var isOnline = dev && dev.status !== 'offline';
        var isSelected = dev && ((topoState.selectedIp === dev.ip_address) || (window.selectedDeviceId && dev.id === window.selectedDeviceId));
        
        // Solid high-visibility Fluent network wire (Zero gradient collapse bug)
        var coreStroke = isOnline ? (isSelected ? '#0078d4' : '#2563eb') : '#94a3b8';
        var coreWidth = isSelected ? '2.8' : '2.0';
        var auraStroke = isSelected ? '#60a5fa' : '#93c5fd';
        var auraWidth = isSelected ? '5.5' : '4.0';
        var dashArray = isOnline ? 'none' : '4,4';

        var pathData = '';
        if (isCurved) {
            var midY = (startY + endY) / 2;
            pathData = 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + midY + ', ' + endX + ' ' + midY + ', ' + endX + ' ' + endY;
        } else {
            pathData = 'M ' + startX + ' ' + startY + ' L ' + endX + ' ' + endY;
        }

        var html = '';
        if (isOnline) {
            // Soft aura underneath wire for high visibility
            html += '<path d="' + pathData + '" fill="none" stroke="' + auraStroke + '" stroke-width="' + auraWidth + '" stroke-linecap="round" opacity="0.45"/>';
        }
        // Crisp physical wire
        html += '<path d="' + pathData + '" fill="none" stroke="' + coreStroke + '" stroke-width="' + coreWidth + '" stroke-dasharray="' + dashArray + '" stroke-linecap="round" opacity="0.95"/>';

        // Animated live packet particle directly on wire
        if (isOnline) {
            var latency = (dev && dev.last_latency !== null) ? dev.last_latency : 10;
            var dur = latency > 50 ? '3.5s' : (latency > 20 ? '2.5s' : '1.8s');
            var pColor = dev && dev.status === 'degraded' ? '#d97706' : '#107c41';
            html += '<circle r="3.2" fill="' + pColor + '"><animateMotion dur="' + dur + '" repeatCount="indefinite" path="' + pathData + '"/></circle>';
        }
        return html;
    }

    function createMeshLink(startX, startY, endX, endY, dev) {
        var isOnline = dev && dev.status !== 'offline';
        var isSelected = dev && ((topoState.selectedIp === dev.ip_address) || (window.selectedDeviceId && dev.id === window.selectedDeviceId));
        
        var coreStroke = isOnline ? (isSelected ? '#00e5ff' : '#06b6d4') : '#94a3b8';
        var coreWidth = isSelected ? '2.6' : '1.8';
        var auraStroke = '#67e8f9';
        var auraWidth = '4.5';
        var dashArray = '4,3';

        var midY = (startY + endY) / 2;
        var pathData = 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + midY + ', ' + endX + ' ' + midY + ', ' + endX + ' ' + endY;

        var html = '';
        if (isOnline) {
            html += '<path d="' + pathData + '" fill="none" stroke="' + auraStroke + '" stroke-width="' + auraWidth + '" stroke-linecap="round" opacity="0.4"/>';
        }
        html += '<path d="' + pathData + '" fill="none" stroke="' + coreStroke + '" stroke-width="' + coreWidth + '" stroke-dasharray="' + dashArray + '" stroke-linecap="round" opacity="0.95"/>';

        if (isOnline) {
            html += '<circle r="3.2" fill="#00e5ff"><animateMotion dur="2.2s" repeatCount="indefinite" path="' + pathData + '"/></circle>';
        }

        // Add Hop indicator on link center
        var hopNum = Math.max(1, (dev && dev.mesh_layer ? dev.mesh_layer - 1 : 1));
        var labelX = Math.round((startX + endX) / 2);
        var labelY = Math.round((startY + endY) / 2) - 4;
        html += '<g class="hop-tag" style="pointer-events:none;">' +
            '<rect x="' + (labelX - 16) + '" y="' + (labelY - 6) + '" width="32" height="12" rx="3" fill="#0891b2" opacity="0.92"/>' +
            '<text x="' + labelX + '" y="' + (labelY + 3) + '" font-family="JetBrains Mono, monospace" font-size="8" font-weight="700" fill="#ffffff" text-anchor="middle">Hop ' + hopNum + '</text>' +
        '</g>';

        return html;
    }

    if (currentType === 'star' || currentType === 'auto') {
        // STAR / MESH ADAPTIVE TOPOLOGY
        nodesList.forEach(function(node) {
            if (node === routerNode) return;
            var dev = node.data;
            if (dev && dev.parent_device_id) {
                var parent = nodesList.find(function(p) {
                    return p.data && p.data.id === dev.parent_device_id;
                });
                if (parent) {
                    linksHtml += createMeshLink(parent.x, parent.y + 14, node.x, node.y - 20, dev);
                    return;
                }
            }
            linksHtml += createLink(routerNode.x, routerNode.y, node.x, node.y, dev, false);
        });
    } else if (currentType === 'tree') {
        // TREE TOPOLOGY: Hierarchical Trunk & Branch Links
        var tier2Nodes = nodesList.filter(function(n) { return n.tier === 2; });
        var tier3Nodes = nodesList.filter(function(n) { return n.tier === 3; });

        if (tier2Nodes.length > 0) {
            tier2Nodes.forEach(function(t2) {
                linksHtml += createLink(routerNode.x, routerNode.y + 16, t2.x, t2.y - 28, t2.data, true);
            });
            if (tier3Nodes.length > 0) {
                tier3Nodes.forEach(function(t3, i) {
                    var parentT2 = tier2Nodes[i % tier2Nodes.length];
                    linksHtml += createLink(parentT2.x, parentT2.y + 16, t3.x, t3.y - 28, t3.data, true);
                });
            }
        } else {
            nodesList.forEach(function(node) {
                if (node !== routerNode) linksHtml += createLink(routerNode.x, routerNode.y + 16, node.x, node.y - 28, node.data, true);
            });
        }
    } else if (currentType === 'ring') {
        // RING TOPOLOGY: Closed Circular Sequence
        var count = nodesList.length;
        for (var i = 0; i < count; i++) {
            var curr = nodesList[i];
            var next = nodesList[(i + 1) % count];
            linksHtml += createLink(curr.x, curr.y, next.x, next.y, curr.data, false);
        }
    } else if (currentType === 'bus') {
        // BUS TOPOLOGY: Horizontal Backbone Line + Vertical Drop Lines
        var minX = width;
        var maxX = 0;
        var busY = Math.round(height * 0.5);

        nodesList.forEach(function(n) {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
        });

        minX = Math.max(30, minX - 45);
        maxX = Math.min(width - 30, maxX + 45);

        // Backbone trunk cable
        linksHtml += '<line x1="' + minX + '" y1="' + busY + '" x2="' + maxX + '" y2="' + busY + '" stroke="#0078d4" stroke-width="4.5" stroke-linecap="round"/>';
        // Bus Terminators (Resistors at both ends)
        linksHtml += '<rect x="' + (minX - 6) + '" y="' + (busY - 8) + '" width="6" height="16" fill="#1e293b" rx="2"/>';
        linksHtml += '<rect x="' + maxX + '" y="' + (busY - 8) + '" width="6" height="16" fill="#1e293b" rx="2"/>';

        // Drop stubs from each node to backbone trunk
        nodesList.forEach(function(node) {
            var isTop = node.y < busY;
            var startY = isTop ? node.y + 16 : node.y - 28;
            linksHtml += createLink(node.x, startY, node.x, busY, node.data, false);
        });
    } else if (currentType === 'mesh') {
        // MESH TOPOLOGY: Polygon Interconnects
        var count = nodesList.length;
        for (var i = 0; i < count; i++) {
            for (var j = i + 1; j < count; j++) {
                var nodeA = nodesList[i];
                var nodeB = nodesList[j];
                linksHtml += createLink(nodeA.x, nodeA.y, nodeB.x, nodeB.y, nodeA.data, false);
            }
        }
    }

    linksLayer.innerHTML = linksHtml;
}

// -----------------------------------------------------------------------------
// 60FPS DIRECT TRANSFORM DRAGGING
// -----------------------------------------------------------------------------

function startNodePointerDrag(event, ip) {
    if (topoState.mode === 'pan') return;

    event.stopPropagation();
    topoState.activePointerId = event.pointerId;
    topoState.draggedNodeId = ip;
    topoState.hasMovedDuringClick = false;

    var viewport = document.getElementById('topology-viewport');
    if (viewport && event.target.setPointerCapture) {
        try { event.target.setPointerCapture(event.pointerId); } catch(e) {}
    }

    var rect = viewport.getBoundingClientRect();
    var mouseX = (event.clientX - rect.left - topoState.panX) / topoState.zoom;
    var mouseY = (event.clientY - rect.top - topoState.panY) / topoState.zoom;

    var node = topoState.nodePositions[ip];
    if (node) {
        topoState.dragOffsetX = mouseX - node.x;
        topoState.dragOffsetY = mouseY - node.y;
    }
}

function updateNodeDirectly(ip, newX, newY) {
    var node = topoState.nodePositions[ip];
    if (!node) return;

    node.x = newX;
    node.y = newY;
    node.isCustom = true;

    var nodeElem = document.querySelector('.topo-node[data-ip="' + ip + '"]');
    if (nodeElem) {
        nodeElem.setAttribute('transform', 'translate(' + newX + ',' + newY + ')');
    }

    var container = document.getElementById('topology-viewport');
    var width = container.clientWidth || 650;
    var height = container.clientHeight || 270;

    syncTopologyLinks(
        document.getElementById('topo-links-layer'),
        width,
        height
    );
}

// -----------------------------------------------------------------------------
// FULLSCREEN TOPOLOGY TOGGLE
// -----------------------------------------------------------------------------

function toggleTopologyFullscreen() {
    var panel = document.getElementById('panel-topology-main');
    var btn = document.getElementById('btn-topo-fullscreen');
    if (!panel) return;

    topoState.isFullscreen = !topoState.isFullscreen;
    panel.classList.toggle('fullscreen-panel', topoState.isFullscreen);

    if (btn) {
        if (topoState.isFullscreen) {
            btn.classList.add('active');
            btn.innerHTML =
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<polyline points="4 14 10 14 10 20"/>' +
                    '<polyline points="20 10 14 10 14 4"/>' +
                    '<line x1="14" y1="10" x2="21" y2="3"/>' +
                    '<line x1="3" y1="21" x2="10" y2="14"/>' +
                '</svg>' +
                '<span style="margin-left: 2px;">Collapse</span>';
            btn.title = "Collapse Canvas View (Esc)";
        } else {
            btn.classList.remove('active');
            btn.innerHTML =
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<polyline points="15 3 21 3 21 9"/>' +
                    '<polyline points="9 21 3 21 3 15"/>' +
                    '<line x1="21" y1="3" x2="14" y2="10"/>' +
                    '<line x1="3" y1="21" x2="10" y2="14"/>' +
                '</svg>' +
                '<span style="margin-left: 2px;">Expand</span>';
            btn.title = "Expand Canvas View";
        }
    }

    // Re-adapt layout smoothly to the newly resized container
    setTimeout(function() {
        for (var ip in topoState.nodePositions) {
            topoState.nodePositions[ip].isCustom = false;
        }
        topoState.zoom = 1.0;
        topoState.panX = 0;
        topoState.panY = 0;
        if (window.latestDevicesCache) {
            renderTopology(window.latestDevicesCache);
        }
    }, 60);
}

function autoLayoutTopology() {
    topoState.nodePositions = {};
    topoState.zoom = 1.0;
    topoState.panX = 0;
    topoState.panY = 0;
    if (window.latestDevicesCache) {
        renderTopology(window.latestDevicesCache);
    }
    showToast('Network Topology Re-Centered & Auto-Balanced', 'info');
}

function setTopologyMode(mode) {
    topoState.mode = mode;
    var btnSelect = document.getElementById('btn-tool-select');
    var btnPan = document.getElementById('btn-tool-pan');
    if (btnSelect) btnSelect.classList.toggle('active', mode === 'select');
    if (btnPan) btnPan.classList.toggle('active', mode === 'pan');

    var viewport = document.getElementById('topology-viewport');
    if (viewport) {
        viewport.style.cursor = mode === 'pan' ? 'grab' : 'default';
    }
}

function zoomTopology(factor, centerX, centerY) {
    var oldZoom = topoState.zoom;
    var newZoom = Math.max(0.4, Math.min(2.8, oldZoom * factor));

    if (centerX !== undefined && centerY !== undefined) {
        topoState.panX = centerX - (centerX - topoState.panX) * (newZoom / oldZoom);
        topoState.panY = centerY - (centerY - topoState.panY) * (newZoom / oldZoom);
    }

    topoState.zoom = newZoom;
    updateViewportTransform();
}

function resetTopologyZoom() {
    topoState.zoom = 1.0;
    topoState.panX = 0;
    topoState.panY = 0;
    updateViewportTransform();
}

function updateViewportTransform() {
    var rootGroup = document.getElementById('topo-root-group');
    if (rootGroup) {
        rootGroup.setAttribute('transform', 'translate(' + topoState.panX + ',' + topoState.panY + ') scale(' + topoState.zoom + ')');
    } else if (window.latestDevicesCache) {
        renderTopology(window.latestDevicesCache);
    }
}

// -----------------------------------------------------------------------------
// TOOLTIPS & UTILITIES
// -----------------------------------------------------------------------------

function showNodeTooltip(event, dev) {
    var tooltip = document.getElementById('topo-hover-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'topo-hover-tooltip';
        tooltip.className = 'topo-tooltip-card';
        document.body.appendChild(tooltip);
    }

    var name = dev.hostname && dev.hostname !== 'Unknown' ? dev.hostname : getDeviceDisplayName(dev);
    var vendorLine = (dev.vendor && dev.vendor !== 'Unknown') ? dev.vendor : '';
    var latency = dev.last_latency !== null && dev.last_latency !== undefined ? dev.last_latency + ' ms' : '—';
    var loss = dev.last_loss !== null && dev.last_loss !== undefined ? dev.last_loss + '%' : '0%';
    var jitter = dev.last_jitter !== null && dev.last_jitter !== undefined ? dev.last_jitter + ' ms' : '—';
    var statusClass = dev.status || 'online';

    tooltip.innerHTML =
        '<div class="tt-header">' +
            '<span class="dot dot-' + statusClass + '"></span>' +
            '<span class="tt-title">' + escapeXml(name) + '</span>' +
            '<span class="status-pill ' + statusClass + '" style="margin-left:auto;">' + statusClass + '</span>' +
        '</div>' +
        '<div class="tt-body">' +
            (vendorLine ? '<div class="tt-row"><span>Vendor:</span><span style="font-weight:600;">' + escapeXml(vendorLine) + '</span></div>' : '') +
            '<div class="tt-row"><span>Type:</span><span>' + (dev.device_type || '—') + '</span></div>' +
            '<div class="tt-row"><span>IP:</span><span class="mono">' + dev.ip_address + '</span></div>' +
            '<div class="tt-row"><span>MAC:</span><span class="mono">' + dev.mac_address + '</span></div>' +
            '<div class="tt-metrics">' +
                '<div class="tt-metric-pill"><span>RTT</span><b>' + latency + '</b></div>' +
                '<div class="tt-metric-pill"><span>Loss</span><b>' + loss + '</b></div>' +
                '<div class="tt-metric-pill"><span>Jitter</span><b>' + jitter + '</b></div>' +
            '</div>' +
        '</div>';

    var x = event.clientX + 12;
    var y = event.clientY + 12;

    if (x + 220 > window.innerWidth) x = event.clientX - 230;
    if (y + 140 > window.innerHeight) y = event.clientY - 150;

    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
    tooltip.classList.add('visible');
}

function hideNodeTooltip() {
    var tooltip = document.getElementById('topo-hover-tooltip');
    if (tooltip) tooltip.classList.remove('visible');
}

function getDeviceDisplayName(dev) {
    if (!dev) return 'Device';
    // Priority 1: Real hostname if it's a genuine name (not a placeholder)
    var h = dev.hostname || '';
    if (h && h !== 'Unknown' && !h.startsWith('Host-') && !h.startsWith('Device-') && !h.startsWith('Client-')) {
        return h;
    }
    // Priority 2: Vendor brand name (real manufacturer)
    var v = dev.vendor || '';
    if (v && v !== 'Unknown' && v !== 'Network Device') {
        return v;
    }
    // Priority 3: device_type label
    var t = dev.device_type || '';
    if (t === 'esp32') return 'ESP32';
    if (t === 'router') return 'Gateway';
    if (t === 'mobile') return 'Mobile';
    if (t === 'laptop') return 'Laptop';
    if (t === 'desktop') return 'Desktop';
    return 'Device';
}

function truncateStr(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '..' : str;
}

function escapeXml(unsafe) {
    return (unsafe || '').replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

// -----------------------------------------------------------------------------
// EVENT LISTENERS & RESIZE OBSERVER
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function() {
    var viewport = document.getElementById('topology-viewport');
    if (!viewport) return;

    // Pan / Drag Interactions
    viewport.addEventListener('pointerdown', function(e) {
        if ((e.button === 1 || topoState.mode === 'pan') && !topoState.draggedNodeId) {
            topoState.isPanning = true;
            topoState.panStartX = e.clientX - topoState.panX;
            topoState.panStartY = e.clientY - topoState.panY;
            viewport.style.cursor = 'grabbing';
            try { viewport.setPointerCapture(e.pointerId); } catch(err) {}
        }
    });

    viewport.addEventListener('pointermove', function(e) {
        if (topoState.draggedNodeId) {
            topoState.hasMovedDuringClick = true;
            var rect = viewport.getBoundingClientRect();
            var mouseX = (e.clientX - rect.left - topoState.panX) / topoState.zoom;
            var mouseY = (e.clientY - rect.top - topoState.panY) / topoState.zoom;

            var newX = mouseX - topoState.dragOffsetX;
            var newY = mouseY - topoState.dragOffsetY;

            if (!topoState.rafId) {
                topoState.rafId = requestAnimationFrame(function() {
                    topoState.rafId = null;
                    updateNodeDirectly(topoState.draggedNodeId, newX, newY);
                });
            }
        } else if (topoState.isPanning) {
            topoState.panX = e.clientX - topoState.panStartX;
            topoState.panY = e.clientY - topoState.panStartY;

            if (!topoState.rafId) {
                topoState.rafId = requestAnimationFrame(function() {
                    topoState.rafId = null;
                    updateViewportTransform();
                });
            }
        }
    });

    viewport.addEventListener('pointerup', function(e) {
        if (topoState.draggedNodeId) {
            var ip = topoState.draggedNodeId;
            var node = topoState.nodePositions[ip];
            var dev = node ? node.data : null;

            if (!topoState.hasMovedDuringClick && dev && window.selectDeviceByIdOrIp) {
                window.selectDeviceByIdOrIp(dev.id, dev.ip_address);
            }

            topoState.draggedNodeId = null;
        }

        if (topoState.isPanning) {
            topoState.isPanning = false;
            viewport.style.cursor = topoState.mode === 'pan' ? 'grab' : 'default';
        }
    });

    viewport.addEventListener('wheel', function(e) {
        e.preventDefault();
        var rect = viewport.getBoundingClientRect();
        var cursorX = e.clientX - rect.left;
        var cursorY = e.clientY - rect.top;
        var factor = e.deltaY < 0 ? 1.08 : 0.92;
        zoomTopology(factor, cursorX, cursorY);
    }, { passive: false });

    viewport.addEventListener('dblclick', function(e) {
        if (e.target === viewport || e.target.id === 'topology-svg') {
            resetTopologyZoom();
        }
    });

    // Window Keydown: Esc to exit fullscreen
    window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && topoState.isFullscreen) {
            toggleTopologyFullscreen();
        }
    });

    // Window Resize: Auto adapt topology layout
    window.addEventListener('resize', function() {
        if (window.latestDevicesCache) {
            renderTopology(window.latestDevicesCache);
        }
    });
});
