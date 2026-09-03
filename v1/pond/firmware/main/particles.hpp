#pragma once

#include <array>
#include <atomic>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"

namespace bloom {

class Particles {
public:
    struct Particle {
        float x;
        float y;
        float vx;
        float vy;
    };

    void create(lv_obj_t *parent);
    void start();
    void stop();

private:
    static constexpr std::size_t count = 48;
    std::array<Particle, count> particles_{};
    std::array<lv_obj_t *, count> dots_{};
    lv_timer_t *timer_ = nullptr;
    std::atomic<bool> capture_{false};
    std::atomic<TaskHandle_t> audio_task_{nullptr};
    std::atomic<uint8_t> mic_level_{0};

    static void timer_callback(lv_timer_t *timer);
    static void audio_callback(void *context);
    void tick();
};

}  // namespace bloom
