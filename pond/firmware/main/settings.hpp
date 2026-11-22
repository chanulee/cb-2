#pragma once

#include <string>

#include "esp_err.h"

// Everything Pond remembers across power cycles, in the NVS namespace "bloom".
// The installer can pre-fill ssid/password over USB (garden/flash_pond.py).
namespace bloom::settings {

esp_err_t init();
std::string get(const char *key);
esp_err_t set(const char *key, const std::string &value);
int get_int(const char *key, int fallback);
esp_err_t set_int(const char *key, int value);

}  // namespace bloom::settings
