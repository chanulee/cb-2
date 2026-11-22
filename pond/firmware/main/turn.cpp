#include "turn.hpp"

#include <algorithm>
#include <cstdlib>

#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mic.h"
#include "network.hpp"

namespace bloom {
namespace {
constexpr char TAG[] = "turn";
constexpr size_t frame_samples = MIC_SAMPLE_RATE / 50;     // 20 ms
}  // namespace

bool Turn::start(const std::string &garden_url, Listener listener)
{
    if (garden_url.empty() || active_.exchange(true)) return false;
    url_ = garden_url + "/api/turn";
    listener_ = listener;
    line_.clear();
    error_.clear();
    done_ = false;
    level_.store(0.0F);
    recording_.store(true);
    if (xTaskCreate(task, "bloom_turn", 8192, this, 5, nullptr) != pdPASS) {
        recording_.store(false);
        active_.store(false);
        return false;
    }
    return true;
}

void Turn::finish_recording()
{
    recording_.store(false);
}

void Turn::task(void *context)
{
    static_cast<Turn *>(context)->run();
    vTaskDelete(nullptr);
}

size_t Turn::record(int16_t *pcm, size_t capacity)
{
    if (mic_open() != ESP_OK) {
        error_ = "The microphone did not start.";
        return 0;
    }
    size_t samples = 0;
    while (recording_.load() && samples + frame_samples <= capacity) {
        int16_t *frame = pcm + samples;
        if (mic_read(frame, frame_samples) != ESP_OK) {
            error_ = "The microphone stopped.";
            break;
        }
        int peak = 0;
        for (size_t index = 0; index < frame_samples; ++index) peak = std::max(peak, std::abs(frame[index]));
        level_.store(static_cast<float>(peak) / 32768.0F);
        samples += frame_samples;
    }
    mic_close();
    recording_.store(false);
    level_.store(0.0F);
    return samples;
}

void Turn::handle_line(const std::string &line)
{
    cJSON *json = cJSON_ParseWithLength(line.c_str(), line.size());
    if (json == nullptr) return;
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(json, "type");
    const auto field = [&](const char *key) -> const char * {
        const cJSON *item = cJSON_GetObjectItemCaseSensitive(json, key);
        return cJSON_IsString(item) ? item->valuestring : "";
    };
    if (cJSON_IsString(type)) {
        const std::string kind = type->valuestring;
        if (kind == "delta") listener_.delta(field("text"));
        else if (kind == "stage") listener_.stage(field("stage"));
        else if (kind == "done") done_ = true;
        else if (kind == "error") error_ = field("message");
        // "transcript" and unknown types are ignored: Pond only shows the answer.
    }
    cJSON_Delete(json);
}

esp_err_t Turn::on_http(esp_http_client_event_t *event)
{
    if (event->event_id != HTTP_EVENT_ON_DATA || event->data_len <= 0) return ESP_OK;
    auto *self = static_cast<Turn *>(event->user_data);
    const char *data = static_cast<const char *>(event->data);
    for (int index = 0; index < event->data_len; ++index) {
        if (data[index] != '\n') {
            if (self->line_.size() < 2048) self->line_.push_back(data[index]);
            continue;
        }
        if (!self->line_.empty()) self->handle_line(self->line_);
        self->line_.clear();
    }
    return ESP_OK;
}

void Turn::upload(const int16_t *pcm, size_t samples)
{
    esp_http_client_config_t config = {};
    config.url = url_.c_str();
    config.method = HTTP_METHOD_POST;
    config.timeout_ms = 60000;          // longest silence allowed between two events
    config.event_handler = on_http;
    config.user_data = this;
    auto *client = esp_http_client_init(&config);
    if (client == nullptr) {
        error_ = "Out of memory.";
        return;
    }
    esp_http_client_set_header(client, "Content-Type", "audio/L16;rate=16000;channels=1");
    esp_http_client_set_header(client, "X-Bloom-Device", network::device_id().c_str());
    esp_http_client_set_post_field(
        client, reinterpret_cast<const char *>(pcm), static_cast<int>(samples * sizeof(int16_t))
    );
    const esp_err_t result = esp_http_client_perform(client);
    const int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    if (!error_.empty() || done_) return;
    ESP_LOGW(TAG, "turn failed: %s, HTTP %d", esp_err_to_name(result), status);
    error_ = result != ESP_OK ? "I could not reach Garden." : "Garden stopped before the end.";
}

void Turn::run()
{
    const size_t capacity = static_cast<size_t>(MIC_SAMPLE_RATE) * max_seconds;
    auto *pcm = static_cast<int16_t *>(
        heap_caps_malloc(capacity * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)
    );
    if (pcm == nullptr) {
        error_ = "Out of memory.";
        recording_.store(false);
    } else {
        const size_t samples = record(pcm, capacity);
        if (error_.empty()) {
            listener_.stage("sending");
            upload(pcm, samples);
        }
        heap_caps_free(pcm);
    }
    active_.store(false);
    listener_.finished(error_.c_str());
}

}  // namespace bloom
