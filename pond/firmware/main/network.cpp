#include "network.hpp"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <utility>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "mdns.h"

#include "settings.hpp"

namespace bloom::network {
namespace {

constexpr char TAG[] = "network";
std::atomic<bool> online{false};
std::atomic<bool> switching{false};
bool ready = false;
esp_netif_t *station = nullptr;
std::string identity;
std::vector<AccessPoint> access_points;
ScanCallback scan_callback = nullptr;
void *scan_context = nullptr;

void collect_scan()
{
    uint16_t count = 0;
    if (esp_wifi_scan_get_ap_num(&count) != ESP_OK) return;
    count = std::min<uint16_t>(count, 16);
    std::vector<wifi_ap_record_t> records(count);
    if (count == 0 || esp_wifi_scan_get_ap_records(&count, records.data()) != ESP_OK) {
        access_points.clear();
        return;
    }
    std::vector<AccessPoint> next;
    for (uint16_t index = 0; index < count; ++index) {
        const auto &record = records[index];
        const std::string ssid(reinterpret_cast<const char *>(record.ssid));
        if (ssid.empty()) continue;
        const bool duplicate = std::any_of(next.begin(), next.end(), [&](const AccessPoint &item) {
            return item.ssid == ssid;
        });
        if (!duplicate) next.push_back({ssid, record.rssi, record.authmode != WIFI_AUTH_OPEN});
    }
    std::sort(next.begin(), next.end(), [](const AccessPoint &left, const AccessPoint &right) {
        return left.rssi > right.rssi;
    });
    access_points = std::move(next);
}

void on_event(void *, esp_event_base_t base, int32_t id, void *)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_SCAN_DONE) {
        collect_scan();
        const auto callback = std::exchange(scan_callback, nullptr);
        if (callback != nullptr) callback(scan_context);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        online.store(true);
        ESP_LOGI(TAG, "connected, IP %s", ip().c_str());
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        online.store(false);
        if (!switching.load() && has_credentials()) esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        if (has_credentials()) esp_wifi_connect();
    }
}

esp_err_t apply(const std::string &ssid, const std::string &password)
{
    wifi_config_t wifi = {};
    std::strncpy(reinterpret_cast<char *>(wifi.sta.ssid), ssid.c_str(), sizeof(wifi.sta.ssid) - 1);
    std::strncpy(reinterpret_cast<char *>(wifi.sta.password), password.c_str(), sizeof(wifi.sta.password) - 1);
    wifi.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wifi.sta.pmf_cfg.capable = true;
    wifi.sta.pmf_cfg.required = false;
    return esp_wifi_set_config(WIFI_IF_STA, &wifi);
}

}  // namespace

esp_err_t init()
{
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char name[16];
    std::snprintf(name, sizeof(name), "pond-%02x%02x%02x", mac[3], mac[4], mac[5]);
    identity = name;

    esp_err_t result = esp_netif_init();
    if (result != ESP_OK) return result;
    result = esp_event_loop_create_default();
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) return result;
    station = esp_netif_create_default_wifi_sta();
    if (station == nullptr) return ESP_ERR_NO_MEM;

    const wifi_init_config_t wifi = WIFI_INIT_CONFIG_DEFAULT();
    if ((result = esp_wifi_init(&wifi)) != ESP_OK) return result;
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, nullptr);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, nullptr);
    esp_wifi_set_storage(WIFI_STORAGE_RAM);     // credentials live in settings, not in the Wi-Fi driver
    esp_wifi_set_mode(WIFI_MODE_STA);
    if (has_credentials()) apply(settings::get("ssid"), settings::get("password"));
    if ((result = esp_wifi_start()) != ESP_OK) return result;
    ready = true;

    if (mdns_init() == ESP_OK) mdns_hostname_set(identity.c_str());
    return ESP_OK;
}

esp_err_t connect(const std::string &ssid, const std::string &password)
{
    if (!ready || ssid.empty() || ssid.size() > 32 || password.size() > 63) return ESP_ERR_INVALID_ARG;
    esp_err_t result = settings::set("ssid", ssid);
    if (result == ESP_OK) result = settings::set("password", password);
    if (result != ESP_OK) return result;
    switching.store(true);
    esp_wifi_disconnect();
    result = apply(ssid, password);
    switching.store(false);
    return result == ESP_OK ? esp_wifi_connect() : result;
}

bool has_credentials()
{
    return !settings::get("ssid").empty();
}

bool connected()
{
    return online.load();
}

std::string ip()
{
    esp_netif_ip_info_t info = {};
    if (station == nullptr || esp_netif_get_ip_info(station, &info) != ESP_OK) return {};
    char text[16];
    esp_ip4addr_ntoa(&info.ip, text, sizeof(text));
    return text;
}

const std::string &device_id()
{
    return identity;
}

esp_err_t request_scan(ScanCallback callback, void *context)
{
    if (!ready || scan_callback != nullptr) return ESP_ERR_INVALID_STATE;
    scan_callback = callback;
    scan_context = context;
    wifi_scan_config_t config = {};
    config.scan_type = WIFI_SCAN_TYPE_ACTIVE;
    const esp_err_t result = esp_wifi_scan_start(&config, false);
    if (result != ESP_OK) scan_callback = nullptr;
    return result;
}

std::vector<AccessPoint> scan_results()
{
    return access_points;
}

}  // namespace bloom::network
