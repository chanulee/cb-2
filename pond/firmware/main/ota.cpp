#include "ota.hpp"

#include <cstdio>

#include "esp_app_desc.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "settings.hpp"

namespace bloom::ota {
namespace {
constexpr char TAG[] = "ota";
// The build that was last installed over the air. If it crashed and was rolled back,
// this stops Pond from installing the same broken build again on every boot.
constexpr char TRIED_KEY[] = "ota_tried";
}  // namespace

std::string running_version()
{
    return esp_app_get_description()->version;
}

std::string running_sha256()
{
    const auto *description = esp_app_get_description();
    char hex[65];
    for (int index = 0; index < 32; ++index) {
        std::snprintf(hex + index * 2, 3, "%02x", description->app_elf_sha256[index]);
    }
    return hex;
}

bool available(const garden::Hello &hello)
{
    return hello.ok && hello.has_firmware && hello.firmware_sha256.size() == 64 &&
           hello.firmware_sha256 != running_sha256();
}

bool should_auto_install(const garden::Hello &hello)
{
    return available(hello) && hello.firmware_auto && settings::get(TRIED_KEY) != hello.firmware_sha256;
}

void confirm_running_image()
{
    esp_ota_img_states_t state;
    const auto *running = esp_ota_get_running_partition();
    if (esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGI(TAG, "new firmware confirmed");
        esp_ota_mark_app_valid_cancel_rollback();
    }
}

esp_err_t install(const garden::Hello &hello, void (*progress)(int percent))
{
    settings::set(TRIED_KEY, hello.firmware_sha256);
    esp_http_client_config_t http = {};
    http.url = hello.firmware_url.c_str();
    http.timeout_ms = 10000;
    http.keep_alive_enable = true;
    esp_https_ota_config_t config = {};
    config.http_config = &http;

    esp_https_ota_handle_t handle = nullptr;
    esp_err_t result = esp_https_ota_begin(&config, &handle);
    if (result != ESP_OK) return result;
    const int total = esp_https_ota_get_image_size(handle);
    int shown = -1;
    while ((result = esp_https_ota_perform(handle)) == ESP_ERR_HTTPS_OTA_IN_PROGRESS) {
        const int percent = total > 0 ? esp_https_ota_get_image_len_read(handle) * 100 / total : 0;
        if (percent != shown && progress != nullptr) progress(shown = percent);
    }
    if (result != ESP_OK || !esp_https_ota_is_complete_data_received(handle)) {
        esp_https_ota_abort(handle);
        return result == ESP_OK ? ESP_FAIL : result;
    }
    if ((result = esp_https_ota_finish(handle)) != ESP_OK) return result;
    ESP_LOGI(TAG, "installed %s, restarting", hello.firmware_version.c_str());
    if (progress != nullptr) progress(100);
    vTaskDelay(pdMS_TO_TICKS(600));
    esp_restart();
    return ESP_OK;
}

}  // namespace bloom::ota
