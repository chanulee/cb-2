#include "garden.hpp"

#include <cstdio>
#include <mutex>

#include "cJSON.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "mdns.h"

#include "network.hpp"
#include "ota.hpp"
#include "settings.hpp"

namespace bloom::garden {
namespace {

constexpr char TAG[] = "garden";
constexpr int DEFAULT_PORT = 8765;
std::mutex guard;
std::string discovered;

std::string normalize(const std::string &typed)
{
    if (typed.rfind("http://", 0) == 0) return typed;
    if (typed.find(':') != std::string::npos) return "http://" + typed;
    return "http://" + typed + ":" + std::to_string(DEFAULT_PORT);
}

std::string discover()
{
    mdns_result_t *results = nullptr;
    if (mdns_query_ptr("_bloom", "_tcp", 3000, 4, &results) != ESP_OK || results == nullptr) return {};
    std::string url;
    for (auto *result = results; result != nullptr && url.empty(); result = result->next) {
        for (auto *address = result->addr; address != nullptr; address = address->next) {
            if (address->addr.type != ESP_IPADDR_TYPE_V4) continue;
            char ip[16];
            esp_ip4addr_ntoa(&address->addr.u_addr.ip4, ip, sizeof(ip));
            url = std::string("http://") + ip + ":" + std::to_string(result->port);
            break;
        }
    }
    mdns_query_results_free(results);
    if (!url.empty()) ESP_LOGI(TAG, "found Garden at %s", url.c_str());
    return url;
}

esp_err_t collect(esp_http_client_event_t *event)
{
    if (event->event_id == HTTP_EVENT_ON_DATA && event->data_len > 0) {
        auto *body = static_cast<std::string *>(event->user_data);
        if (body->size() + event->data_len <= 4096) {
            body->append(static_cast<const char *>(event->data), event->data_len);
        }
    }
    return ESP_OK;
}

std::string text(const cJSON *object, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) ? item->valuestring : "";
}

}  // namespace

bool manual()
{
    return !settings::get("garden").empty();
}

std::string base_url()
{
    const std::string typed = settings::get("garden");
    if (!typed.empty()) return normalize(typed);
    std::lock_guard<std::mutex> lock(guard);
    if (discovered.empty()) discovered = discover();
    return discovered;
}

void forget()
{
    std::lock_guard<std::mutex> lock(guard);
    discovered.clear();
}

Hello hello()
{
    Hello result;
    const std::string base = base_url();
    if (base.empty()) return result;

    std::string body;
    const std::string url = base + "/api/hello";
    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = 4000;
    config.event_handler = collect;
    config.user_data = &body;
    auto *client = esp_http_client_init(&config);
    if (client == nullptr) return result;
    esp_http_client_set_header(client, "X-Bloom-Device", network::device_id().c_str());
    esp_http_client_set_header(client, "X-Bloom-Version", ota::running_version().c_str());
    const bool answered = esp_http_client_perform(client) == ESP_OK &&
                          esp_http_client_get_status_code(client) == 200;
    esp_http_client_cleanup(client);
    if (!answered) return result;

    cJSON *json = cJSON_ParseWithLength(body.c_str(), body.size());
    if (json == nullptr) return result;
    result.ok = text(json, "name") == "bloom-garden";
    result.ready = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "ready"));
    const cJSON *wpm = cJSON_GetObjectItemCaseSensitive(json, "wpm");
    if (cJSON_IsNumber(wpm)) result.wpm = wpm->valueint;
    result.opening = text(json, "opening");
    const cJSON *firmware = cJSON_GetObjectItemCaseSensitive(json, "firmware");
    if (cJSON_IsObject(firmware)) {
        result.has_firmware = true;
        result.firmware_auto = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(firmware, "auto_install"));
        result.firmware_version = text(firmware, "version");
        result.firmware_sha256 = text(firmware, "sha256");
        result.firmware_url = base + text(firmware, "url");
    }
    cJSON_Delete(json);
    return result;
}

}  // namespace bloom::garden
