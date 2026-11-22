#pragma once

#include <string>
#include <vector>

#include "esp_err.h"

namespace bloom::network {

struct AccessPoint {
    std::string ssid;
    int rssi;
    bool secure;
};

using ScanCallback = void (*)(void *context);

/** Start Wi-Fi and mDNS, and join the saved network if there is one. */
esp_err_t init();
/** Save the credentials and join that network. */
esp_err_t connect(const std::string &ssid, const std::string &password);
bool has_credentials();
bool connected();
std::string ip();
/** "pond-" plus the last three bytes of the MAC address; also the mDNS hostname. */
const std::string &device_id();
esp_err_t request_scan(ScanCallback callback, void *context);
std::vector<AccessPoint> scan_results();

}  // namespace bloom::network
