#include "turn.hpp"

#include <algorithm>
#include <array>
#include <cstring>

#include "bsp/esp-bsp.h"
#include "cJSON.h"
#include "esp_codec_dev.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"

namespace bloom {
namespace {

constexpr uint32_t sample_rate = 16000;
constexpr std::size_t wav_header_size = 44;
constexpr std::size_t max_pcm_bytes = sample_rate * sizeof(int16_t) * 60;

void write_u16(uint8_t *target, uint16_t value)
{
    target[0] = value & 0xff;
    target[1] = value >> 8;
}

void write_u32(uint8_t *target, uint32_t value)
{
    for (int shift = 0; shift < 4; ++shift) target[shift] = (value >> (shift * 8)) & 0xff;
}

void wav_header(uint8_t *target, uint32_t pcm_bytes)
{
    std::memcpy(target, "RIFF", 4);
    write_u32(target + 4, pcm_bytes + 36);
    std::memcpy(target + 8, "WAVEfmt ", 8);
    write_u32(target + 16, 16);
    write_u16(target + 20, 1);
    write_u16(target + 22, 1);
    write_u32(target + 24, sample_rate);
    write_u32(target + 28, sample_rate * 2);
    write_u16(target + 32, 2);
    write_u16(target + 34, 16);
    std::memcpy(target + 36, "data", 4);
    write_u32(target + 40, pcm_bytes);
}

std::string turn_url(const std::string &garden)
{
    if (garden.rfind("http://", 0) == 0) return garden + "/api/turn";
    if (garden.find(':') != std::string::npos) return "http://" + garden + "/api/turn";
    return "http://" + garden + ":8765/api/turn";
}

}  // namespace

bool Turn::start(const std::string &garden, int prompt_index, Callback callback, void *context)
{
    if (active_.exchange(true) || garden.empty()) return false;
    garden_ = garden;
    prompt_index_ = prompt_index;
    callback_ = callback;
    context_ = context;
    response_.clear();
    prompt_.clear();
    error_.clear();
    recording_.store(true);
    if (xTaskCreate(task_callback, "bloom_turn", 8192, this, 5, nullptr) != pdPASS) {
        recording_.store(false);
        active_.store(false);
        return false;
    }
    return true;
}

void Turn::finish()
{
    recording_.store(false);
}

bool Turn::active() const
{
    return active_.load();
}

void Turn::task_callback(void *context)
{
    static_cast<Turn *>(context)->run();
    vTaskDelete(nullptr);
}

void Turn::ui_callback(void *context)
{
    auto *self = static_cast<Turn *>(context);
    if (self->callback_ != nullptr) {
        self->callback_(self->prompt_.c_str(), self->prompt_index_, self->error_.c_str(), self->context_);
    }
}

esp_err_t Turn::http_callback(esp_http_client_event_t *event)
{
    auto *self = static_cast<Turn *>(event->user_data);
    if (event->event_id == HTTP_EVENT_ON_DATA && event->data != nullptr && event->data_len > 0 &&
        self->response_.size() < 1024) {
        const auto room = 1024 - self->response_.size();
        self->response_.append(static_cast<const char *>(event->data), std::min<std::size_t>(event->data_len, room));
    }
    return ESP_OK;
}

void Turn::run()
{
    auto *wav = static_cast<uint8_t *>(heap_caps_malloc(
        wav_header_size + max_pcm_bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    ));
    esp_codec_dev_handle_t mic = nullptr;
    esp_err_t result = wav == nullptr ? ESP_ERR_NO_MEM : bsp_audio_init_voice_24k();
    if (result == ESP_OK) mic = bsp_audio_codec_microphone_init();

    esp_codec_dev_sample_info_t format = {
        .sample_rate = 24000,
        .channel = 4,
        .channel_mask = BSP_AUDIO_TDM_SLOT_MASK_FL | BSP_AUDIO_TDM_SLOT_MASK_RE |
                        BSP_AUDIO_TDM_SLOT_MASK_FR | BSP_AUDIO_TDM_SLOT_MASK_NA,
        .bits_per_sample = 16,
    };
    if (mic == nullptr && result == ESP_OK) result = ESP_FAIL;
    if (result == ESP_OK) result = esp_codec_dev_open(mic, &format);
    if (result == ESP_OK) {
        result = esp_codec_dev_set_in_channel_gain(mic, BSP_AUDIO_ES7210_MIC_MASK_FL_FR, 30.0F);
    }

    std::array<int16_t, 240 * 4> raw{};
    std::size_t pcm_bytes = 0;
    while (result == ESP_OK && recording_.load()) {
        if (pcm_bytes + 160 * 2 > max_pcm_bytes) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        result = esp_codec_dev_read(mic, raw.data(), raw.size() * sizeof(int16_t));
        auto *pcm = reinterpret_cast<int16_t *>(wav + wav_header_size + pcm_bytes);
        for (std::size_t group = 0; group < 80; ++group) {
            const auto mono = [&](std::size_t frame) {
                return (static_cast<int32_t>(raw[frame * 4]) + raw[frame * 4 + 2]) / 2;
            };
            pcm[group * 2] = static_cast<int16_t>(mono(group * 3));
            pcm[group * 2 + 1] = static_cast<int16_t>((mono(group * 3 + 1) + mono(group * 3 + 2)) / 2);
        }
        pcm_bytes += 160 * sizeof(int16_t);
    }
    if (mic != nullptr) esp_codec_dev_close(mic);
    bsp_audio_deinit();

    if (result == ESP_OK && pcm_bytes > 0) {
        wav_header(wav, pcm_bytes);
        const std::string url = turn_url(garden_);
        esp_http_client_config_t config = {};
        config.url = url.c_str();
        config.method = HTTP_METHOD_POST;
        config.timeout_ms = 120000;
        config.event_handler = http_callback;
        config.user_data = this;
        auto *client = esp_http_client_init(&config);
        if (client == nullptr) {
            result = ESP_FAIL;
        } else {
            const std::string index = std::to_string(prompt_index_);
            esp_http_client_set_header(client, "Content-Type", "audio/wav");
            esp_http_client_set_header(client, "X-Prompt-Index", index.c_str());
            esp_http_client_set_post_field(
                client, reinterpret_cast<const char *>(wav), wav_header_size + pcm_bytes
            );
            result = esp_http_client_perform(client);
            if (result == ESP_OK && esp_http_client_get_status_code(client) != 200) result = ESP_FAIL;
            esp_http_client_cleanup(client);
        }
    }

    heap_caps_free(wav);
    if (result == ESP_OK) {
        auto *json = cJSON_ParseWithLength(response_.c_str(), response_.size());
        auto *prompt = json == nullptr ? nullptr : cJSON_GetObjectItemCaseSensitive(json, "prompt");
        auto *index = json == nullptr ? nullptr : cJSON_GetObjectItemCaseSensitive(json, "prompt_index");
        if (!cJSON_IsString(prompt) || !cJSON_IsNumber(index)) {
            error_ = "Garden response was invalid";
        } else {
            prompt_ = prompt->valuestring;
            prompt_index_ = index->valueint;
        }
        cJSON_Delete(json);
    } else {
        error_ = "Could not complete the Garden turn";
    }
    recording_.store(false);
    active_.store(false);
    lv_async_call(ui_callback, this);
}

}  // namespace bloom
