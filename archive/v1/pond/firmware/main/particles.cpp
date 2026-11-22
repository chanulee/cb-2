#include "particles.hpp"

#include <algorithm>
#include <cmath>

#include "bsp/esp-bsp.h"
#include "esp_codec_dev.h"

namespace bloom {
namespace {

constexpr float size = 466.0F;

Particles::Particle advance(
    Particles::Particle particle, bool touching, float touch_x, float touch_y, float mic
)
{
    const float dx = particle.x - touch_x;
    const float dy = particle.y - touch_y;
    const float distance2 = std::max(dx * dx + dy * dy, 36.0F);
    const float force = touching && distance2 < 12000.0F ? 38.0F / distance2 : 0.0F;
    particle.vx = (particle.vx + dx * force) * 0.994F;
    particle.vy = (particle.vy + dy * force) * 0.994F;
    const float energy = 1.0F + mic * 2.8F;
    particle.x = std::fmod(particle.x + particle.vx * energy + size, size);
    particle.y = std::fmod(particle.y + particle.vy * energy + size, size);
    return particle;
}

}  // namespace

void Particles::create(lv_obj_t *parent)
{
    for (std::size_t index = 0; index < count; ++index) {
        particles_[index] = {
            std::fmod(static_cast<float>(index * 83), 457.0F),
            std::fmod(static_cast<float>(index * 47), 449.0F),
            std::sin(static_cast<float>(index) * 2.3F) * 0.34F,
            std::cos(static_cast<float>(index) * 1.7F) * 0.34F,
        };
        dots_[index] = lv_obj_create(parent);
        lv_obj_remove_flag(dots_[index], LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_border_width(dots_[index], 0, 0);
        lv_obj_set_style_radius(dots_[index], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(
            dots_[index], lv_color_hsv_to_rgb(166 + (index * 11) % 65, 74, 88), 0
        );
    }
    timer_ = lv_timer_create(timer_callback, 24, this);
    lv_timer_pause(timer_);
}

void Particles::start()
{
    if (timer_ != nullptr) lv_timer_resume(timer_);
    if (capture_.exchange(true)) return;
    xTaskCreate(audio_callback, "particle_mic", 6144, this, 5, nullptr);
}

void Particles::stop()
{
    if (timer_ != nullptr) lv_timer_pause(timer_);
    capture_.store(false);
    for (int wait = 0; audio_task_.load() != nullptr && wait < 60; ++wait) {
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    mic_level_.store(0);
}

void Particles::timer_callback(lv_timer_t *timer)
{
    auto *self = static_cast<Particles *>(lv_timer_get_user_data(timer));
    if (self != nullptr) self->tick();
}

void Particles::tick()
{
    lv_point_t point = {233, 233};
    auto *input = bsp_display_get_input_dev();
    const bool touching = input != nullptr && lv_indev_get_state(input) == LV_INDEV_STATE_PRESSED;
    if (input != nullptr) lv_indev_get_point(input, &point);
    const float mic = static_cast<float>(mic_level_.load()) / 100.0F;
    const int32_t dot_size = 4 + static_cast<int32_t>(mic * 12.0F);

    for (std::size_t index = 0; index < count; ++index) {
        particles_[index] = advance(particles_[index], touching, point.x, point.y, mic);
        lv_obj_set_size(dots_[index], dot_size, dot_size);
        lv_obj_set_pos(
            dots_[index], static_cast<int32_t>(particles_[index].x),
            static_cast<int32_t>(particles_[index].y)
        );
    }
}

void Particles::audio_callback(void *context)
{
    auto *self = static_cast<Particles *>(context);
    self->audio_task_.store(xTaskGetCurrentTaskHandle());
    esp_codec_dev_handle_t mic = nullptr;
    if (bsp_audio_init_voice_24k() == ESP_OK) mic = bsp_audio_codec_microphone_init();

    esp_codec_dev_sample_info_t format = {
        .sample_rate = 24000,
        .channel = 4,
        .channel_mask = BSP_AUDIO_TDM_SLOT_MASK_FL | BSP_AUDIO_TDM_SLOT_MASK_RE |
                        BSP_AUDIO_TDM_SLOT_MASK_FR | BSP_AUDIO_TDM_SLOT_MASK_NA,
        .bits_per_sample = 16,
    };
    if (mic == nullptr || esp_codec_dev_open(mic, &format) != ESP_OK ||
        esp_codec_dev_set_in_channel_gain(mic, BSP_AUDIO_ES7210_MIC_MASK_FL_FR, 30.0F) != ESP_OK) {
        self->capture_.store(false);
    }

    std::array<int16_t, 256 * 4> raw{};
    while (self->capture_.load()) {
        if (esp_codec_dev_read(mic, raw.data(), raw.size() * sizeof(int16_t)) != ESP_OK) break;
        int32_t peak = 0;
        for (std::size_t frame = 0; frame < 256; ++frame) {
            peak = std::max(peak, std::abs(static_cast<int32_t>(raw[frame * 4])));
            peak = std::max(peak, std::abs(static_cast<int32_t>(raw[frame * 4 + 2])));
        }
        self->mic_level_.store(static_cast<uint8_t>(std::min(100, peak / 180)));
    }
    if (mic != nullptr) esp_codec_dev_close(mic);
    bsp_audio_deinit();
    self->audio_task_.store(nullptr);
    vTaskDelete(nullptr);
}

}  // namespace bloom
