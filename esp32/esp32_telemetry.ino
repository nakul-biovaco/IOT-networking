#include <WiFi.h>
#include <HTTPClient.h>

// ==============================================================================
// 1. Wi-Fi Configuration
// Connect ESP32 to your local network (e.g. Mobile Hotspot or Wi-Fi Router).
// Default is set to your current active hotspot ("Nakula’s iPhone").
// ==============================================================================
const char* WIFI_SSID     = "Nakula’s iPhone";       // Change if your Hotspot/Wi-Fi SSID is different
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";    // Enter your hotspot / Wi-Fi password

// ==============================================================================
// 2. Monitoring Server Endpoint
// Nakul-PC IP address on your hotspot is 172.20.10.2:5000.
// If your PC IP changes, update the IP address below.
// ==============================================================================
const char* SERVER_URL     = "http://172.20.10.2:5000/api/esp32/telemetry";

// Telemetry interval in milliseconds (3000ms = every 3 seconds real-time stream)
const unsigned long SEND_INTERVAL = 3000;
unsigned long lastSendTime = 0;

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n==========================================");
    Serial.println("  IoT Production Monitor - ESP32 Firmware  ");
    Serial.println("==========================================");

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.printf("Connecting to Wi-Fi SSID: '%s'", WIFI_SSID);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[SUCCESS] Connected to Wi-Fi!");
        Serial.printf("  ESP32 IP Address : %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("  ESP32 MAC Address: %s\n", WiFi.macAddress().c_str());
        Serial.printf("  Gateway IP       : %s\n", WiFi.gatewayIP().toString().c_str());
        Serial.printf("  Target Server    : %s\n", SERVER_URL);
    } else {
        Serial.println("\n[WARNING] Wi-Fi connection timed out. Will auto-retry in main loop.");
    }
    Serial.println("==========================================\n");
}

void loop() {
    // Auto-reconnect if Wi-Fi connection drops
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[ESP32] Wi-Fi disconnected. Attempting auto-reconnection...");
        WiFi.reconnect();
        delay(3000);
        return;
    }

    unsigned long now = millis();
    if (now - lastSendTime >= SEND_INTERVAL) {
        lastSendTime = now;
        sendRealTelemetry();
    }
}

/**
 * Reads 100% REAL hardware metrics from the ESP32 chip:
 * - Real RF signal strength (RSSI in dBm) from ESP32 radio receiver
 * - Real Free Heap Memory in bytes from ESP32 internal SRAM
 * - Real chip uptime in seconds from hardware timer
 */
void sendRealTelemetry() {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(4000);

    String ip        = WiFi.localIP().toString();
    String mac       = WiFi.macAddress();
    int rssi         = WiFi.RSSI();              // Real RF signal strength in dBm (-30 dBm to -95 dBm)
    unsigned long up = millis() / 1000;         // Real runtime in seconds
    uint32_t heap    = ESP.getFreeHeap();        // Real remaining heap SRAM in bytes (out of ~320 KB)

    // Build real telemetry JSON packet
    String payload = "{";
    payload += "\"ip\":\"" + ip + "\",";
    payload += "\"mac\":\"" + mac + "\",";
    payload += "\"rssi\":" + String(rssi) + ",";
    payload += "\"uptime_sec\":" + String(up) + ",";
    payload += "\"free_heap\":" + String(heap);
    payload += "}";

    Serial.printf("[ESP32 TELEMETRY] RSSI: %d dBm | Free Heap: %u bytes (%.1f KB) | Uptime: %lus\n",
                  rssi, heap, heap / 1024.0, up);

    int httpCode = http.POST(payload);

    if (httpCode == 200) {
        Serial.println("  -> Server Response: 200 OK (Telemetry Logged Real-Time)");
    } else if (httpCode > 0) {
        Serial.printf("  -> Server HTTP %d: %s\n", httpCode, http.getString().c_str());
    } else {
        Serial.printf("  -> Connection error: %s (Check if PC server is running at %s)\n",
                      http.errorToString(httpCode).c_str(), SERVER_URL);
    }

    http.end();
}
