#include "network.hpp"

#include <atomic>
#include <algorithm>
#include <cstring>
#include <utility>
#include <vector>

#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "nvs_flash.h"

namespace bloom::network {
namespace {

std::atomic<bool> online{false};
std::atomic<bool> changing_config{false};
bool ready = false;
std::vector<AccessPoint> access_points;
ScanCallback scan_callback = nullptr;
void *scan_context = nullptr;

std::string read_string(nvs_handle_t handle, const char *key)
{
    size_t size = 0;
    if (nvs_get_str(handle, key, nullptr, &size) != ESP_OK || size == 0) return {};
    std::string result(size, '\0');
    nvs_get_str(handle, key, result.data(), &size);
    result.resize(size - 1);
    return result;
}

void events(void *, esp_event_base_t base, int32_t id, void *)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_SCAN_DONE) {
        uint16_t count = 0;
        if (esp_wifi_scan_get_ap_num(&count) == ESP_OK) {
            count = std::min<uint16_t>(count, 12);
            std::vector<wifi_ap_record_t> records(count);
            if (count > 0 && esp_wifi_scan_get_ap_records(&count, records.data()) == ESP_OK) {
                std::vector<AccessPoint> next;
                for (const auto &record : records) {
                    const auto *ssid = reinterpret_cast<const char *>(record.ssid);
                    if (ssid[0] == '\0') continue;
                    const auto duplicate = std::find_if(next.begin(), next.end(), [&](const AccessPoint &item) {
                        return item.ssid == ssid;
                    });
                    if (duplicate == next.end()) {
                        next.push_back({ssid, record.rssi, record.authmode != WIFI_AUTH_OPEN});
                    }
                }
                std::sort(next.begin(), next.end(), [](const AccessPoint &left, const AccessPoint &right) {
                    return left.rssi > right.rssi;
                });
                access_points = std::move(next);
            }
        }
        const auto callback = scan_callback;
        void *context = scan_context;
        scan_callback = nullptr;
        scan_context = nullptr;
        if (callback != nullptr) callback(context);
        return;
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) online.store(true);
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED && !changing_config.load()) {
        online.store(false);
        esp_wifi_connect();
    }
}

esp_err_t connect(const Config &config)
{
    if (!ready || !valid(config)) return ESP_ERR_INVALID_STATE;
    wifi_config_t wifi = {};
    std::strncpy(reinterpret_cast<char *>(wifi.sta.ssid), config.ssid.c_str(), sizeof(wifi.sta.ssid) - 1);
    std::strncpy(reinterpret_cast<char *>(wifi.sta.password), config.password.c_str(), sizeof(wifi.sta.password) - 1);
    wifi.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wifi.sta.pmf_cfg.capable = true;
    wifi.sta.pmf_cfg.required = false;
    changing_config.store(true);
    esp_wifi_disconnect();
    const esp_err_t result = esp_wifi_set_config(WIFI_IF_STA, &wifi);
    changing_config.store(false);
    return result == ESP_OK ? esp_wifi_connect() : result;
}

}  // namespace

bool valid(const Config &config)
{
    return !config.ssid.empty() && config.ssid.size() <= 32 && config.password.size() <= 63 &&
           !config.garden.empty() && config.garden.size() <= 96;
}

esp_err_t init()
{
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    if (result != ESP_OK) return result;
    if ((result = esp_netif_init()) != ESP_OK && result != ESP_ERR_INVALID_STATE) return result;
    result = esp_event_loop_create_default();
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) return result;
    if (esp_netif_get_handle_from_ifkey("WIFI_STA_DEF") == nullptr &&
        esp_netif_create_default_wifi_sta() == nullptr) return ESP_ERR_NO_MEM;

    wifi_init_config_t wifi = WIFI_INIT_CONFIG_DEFAULT();
    result = esp_wifi_init(&wifi);
    if (result != ESP_OK && result != ESP_ERR_WIFI_INIT_STATE) return result;
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, events, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, events, nullptr));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_FLASH));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    result = esp_wifi_start();
    if (result != ESP_OK && result != ESP_ERR_WIFI_NOT_STOPPED) return result;
    ready = true;

    const Config saved = load();
    return valid(saved) ? connect(saved) : ESP_OK;
}

Config load()
{
    nvs_handle_t handle = 0;
    if (nvs_open("bloom", NVS_READONLY, &handle) != ESP_OK) return {};
    Config config{read_string(handle, "ssid"), read_string(handle, "password"), read_string(handle, "garden")};
    nvs_close(handle);
    return config;
}

esp_err_t save_and_connect(const Config &config)
{
    if (!valid(config)) return ESP_ERR_INVALID_ARG;
    nvs_handle_t handle = 0;
    esp_err_t result = nvs_open("bloom", NVS_READWRITE, &handle);
    if (result == ESP_OK) result = nvs_set_str(handle, "ssid", config.ssid.c_str());
    if (result == ESP_OK) result = nvs_set_str(handle, "password", config.password.c_str());
    if (result == ESP_OK) result = nvs_set_str(handle, "garden", config.garden.c_str());
    if (result == ESP_OK) result = nvs_commit(handle);
    if (handle != 0) nvs_close(handle);
    return result == ESP_OK ? connect(config) : result;
}

bool connected()
{
    return online.load();
}

esp_err_t request_scan(ScanCallback callback, void *context)
{
    if (!ready || scan_callback != nullptr) return ESP_ERR_INVALID_STATE;
    scan_callback = callback;
    scan_context = context;
    wifi_scan_config_t config = {};
    config.show_hidden = false;
    config.scan_type = WIFI_SCAN_TYPE_ACTIVE;
    const esp_err_t result = esp_wifi_scan_start(&config, false);
    if (result != ESP_OK) {
        scan_callback = nullptr;
        scan_context = nullptr;
    }
    return result;
}

std::vector<AccessPoint> scan_results()
{
    return access_points;
}

}  // namespace bloom::network
