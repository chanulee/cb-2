#pragma once

#include "esp_err.h"

namespace bloom::system_settings {

struct Config {
    int brightness;
    int rotation;
};

Config normalize(Config config);
Config load();
esp_err_t save(Config config);

}  // namespace bloom::system_settings
