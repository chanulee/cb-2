#pragma once

#include <atomic>
#include <cstdint>
#include <string>

#include "esp_http_client.h"

namespace bloom {

class Turn {
public:
    using Callback = void (*)(const char *prompt, int prompt_index, const char *error, void *context);

    bool start(const std::string &garden, int prompt_index, Callback callback, void *context);
    void finish();
    bool active() const;

private:
    std::atomic<bool> active_{false};
    std::atomic<bool> recording_{false};
    std::string garden_;
    std::string response_;
    std::string prompt_;
    std::string error_;
    int prompt_index_ = 0;
    Callback callback_ = nullptr;
    void *context_ = nullptr;

    static void task_callback(void *context);
    static void ui_callback(void *context);
    static esp_err_t http_callback(esp_http_client_event_t *event);
    void run();
};

}  // namespace bloom
