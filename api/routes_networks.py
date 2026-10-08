from flask import Blueprint, jsonify, request
from database.models import (
    get_all_networks, get_network_by_id, upsert_network,
    assign_devices_to_network, get_assigned_device_ids_for_network,
    get_devices_for_network, add_custom_network, get_all_devices
)
from network.wifi_scanner import scan_all_available_networks

networks_bp = Blueprint("networks", __name__)


def sync_wifi_networks_to_db():
    """Scans and synchronizes networks into SQLite database."""
    try:
        scanned = scan_all_available_networks()
        for net in scanned:
            upsert_network(
                ssid=net.get("ssid", "Unknown"),
                bssid=net.get("bssid", ""),
                vendor=net.get("vendor", "Unknown"),
                signal_pct=net.get("signal_pct", 50),
                band=net.get("band", "2.4 GHz"),
                channel=net.get("channel", 1),
                security_type=net.get("security_type", "WPA2-Personal"),
                is_current_connected=net.get("is_current_connected", 0),
                network_type=net.get("network_type", "in_range")
            )
    except Exception as e:
        print(f"[NETWORKS_SYNC_ERROR] {e}")


@networks_bp.route("/api/networks", methods=["GET"])
def list_networks():
    try:
        nets = get_all_networks()
        if not nets:
            sync_wifi_networks_to_db()
            nets = get_all_networks()
        return jsonify(nets)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify([])


@networks_bp.route("/api/networks/scan", methods=["POST"])
def scan_networks():
    try:
        sync_wifi_networks_to_db()
        nets = get_all_networks()
        return jsonify({
            "success": True,
            "count": len(nets),
            "networks": nets
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@networks_bp.route("/api/networks/<int:net_id>/devices", methods=["GET"])
def get_network_devices(net_id):
    try:
        net = get_network_by_id(net_id)
        if not net:
            return jsonify({"error": "Network not found"}), 404

        assigned_ids = get_assigned_device_ids_for_network(net_id)
        all_devices = get_all_devices(active_only=False)

        # Forceful Assignment: If no manual mapping exists, auto-link devices matching router_ssid, or active client stations
        if not assigned_ids:
            net_ssid = (net.get("ssid") or "").strip().lower()
            # 1. First priority: devices explicitly tagged with this router's SSID
            ssid_matches = [
                d["id"] for d in all_devices
                if d.get("router_ssid") and d.get("router_ssid").strip().lower() == net_ssid
            ]
            if ssid_matches:
                assign_devices_to_network(net_id, ssid_matches)
                assigned_ids = ssid_matches
            else:
                client_candidates = [
                    d["id"] for d in all_devices
                    if d.get("device_type") != "router" and not (d.get("ip_address") or "").endswith(".1")
                ]
                if not client_candidates and all_devices:
                    client_candidates = [d["id"] for d in all_devices]
                if client_candidates:
                    assign_devices_to_network(net_id, client_candidates)
                    assigned_ids = client_candidates

        net["assigned_device_count"] = len(assigned_ids)

        # Mark devices as assigned or available
        device_list = []
        for dev in all_devices:
            dev_copy = dict(dev)
            dev_copy["is_assigned"] = dev["id"] in assigned_ids
            device_list.append(dev_copy)

        return jsonify({
            "network": net,
            "assigned_ids": assigned_ids,
            "assigned_count": len(assigned_ids),
            "devices": device_list
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@networks_bp.route("/api/networks/<int:net_id>/assign", methods=["POST"])
def assign_network_devices(net_id):
    try:
        net = get_network_by_id(net_id)
        if not net:
            return jsonify({"success": False, "error": "Network not found"}), 404

        data = request.get_json(force=True, silent=True) or {}
        device_ids = data.get("device_ids", [])
        if not isinstance(device_ids, list):
            return jsonify({"success": False, "error": "device_ids must be a list"}), 400

        assign_devices_to_network(net_id, [int(did) for did in device_ids])
        return jsonify({
            "success": True,
            "network_id": net_id,
            "assigned_count": len(device_ids),
            "message": f"Successfully linked {len(device_ids)} devices to router '{net['ssid']}'"
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@networks_bp.route("/api/networks/custom", methods=["POST"])
def create_custom_network():
    try:
        data = request.get_json(force=True, silent=True) or {}
        ssid = data.get("ssid", "").strip()
        vendor = data.get("vendor", "Custom Router").strip()
        gateway_ip = data.get("gateway_ip", "192.168.1.1").strip()

        if not ssid:
            return jsonify({"success": False, "error": "SSID / Network name is required"}), 400

        net_id = add_custom_network(ssid=ssid, vendor=vendor, gateway_ip=gateway_ip)
        return jsonify({
            "success": True,
            "network_id": net_id,
            "message": f"Router '{ssid}' added successfully."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
