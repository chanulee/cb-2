#pragma once

#include <string>
#include <vector>

#include "esp_err.h"

namespace bloom::network {

struct Config {
    std::string ssid;
    std::string password;
    std::string garden;
};

struct AccessPoint {
    std::string ssid;
    int rssi;
    bool secure;
};

using ScanCallback = void (*)(void *context);

bool valid(const Config &config);
esp_err_t init();
Config load();
esp_err_t save_and_connect(const Config &config);
bool connected();
esp_err_t request_scan(ScanCallback callback, void *context);
std::vector<AccessPoint> scan_results();

}  // namespace bloom::network
