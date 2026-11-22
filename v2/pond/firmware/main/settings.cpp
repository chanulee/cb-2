#include "settings.hpp"

#include "nvs.h"
#include "nvs_flash.h"

namespace bloom::settings {
namespace {
constexpr char NAMESPACE[] = "bloom";
}

esp_err_t init()
{
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        result = nvs_flash_erase();
        if (result == ESP_OK) result = nvs_flash_init();
    }
    return result;
}

std::string get(const char *key)
{
    nvs_handle_t handle = 0;
    if (nvs_open(NAMESPACE, NVS_READONLY, &handle) != ESP_OK) return {};
    size_t size = 0;
    std::string value;
    if (nvs_get_str(handle, key, nullptr, &size) == ESP_OK && size > 1) {
        value.resize(size);
        if (nvs_get_str(handle, key, value.data(), &size) == ESP_OK) value.resize(size - 1);
        else value.clear();
    }
    nvs_close(handle);
    return value;
}

esp_err_t set(const char *key, const std::string &value)
{
    nvs_handle_t handle = 0;
    esp_err_t result = nvs_open(NAMESPACE, NVS_READWRITE, &handle);
    if (result != ESP_OK) return result;
    result = nvs_set_str(handle, key, value.c_str());
    if (result == ESP_OK) result = nvs_commit(handle);
    nvs_close(handle);
    return result;
}

int get_int(const char *key, int fallback)
{
    nvs_handle_t handle = 0;
    if (nvs_open(NAMESPACE, NVS_READONLY, &handle) != ESP_OK) return fallback;
    int32_t value = fallback;
    nvs_get_i32(handle, key, &value);
    nvs_close(handle);
    return static_cast<int>(value);
}

esp_err_t set_int(const char *key, int value)
{
    nvs_handle_t handle = 0;
    esp_err_t result = nvs_open(NAMESPACE, NVS_READWRITE, &handle);
    if (result != ESP_OK) return result;
    result = nvs_set_i32(handle, key, value);
    if (result == ESP_OK) result = nvs_commit(handle);
    nvs_close(handle);
    return result;
}

}  // namespace bloom::settings
