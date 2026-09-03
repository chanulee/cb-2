#include "system_settings.hpp"

#include <algorithm>

#include "nvs.h"

namespace bloom::system_settings {

Config normalize(Config config)
{
    config.brightness = std::clamp(config.brightness, 20, 100);
    config.rotation = std::clamp(config.rotation, 0, 3);
    return config;
}

Config load()
{
    Config config{80, 0};
    nvs_handle_t handle = 0;
    if (nvs_open("bloom", NVS_READONLY, &handle) != ESP_OK) return config;
    int32_t brightness = config.brightness;
    int32_t rotation = config.rotation;
    nvs_get_i32(handle, "brightness", &brightness);
    nvs_get_i32(handle, "rotation", &rotation);
    nvs_close(handle);
    return normalize({static_cast<int>(brightness), static_cast<int>(rotation)});
}

esp_err_t save(Config config)
{
    config = normalize(config);
    nvs_handle_t handle = 0;
    esp_err_t result = nvs_open("bloom", NVS_READWRITE, &handle);
    if (result == ESP_OK) result = nvs_set_i32(handle, "brightness", config.brightness);
    if (result == ESP_OK) result = nvs_set_i32(handle, "rotation", config.rotation);
    if (result == ESP_OK) result = nvs_commit(handle);
    if (handle != 0) nvs_close(handle);
    return result;
}

}  // namespace bloom::system_settings
