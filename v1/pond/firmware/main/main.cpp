#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#include <vector>

#include "bsp/esp-bsp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"

#include "network.hpp"
#include "particles.hpp"
#include "system_settings.hpp"
#include "turn.hpp"
#include "wordstream.hpp"

namespace {
constexpr char OPENING_PROMPT[] =
    "Let's look back on my day to understand myself better.";
constexpr uint32_t BACKGROUND = 0x050707;
constexpr uint32_t PANEL = 0x202927;
constexpr uint32_t BORDER = 0x3B4B48;
constexpr uint32_t ACCENT = 0x9DE7ED;
constexpr uint32_t MUTED = 0x78908B;

enum class BackTarget : uintptr_t { launcher, settings, networks };

lv_display_t *display = nullptr;
lv_obj_t *launcher = nullptr;
lv_obj_t *pond = nullptr;
lv_obj_t *particles_screen = nullptr;
lv_obj_t *settings = nullptr;
lv_obj_t *network_screen = nullptr;
lv_obj_t *network_list = nullptr;
lv_obj_t *network_edit = nullptr;
lv_obj_t *keyboard = nullptr;
lv_obj_t *ssid_field = nullptr;
lv_obj_t *password_field = nullptr;
lv_obj_t *garden_field = nullptr;
lv_obj_t *network_error = nullptr;
lv_obj_t *network_hint = nullptr;
lv_obj_t *record_button = nullptr;
lv_obj_t *brightness_value = nullptr;
std::array<lv_obj_t *, 4> rotation_buttons{};
std::vector<bloom::network::AccessPoint> visible_access_points;
bloom::system_settings::Config device_settings{80, 0};
bloom::Wordstream wordstream;
bloom::Particles particles;
bloom::Turn turn;
int prompt_index = 0;

void open_launcher(lv_event_t *event);
void open_settings(lv_event_t *event);
void open_networks(lv_event_t *event);

lv_obj_t *make_screen()
{
    auto *screen = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(screen, lv_color_hex(BACKGROUND), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(screen, 0, 0);
    lv_obj_set_style_pad_all(screen, 0, 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    return screen;
}

lv_obj_t *button(lv_obj_t *parent, const char *text, lv_event_cb_t callback, void *user_data = nullptr)
{
    auto *object = lv_button_create(parent);
    lv_obj_set_size(object, 142, 132);
    lv_obj_set_style_bg_color(object, lv_color_hex(PANEL), 0);
    lv_obj_set_style_border_color(object, lv_color_hex(BORDER), 0);
    lv_obj_set_style_border_width(object, 1, 0);
    lv_obj_set_style_radius(object, 30, 0);
    lv_obj_add_flag(object, LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_add_event_cb(object, callback, LV_EVENT_CLICKED, user_data);
    auto *label = lv_label_create(object);
    lv_label_set_text(label, text);
    lv_obj_center(label);
    return object;
}

void set_record_text(const char *text)
{
    if (record_button != nullptr) lv_label_set_text(lv_obj_get_child(record_button, 0), text);
}

void go_to(BackTarget target)
{
    if (turn.active()) return;
    particles.stop();
    wordstream.stop();
    if (target == BackTarget::settings) lv_screen_load(settings);
    else if (target == BackTarget::networks) lv_screen_load(network_screen);
    else lv_screen_load(launcher);
}

void back_gesture(lv_event_t *event)
{
    auto *input = lv_indev_active();
    if (input == nullptr || lv_indev_get_gesture_dir(input) != LV_DIR_RIGHT) return;
    lv_indev_wait_release(input);
    const auto target = static_cast<BackTarget>(
        reinterpret_cast<uintptr_t>(lv_event_get_user_data(event))
    );
    go_to(target);
}

void add_back_gesture(lv_obj_t *screen, BackTarget target)
{
    lv_obj_add_event_cb(
        screen, back_gesture, LV_EVENT_GESTURE,
        reinterpret_cast<void *>(static_cast<uintptr_t>(target))
    );
}

void open_launcher(lv_event_t *)
{
    go_to(BackTarget::launcher);
}

void turn_result(const char *prompt, int next_index, const char *error, void *)
{
    set_record_text("Start speaking");
    if (error != nullptr && error[0] != '\0') {
        wordstream.set_hint(error);
        return;
    }
    prompt_index = next_index;
    if (lv_screen_active() == pond) wordstream.play(prompt, 270);
}

void record_clicked(lv_event_t *)
{
    if (turn.active()) {
        turn.finish();
        set_record_text("Sending...");
        wordstream.set_hint("thinking");
        return;
    }
    const auto config = bloom::network::load();
    if (!bloom::network::connected()) {
        wordstream.set_hint("connect Wi-Fi in Settings");
        return;
    }
    if (!turn.start(config.garden, prompt_index, turn_result, nullptr)) {
        wordstream.set_hint("Garden address is missing");
        return;
    }
    set_record_text("I'm done");
    wordstream.set_hint("listening");
}

void open_particles(lv_event_t *)
{
    lv_screen_load(particles_screen);
    particles.start();
}

void open_pond(lv_event_t *)
{
    lv_screen_load(pond);
    wordstream.play(OPENING_PROMPT, 270);
}

void open_settings(lv_event_t *)
{
    lv_screen_load(settings);
}

void brightness_changed(lv_event_t *event)
{
    const int value = lv_slider_get_value(static_cast<lv_obj_t *>(lv_event_get_target(event)));
    bsp_display_brightness_set(value);
    device_settings.brightness = value;
    lv_label_set_text_fmt(brightness_value, "%d%%", value);
}

void brightness_released(lv_event_t *)
{
    bloom::system_settings::save(device_settings);
}

void render_rotation_selection()
{
    for (std::size_t index = 0; index < rotation_buttons.size(); ++index) {
        const bool selected = static_cast<int>(index) == device_settings.rotation;
        lv_obj_set_style_bg_color(
            rotation_buttons[index], lv_color_hex(selected ? ACCENT : 0x18201F), 0
        );
        lv_obj_set_style_text_color(
            rotation_buttons[index], lv_color_hex(selected ? BACKGROUND : 0xF2EEE6), 0
        );
    }
}

void rotation_clicked(lv_event_t *event)
{
    const auto rotation = static_cast<int>(reinterpret_cast<uintptr_t>(lv_event_get_user_data(event)));
    device_settings.rotation = rotation;
    lv_display_set_rotation(display, static_cast<lv_display_rotation_t>(rotation));
    bloom::system_settings::save(device_settings);
    render_rotation_selection();
}

void keyboard_target(lv_event_t *event)
{
    lv_keyboard_set_textarea(keyboard, static_cast<lv_obj_t *>(lv_event_get_target(event)));
}

void save_network(lv_event_t *)
{
    bloom::network::Config config{
        lv_textarea_get_text(ssid_field),
        lv_textarea_get_text(password_field),
        lv_textarea_get_text(garden_field),
    };
    const esp_err_t result = bloom::network::save_and_connect(config);
    if (result == ESP_OK) {
        lv_label_set_text(network_error, "");
        lv_label_set_text(network_hint, config.ssid.c_str());
        lv_screen_load(settings);
    } else {
        lv_label_set_text(network_error, "Check password and Garden address");
    }
}

void select_access_point(lv_event_t *event)
{
    const auto *access_point = static_cast<const bloom::network::AccessPoint *>(
        lv_event_get_user_data(event)
    );
    if (access_point == nullptr) return;
    const auto saved = bloom::network::load();
    lv_textarea_set_text(ssid_field, access_point->ssid.c_str());
    lv_textarea_set_text(password_field, access_point->ssid == saved.ssid ? saved.password.c_str() : "");
    lv_textarea_set_text(garden_field, saved.garden.c_str());
    lv_label_set_text(network_error, "");
    lv_keyboard_set_textarea(keyboard, password_field);
    lv_screen_load(network_edit);
}

void render_access_points(void *)
{
    lv_obj_clean(network_list);
    visible_access_points = bloom::network::scan_results();
    if (visible_access_points.empty()) {
        auto *empty = lv_label_create(network_list);
        lv_label_set_text(empty, "No 2.4 GHz networks found");
        lv_obj_set_style_text_color(empty, lv_color_hex(MUTED), 0);
        return;
    }

    for (auto &access_point : visible_access_points) {
        auto *row = lv_button_create(network_list);
        lv_obj_set_size(row, lv_pct(100), 56);
        lv_obj_set_style_bg_color(row, lv_color_hex(PANEL), 0);
        lv_obj_set_style_border_color(row, lv_color_hex(BORDER), 0);
        lv_obj_set_style_border_width(row, 1, 0);
        lv_obj_set_style_radius(row, 18, 0);
        lv_obj_add_flag(row, LV_OBJ_FLAG_GESTURE_BUBBLE);
        lv_obj_add_event_cb(row, select_access_point, LV_EVENT_CLICKED, &access_point);

        auto *ssid = lv_label_create(row);
        lv_label_set_long_mode(ssid, LV_LABEL_LONG_DOT);
        lv_obj_set_width(ssid, 218);
        lv_label_set_text(ssid, access_point.ssid.c_str());
        lv_obj_align(ssid, LV_ALIGN_LEFT_MID, 2, 0);
        auto *detail = lv_label_create(row);
        lv_label_set_text_fmt(detail, "%s%d", access_point.secure ? "lock  " : "", access_point.rssi);
        lv_obj_set_style_text_color(detail, lv_color_hex(MUTED), 0);
        lv_obj_align(detail, LV_ALIGN_RIGHT_MID, -2, 0);
    }
}

void scan_finished(void *)
{
    if (bsp_display_lock(50) != ESP_OK) return;
    lv_async_call(render_access_points, nullptr);
    bsp_display_unlock();
}

void start_scan()
{
    lv_obj_clean(network_list);
    auto *scanning = lv_label_create(network_list);
    lv_label_set_text(scanning, "Scanning nearby networks...");
    lv_obj_set_style_text_color(scanning, lv_color_hex(MUTED), 0);
    if (bloom::network::request_scan(scan_finished, nullptr) != ESP_OK) {
        lv_label_set_text(scanning, "Wi-Fi scan is busy");
    }
}

void rescan_clicked(lv_event_t *)
{
    start_scan();
}

void open_networks(lv_event_t *)
{
    lv_screen_load(network_screen);
    start_scan();
}

void build_launcher()
{
    launcher = make_screen();
    auto *pond_button = button(launcher, "Pond", open_pond);
    lv_obj_align(pond_button, LV_ALIGN_CENTER, -75, -58);
    auto *particles_button = button(launcher, "Particles", open_particles);
    lv_obj_align(particles_button, LV_ALIGN_CENTER, 75, -58);
    auto *settings_button = button(launcher, "Settings", open_settings);
    lv_obj_align(settings_button, LV_ALIGN_CENTER, 0, 87);
}

void build_pond()
{
    pond = make_screen();
    add_back_gesture(pond, BackTarget::launcher);
    wordstream.create(pond);
    record_button = button(pond, "Start speaking", record_clicked);
    lv_obj_set_size(record_button, 180, 48);
    lv_obj_set_style_radius(record_button, LV_RADIUS_CIRCLE, 0);
    lv_obj_align(record_button, LV_ALIGN_BOTTOM_MID, 0, -24);
}

void build_particles()
{
    particles_screen = make_screen();
    add_back_gesture(particles_screen, BackTarget::launcher);
    particles.create(particles_screen);
}

void build_settings()
{
    settings = make_screen();
    add_back_gesture(settings, BackTarget::launcher);

    auto *brightness_label = lv_label_create(settings);
    lv_label_set_text(brightness_label, "Brightness");
    lv_obj_align(brightness_label, LV_ALIGN_TOP_LEFT, 78, 64);
    brightness_value = lv_label_create(settings);
    lv_obj_set_style_text_color(brightness_value, lv_color_hex(ACCENT), 0);
    lv_obj_align(brightness_value, LV_ALIGN_TOP_RIGHT, -78, 64);

    auto *brightness = lv_slider_create(settings);
    lv_obj_set_size(brightness, 310, 14);
    lv_slider_set_range(brightness, 20, 100);
    const int current_brightness = bsp_display_brightness_get();
    device_settings.brightness = current_brightness < 20 ? 20 : current_brightness;
    lv_slider_set_value(brightness, device_settings.brightness, LV_ANIM_OFF);
    lv_label_set_text_fmt(brightness_value, "%d%%", device_settings.brightness);
    lv_obj_align(brightness, LV_ALIGN_TOP_MID, 0, 103);
    lv_obj_add_flag(brightness, LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_add_event_cb(brightness, brightness_changed, LV_EVENT_VALUE_CHANGED, nullptr);
    lv_obj_add_event_cb(brightness, brightness_released, LV_EVENT_RELEASED, nullptr);

    auto *network_button = button(settings, "Wi-Fi", open_networks);
    lv_obj_set_size(network_button, 350, 76);
    lv_obj_set_style_radius(network_button, 24, 0);
    lv_obj_align(network_button, LV_ALIGN_CENTER, 0, -4);
    network_hint = lv_label_create(network_button);
    const auto saved_network = bloom::network::load();
    lv_label_set_text(network_hint, saved_network.ssid.empty() ? "Choose a network" : saved_network.ssid.c_str());
    lv_obj_set_style_text_color(network_hint, lv_color_hex(MUTED), 0);
    lv_obj_align(network_hint, LV_ALIGN_BOTTOM_LEFT, 3, -5);
    lv_obj_align(lv_obj_get_child(network_button, 0), LV_ALIGN_TOP_LEFT, 3, 5);

    auto *rotation_label = lv_label_create(settings);
    lv_label_set_text(rotation_label, "Rotation");
    lv_obj_align(rotation_label, LV_ALIGN_CENTER, -124, 89);
    constexpr const char *labels[] = {"0", "90", "180", "270"};
    for (std::size_t index = 0; index < rotation_buttons.size(); ++index) {
        rotation_buttons[index] = button(
            settings, labels[index], rotation_clicked,
            reinterpret_cast<void *>(static_cast<uintptr_t>(index))
        );
        lv_obj_set_size(rotation_buttons[index], 76, 52);
        lv_obj_set_style_radius(rotation_buttons[index], index == 0 || index == 3 ? 16 : 0, 0);
        lv_obj_align(rotation_buttons[index], LV_ALIGN_CENTER, -114 + static_cast<int>(index) * 76, 139);
    }
    render_rotation_selection();
}

void build_network_scan()
{
    network_screen = make_screen();
    add_back_gesture(network_screen, BackTarget::settings);
    auto *title = lv_label_create(network_screen);
    lv_label_set_text(title, "Wi-Fi");
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 78, 62);
    auto *rescan = button(network_screen, "Scan", rescan_clicked);
    lv_obj_set_size(rescan, 70, 42);
    lv_obj_set_style_radius(rescan, LV_RADIUS_CIRCLE, 0);
    lv_obj_align(rescan, LV_ALIGN_TOP_RIGHT, -70, 50);

    network_list = lv_obj_create(network_screen);
    lv_obj_set_size(network_list, 344, 294);
    lv_obj_align(network_list, LV_ALIGN_CENTER, 0, 30);
    lv_obj_set_style_bg_opa(network_list, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(network_list, 0, 0);
    lv_obj_set_style_pad_all(network_list, 4, 0);
    lv_obj_set_style_pad_row(network_list, 7, 0);
    lv_obj_set_flex_flow(network_list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(network_list, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_add_flag(network_list, LV_OBJ_FLAG_GESTURE_BUBBLE);
}

lv_obj_t *credential_field(lv_obj_t *parent, const char *placeholder, int y)
{
    auto *field = lv_textarea_create(parent);
    lv_textarea_set_one_line(field, true);
    lv_textarea_set_placeholder_text(field, placeholder);
    lv_obj_set_size(field, 270, 37);
    lv_obj_align(field, LV_ALIGN_TOP_MID, 0, y);
    lv_obj_add_flag(field, LV_OBJ_FLAG_GESTURE_BUBBLE);
    return field;
}

void build_network_edit()
{
    network_edit = make_screen();
    add_back_gesture(network_edit, BackTarget::networks);
    ssid_field = credential_field(network_edit, "Network", 42);
    lv_obj_set_width(ssid_field, 248);
    lv_obj_remove_flag(ssid_field, LV_OBJ_FLAG_CLICKABLE);
    password_field = credential_field(network_edit, "Password", 84);
    lv_textarea_set_password_mode(password_field, true);
    lv_obj_add_event_cb(password_field, keyboard_target, LV_EVENT_FOCUSED, nullptr);
    garden_field = credential_field(network_edit, "Garden hostname (bloom.local)", 126);
    lv_obj_add_event_cb(garden_field, keyboard_target, LV_EVENT_FOCUSED, nullptr);

    keyboard = lv_keyboard_create(network_edit);
    lv_keyboard_set_mode(keyboard, LV_KEYBOARD_MODE_TEXT_LOWER);
    lv_obj_set_size(keyboard, 356, 168);
    lv_obj_align(keyboard, LV_ALIGN_CENTER, 0, 55);
    lv_obj_add_flag(keyboard, LV_OBJ_FLAG_GESTURE_BUBBLE);

    auto *save = button(network_edit, "Connect", save_network);
    lv_obj_set_size(save, 180, 42);
    lv_obj_set_style_radius(save, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(save, lv_color_hex(ACCENT), 0);
    lv_obj_set_style_text_color(save, lv_color_hex(BACKGROUND), 0);
    lv_obj_align(save, LV_ALIGN_BOTTOM_MID, 0, -30);
    network_error = lv_label_create(network_edit);
    lv_obj_set_width(network_error, 300);
    lv_obj_set_style_text_align(network_error, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(network_error, lv_color_hex(0xFF9B8D), 0);
    lv_obj_align(network_error, LV_ALIGN_BOTTOM_MID, 0, -9);
}

}  // namespace

extern "C" void app_main(void)
{
    ESP_ERROR_CHECK(bloom::network::init());
    device_settings = bloom::system_settings::load();
    display = bsp_display_start();
    assert(display != nullptr);
    ESP_ERROR_CHECK(bsp_display_backlight_on());
    ESP_ERROR_CHECK(bsp_display_brightness_set(device_settings.brightness));

    bsp_display_lock(0);
    lv_display_set_rotation(display, static_cast<lv_display_rotation_t>(device_settings.rotation));
    build_launcher();
    build_pond();
    build_particles();
    build_settings();
    build_network_scan();
    build_network_edit();
    lv_screen_load(launcher);
    bsp_display_unlock();

    while (true) vTaskDelay(pdMS_TO_TICKS(1000));
}
