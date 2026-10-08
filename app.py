import os
import time
from flask import Flask, render_template, send_from_directory, request

from database.db import init_db
from database.models import get_device_by_ip, upsert_device, update_device_status
from core.scheduler import start_workers
from core.logger import setup_logger
from api.routes_devices import devices_bp
from api.routes_esp32 import esp32_bp
from api.routes_security import security_bp
from api.routes_networks import networks_bp
from api.routes_realtime import realtime_bp
from api.routes_auth import auth_bp
from config import FLASK_HOST, FLASK_PORT, FLASK_DEBUG, DASHBOARD_SECRET_KEY

logger = setup_logger("app")

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.secret_key = DASHBOARD_SECRET_KEY

# Register all blueprints
app.register_blueprint(devices_bp)
app.register_blueprint(esp32_bp)
app.register_blueprint(security_bp)
app.register_blueprint(networks_bp)
app.register_blueprint(realtime_bp)
app.register_blueprint(auth_bp)



from network.discovery import force_fingerprint_device, get_local_ip, get_default_gateway

@app.before_request
def auto_detect_network_client():
    """Dynamically register any client accessing the dashboard or API from the local network (hotspot/router)"""
    try:
        remote_ip = request.remote_addr
        if not remote_ip or remote_ip in ("127.0.0.1", "::1") or remote_ip.startswith("127."):
            return

        dev = get_device_by_ip(remote_ip)
        if not dev:
            local_ip = get_local_ip()
            gw_ip = get_default_gateway(local_ip)
            vendor, hostname, dev_type = force_fingerprint_device(remote_ip, "DYNAMIC", local_ip, gw_ip)

            # Refine with User-Agent if available
            ua = (request.user_agent.string or "").lower()
            if "iphone" in ua or "ipad" in ua:
                dev_type = "mobile"
                hostname = "Apple iPhone"
                vendor = "Apple Inc."
            elif "android" in ua:
                dev_type = "mobile"
                hostname = "Android Phone"
                vendor = "Smartphone (Android)"
            elif "windows" in ua and dev_type != "desktop":
                dev_type = "laptop"
                hostname = "Windows Laptop"
                vendor = "Microsoft Windows"
            elif "macintosh" in ua:
                dev_type = "laptop"
                hostname = "MacBook Client"
                vendor = "Apple Inc."
            elif "esp32" in ua or "espressif" in ua:
                dev_type = "esp32"
                hostname = "ESP32 IoT Node"
                vendor = "Espressif Systems"

            upsert_device(
                ip=remote_ip,
                mac="DYNAMIC",
                vendor=vendor,
                hostname=hostname,
                device_type=dev_type,
            )
            update_device_status(remote_ip, "online")
            logger.info(f"Auto-registered newly connected client station: {remote_ip} ({dev_type} - {hostname})")
        else:
            if dev.get("status") != "online":
                update_device_status(remote_ip, "online")
    except Exception as e:
        logger.error(f"Error in auto_detect_network_client: {e}")


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0, post-check=0, pre-check=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "-1"
    return response


@app.route("/")
def index():
    return render_template("index.html", cache_bust=int(time.time()))


@app.route("/public/<path:filename>")
def serve_public(filename):
    public_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "PUBLIC")
    return send_from_directory(public_dir, filename)


# =============================================================================
# MDNS SERVICE ADVERTISEMENT
# =============================================================================

def start_mdns_service():
    """Advertise this server via mDNS so ESP32 devices can find it automatically."""
    try:
        from zeroconf import Zeroconf, ServiceInfo
        import socket
        from config import MDNS_SERVICE_NAME

        local_ip = get_local_ip()
        ip_bytes = socket.inet_aton(local_ip)

        service_info = ServiceInfo(
            "_http._tcp.local.",
            f"{MDNS_SERVICE_NAME}._http._tcp.local.",
            addresses=[ip_bytes],
            port=FLASK_PORT,
            properties={
                "path": "/api/esp32/telemetry",
                "mesh_path": "/api/esp32/mesh/sync",
                "version": "2.0",
            },
            server=f"{MDNS_SERVICE_NAME}.local.",
        )

        zc = Zeroconf()
        zc.register_service(service_info)
        logger.info(f"mDNS service registered: {MDNS_SERVICE_NAME}.local → {local_ip}:{FLASK_PORT}")
        return zc, service_info
    except ImportError:
        logger.warning("python-zeroconf not installed. mDNS discovery disabled. Install with: pip install zeroconf")
        return None, None
    except Exception as e:
        logger.warning(f"mDNS registration failed (non-fatal): {e}")
        return None, None


# =============================================================================
# PRODUCTION SERVER STARTUP
# =============================================================================

def run_production_server():
    """Start the server with Waitress (production WSGI) if available, else Flask dev server."""
    try:
        from waitress import serve
        logger.info(f"Starting PRODUCTION server (Waitress) on http://{FLASK_HOST}:{FLASK_PORT}")
        serve(app, host=FLASK_HOST, port=FLASK_PORT, threads=8, channel_timeout=120)
    except ImportError:
        logger.warning("Waitress not installed. Falling back to Flask dev server. Install with: pip install waitress")
        app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)


if __name__ == "__main__":
    logger.info("Initializing database...")
    init_db()

    logger.info("Starting mDNS service advertisement...")
    _zc, _svc = start_mdns_service()

    logger.info("Starting background workers (Live real-time network monitoring)...")
    start_workers()

    logger.info(f"Server starting on http://{FLASK_HOST}:{FLASK_PORT}")
    run_production_server()
