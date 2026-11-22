#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "esp_http_client.h"

namespace bloom {

// One turn: record until finish_recording(), upload the audio to Garden, then pass
// Garden's streamed events on. The callbacks run on the turn task, not the LVGL task.
class Turn {
public:
    struct Listener {
        void (*stage)(const char *stage);       // "transcribing", "thinking"
        void (*delta)(const char *text);        // the next piece of the answer
        void (*finished)(const char *error);    // error is "" when the answer is complete
    };

    static constexpr int max_seconds = 60;

    bool start(const std::string &garden_url, Listener listener);
    void finish_recording();
    bool active() const { return active_.load(); }
    bool recording() const { return recording_.load(); }
    /** Loudness of the last 20 ms, 0..1, for the listening animation. */
    float level() const { return level_.load(); }

private:
    static void task(void *context);
    static esp_err_t on_http(esp_http_client_event_t *event);
    void run();
    size_t record(int16_t *pcm, size_t capacity);
    void upload(const int16_t *pcm, size_t samples);
    void handle_line(const std::string &line);

    std::atomic<bool> active_{false};
    std::atomic<bool> recording_{false};
    std::atomic<float> level_{0.0F};
    std::string url_;
    std::string line_;
    std::string error_;
    bool done_ = false;
    Listener listener_{};
};

}  // namespace bloom
