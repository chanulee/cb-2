// Bloom 2 Pond: press, speak, and read Garden's answer one word at a time.
#include "bsp/esp-bsp.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "garden.hpp"
#include "mic.h"
#include "network.hpp"
#include "ota.hpp"
#include "settings.hpp"
#include "ui.hpp"

namespace {

constexpr char TAG[] = "pond";
constexpr gpio_num_t BOOT_BUTTON = GPIO_NUM_0;
constexpr int64_t CONFIRM_AFTER_US = 60LL * 1000 * 1000;

// Keeps the home screen honest about Wi-Fi and Garden, and installs new firmware.
void link_task(void *)
{
    using bloom::ui::Link;
    bool confirmed = false;
    while (true) {
        Link link = Link::no_wifi;
        bloom::garden::Hello hello;
        if (bloom::network::has_credentials()) {
            link = Link::connecting;
            if (bloom::network::connected()) {
                hello = bloom::garden::hello();
                if (!hello.ok) bloom::garden::forget();     // search again next time
                link = !hello.ok ? Link::searching : hello.ready ? Link::ready : Link::loading;
            }
        }
        // A freshly updated image counts as working once it has joined Wi-Fi (or has
        // simply run for a minute, so an offline router does not cause a rollback).
        if (!confirmed && (bloom::network::connected() || esp_timer_get_time() > CONFIRM_AFTER_US)) {
            bloom::ota::confirm_running_image();
            confirmed = true;
        }
        {
            bloom::ui::Lock lock;
            bloom::ui::set_link(link, hello);
            if (bloom::ui::idle() && bloom::ota::should_auto_install(hello)) bloom::ui::start_update(hello);
        }
        vTaskDelay(pdMS_TO_TICKS(link == Link::ready ? 30000 : 3000));
    }
}

// The BOOT button on the side does the same as the on-screen talk button.
void button_task(void *)
{
    gpio_config_t config = {};
    config.pin_bit_mask = 1ULL << BOOT_BUTTON;
    config.mode = GPIO_MODE_INPUT;
    config.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&config);
    bool was_down = false;
    while (true) {
        const bool down = gpio_get_level(BOOT_BUTTON) == 0;
        if (down && !was_down) {
            bloom::ui::Lock lock;
            bloom::ui::toggle_talk();
        }
        was_down = down;
        vTaskDelay(pdMS_TO_TICKS(30));
    }
}

}  // namespace

extern "C" void app_main(void)
{
    ESP_ERROR_CHECK(bloom::settings::init());
    ESP_ERROR_CHECK(bloom::network::init());

    lv_display_t *display = bsp_display_start();
    if (display == nullptr) {
        ESP_LOGE(TAG, "display did not start");
        return;
    }
    bsp_display_brightness_set(bloom::settings::get_int("brightness", 80));
    if (mic_init() != ESP_OK) ESP_LOGE(TAG, "microphone did not start");

    {
        bloom::ui::Lock lock;
        bloom::ui::build();
    }
    ESP_LOGI(TAG, "%s firmware %s", bloom::network::device_id().c_str(), bloom::ota::running_version().c_str());
    xTaskCreate(link_task, "bloom_link", 6144, nullptr, 3, nullptr);
    xTaskCreate(button_task, "bloom_button", 3072, nullptr, 3, nullptr);
}
