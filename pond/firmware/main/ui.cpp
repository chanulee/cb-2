#include "ui.hpp"

#include <cstdint>
#include <string>
#include <vector>

#include "bsp/esp-bsp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"

#include "network.hpp"
#include "ota.hpp"
#include "settings.hpp"
#include "turn.hpp"
#include "wordstream.hpp"

namespace bloom::ui {
namespace {

constexpr uint32_t BACKGROUND = 0x050707;
constexpr uint32_t PANEL = 0x202927;
constexpr uint32_t BORDER = 0x3B4B48;
constexpr uint32_t ACCENT = 0x9DE7ED;
constexpr uint32_t MUTED = 0x78908B;
constexpr uint32_t INK = 0xF4F0E7;
constexpr uint32_t ALERT = 0xFF9B8D;

enum class Phase { idle, listening, thinking, reading };
enum class Back : uintptr_t { home, settings, networks };

// ---- state (guarded by the display lock) -------------------------------------
Phase phase = Phase::idle;
Link link = Link::connecting;
garden::Hello last_hello;
std::string notice;             // one-off message shown instead of the idle hint
bool greeted = false;           // the opening line has been shown
bool muted = false;             // the reader stopped the answer; drop the rest of it
bool updating = false;
garden::Hello update_target;
Turn turn;
Wordstream wordstream;
std::vector<network::AccessPoint> access_points;

lv_obj_t *home = nullptr;
lv_obj_t *hint = nullptr;
lv_obj_t *pulse = nullptr;
lv_obj_t *talk = nullptr;
lv_obj_t *settings_screen = nullptr;
lv_obj_t *brightness_value = nullptr;
lv_obj_t *wifi_name = nullptr;
lv_obj_t *info = nullptr;
lv_obj_t *update_button = nullptr;
lv_obj_t *network_screen = nullptr;
lv_obj_t *network_list = nullptr;
lv_obj_t *edit_screen = nullptr;
lv_obj_t *keyboard = nullptr;
lv_obj_t *ssid_field = nullptr;
lv_obj_t *password_field = nullptr;
lv_obj_t *garden_field = nullptr;
lv_obj_t *edit_error = nullptr;
lv_obj_t *update_screen = nullptr;
lv_obj_t *update_label = nullptr;
lv_obj_t *update_bar = nullptr;

// ---- small builders ------------------------------------------------------------
lv_obj_t *make_screen()
{
    auto *screen = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(screen, lv_color_hex(BACKGROUND), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(screen, 0, 0);
    lv_obj_set_style_pad_all(screen, 0, 0);
    lv_obj_set_style_text_color(screen, lv_color_hex(INK), 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    return screen;
}

lv_obj_t *make_button(lv_obj_t *parent, const char *text, lv_event_cb_t callback, int32_t width, int32_t height)
{
    auto *object = lv_button_create(parent);
    lv_obj_set_size(object, width, height);
    lv_obj_set_style_bg_color(object, lv_color_hex(PANEL), 0);
    lv_obj_set_style_border_color(object, lv_color_hex(BORDER), 0);
    lv_obj_set_style_border_width(object, 1, 0);
    lv_obj_set_style_radius(object, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_shadow_width(object, 0, 0);
    lv_obj_add_flag(object, LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_add_event_cb(object, callback, LV_EVENT_CLICKED, nullptr);
    auto *label = lv_label_create(object);
    lv_label_set_text(label, text);
    lv_obj_center(label);
    return object;
}

lv_obj_t *make_text(lv_obj_t *parent, const char *text, uint32_t color, int32_t width)
{
    auto *label = lv_label_create(parent);
    lv_obj_set_width(label, width);
    lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    lv_label_set_text(label, text);
    return label;
}

void set_button_text(lv_obj_t *object, const char *text)
{
    lv_label_set_text(lv_obj_get_child(object, 0), text);
}

// ---- home ------------------------------------------------------------------------
const char *link_message()
{
    switch (link) {
    case Link::no_wifi: return "Open Settings to join Wi-Fi";
    case Link::connecting: return "Joining Wi-Fi...";
    case Link::searching: return "Looking for Garden...";
    case Link::loading: return "Garden is loading its models";
    case Link::ready: return "Press to speak";
    }
    return "";
}

void render_home()
{
    const char *button_text = "Speak";
    const char *hint_text = notice.empty() ? link_message() : notice.c_str();
    uint32_t hint_color = notice.empty() ? MUTED : ALERT;
    if (phase == Phase::listening) {
        button_text = "Done";
        hint_text = "listening";
        hint_color = ACCENT;
    } else if (phase == Phase::thinking) {
        button_text = "...";
        hint_text = "thinking";
        hint_color = MUTED;
    } else if (phase == Phase::reading) {
        button_text = "Stop";
        hint_text = "";
    }
    set_button_text(talk, button_text);
    lv_label_set_text(hint, hint_text);
    lv_obj_set_style_text_color(hint, lv_color_hex(hint_color), 0);
    if (phase != Phase::listening) lv_obj_add_flag(pulse, LV_OBJ_FLAG_HIDDEN);
}

void greet()
{
    if (greeted || phase != Phase::idle || !last_hello.ok || last_hello.opening.empty() ||
        lv_screen_active() != home) return;
    greeted = true;
    phase = Phase::reading;
    wordstream.say(last_hello.opening.c_str(), last_hello.wpm);
    render_home();
}

void on_stream_finished()           // LVGL task, lock held
{
    phase = Phase::idle;
    notice.clear();
    render_home();
    if (link == Link::ready) lv_label_set_text(hint, "Take the time I need, then press to speak");
}

// Turn callbacks: they run on the turn task and take the lock themselves.
void on_turn_stage(const char *)
{
    Lock lock;
    if (phase == Phase::listening) phase = Phase::thinking;     // also reached when 60 s ran out
    render_home();
}

void on_turn_delta(const char *text)
{
    Lock lock;
    if (muted) return;
    if (phase != Phase::reading) {
        phase = Phase::reading;
        wordstream.begin(last_hello.wpm);
        render_home();
    }
    wordstream.append(text);
}

void on_turn_finished(const char *error)
{
    Lock lock;
    if (error[0] != '\0') {
        wordstream.stop();
        phase = Phase::idle;
        notice = error;
    } else if (phase == Phase::reading && wordstream.active()) {
        wordstream.end();           // on_stream_finished() returns to idle after the last word
    } else {
        phase = Phase::idle;
    }
    muted = false;
    render_home();
}

void on_pulse_timer(lv_timer_t *)
{
    if (phase != Phase::listening) return;
    const auto size = static_cast<int32_t>(150.0F + turn.level() * 260.0F);
    lv_obj_set_size(pulse, size, size);
    lv_obj_center(pulse);
    lv_obj_remove_flag(pulse, LV_OBJ_FLAG_HIDDEN);
}

void on_talk_clicked(lv_event_t *)
{
    toggle_talk();
}

// ---- navigation ------------------------------------------------------------------
void refresh_settings();
void start_scan();

void go(Back target)
{
    if (phase != Phase::idle || updating) return;
    if (target == Back::settings) {
        refresh_settings();
        lv_screen_load(settings_screen);
    } else if (target == Back::networks) {
        lv_screen_load(network_screen);
    } else {
        lv_screen_load(home);
        render_home();
        greet();
    }
}

void on_back_gesture(lv_event_t *event)
{
    auto *input = lv_indev_active();
    if (input == nullptr || lv_indev_get_gesture_dir(input) != LV_DIR_RIGHT) return;
    lv_indev_wait_release(input);
    go(static_cast<Back>(reinterpret_cast<uintptr_t>(lv_event_get_user_data(event))));
}

void swipe_right_goes_to(lv_obj_t *screen, Back target)
{
    lv_obj_add_event_cb(screen, on_back_gesture, LV_EVENT_GESTURE,
                        reinterpret_cast<void *>(static_cast<uintptr_t>(target)));
}

void on_open_settings(lv_event_t *)
{
    go(Back::settings);
}

// ---- settings --------------------------------------------------------------------
void refresh_settings()
{
    const std::string ssid = settings::get("ssid");
    lv_label_set_text(wifi_name, ssid.empty() ? "Choose a network" : ssid.c_str());
    const std::string garden = last_hello.ok ? garden::base_url().substr(7) : std::string("not found");
    lv_label_set_text_fmt(
        info, "%s  firmware %s\nIP %s\nGarden %s%s",
        network::device_id().c_str(), ota::running_version().c_str(),
        network::connected() ? network::ip().c_str() : "-", garden.c_str(),
        garden::manual() ? " (typed)" : ""
    );
    if (ota::available(last_hello)) {
        lv_label_set_text_fmt(lv_obj_get_child(update_button, 0), "Update to %s",
                              last_hello.firmware_version.c_str());
    } else {
        set_button_text(update_button, last_hello.ok ? "Firmware is current" : "No Garden, no update");
    }
}

void on_brightness_changed(lv_event_t *event)
{
    const int value = lv_slider_get_value(static_cast<lv_obj_t *>(lv_event_get_target(event)));
    bsp_display_brightness_set(value);
    lv_label_set_text_fmt(brightness_value, "%d%%", value);
}

void on_brightness_released(lv_event_t *event)
{
    settings::set_int("brightness", lv_slider_get_value(static_cast<lv_obj_t *>(lv_event_get_target(event))));
}

void on_update_clicked(lv_event_t *)
{
    if (ota::available(last_hello)) start_update(last_hello);
}

void on_open_networks(lv_event_t *)
{
    lv_screen_load(network_screen);
    start_scan();
}

// ---- Wi-Fi -----------------------------------------------------------------------
void on_network_chosen(lv_event_t *event)
{
    const auto index = reinterpret_cast<uintptr_t>(lv_event_get_user_data(event));
    if (index >= access_points.size()) return;
    const std::string &ssid = access_points[index].ssid;
    lv_textarea_set_text(ssid_field, ssid.c_str());
    lv_textarea_set_text(password_field, ssid == settings::get("ssid") ? settings::get("password").c_str() : "");
    lv_textarea_set_text(garden_field, settings::get("garden").c_str());
    lv_label_set_text(edit_error, "");
    lv_keyboard_set_textarea(keyboard, password_field);
    lv_screen_load(edit_screen);
}

void render_networks(void *)
{
    lv_obj_clean(network_list);
    access_points = network::scan_results();
    if (access_points.empty()) {
        make_text(network_list, "No 2.4 GHz network found.\nSwipe right, then try again.", MUTED, 300);
        return;
    }
    for (size_t index = 0; index < access_points.size(); ++index) {
        auto *row = lv_button_create(network_list);
        lv_obj_set_size(row, lv_pct(100), 56);
        lv_obj_set_style_bg_color(row, lv_color_hex(PANEL), 0);
        lv_obj_set_style_border_color(row, lv_color_hex(BORDER), 0);
        lv_obj_set_style_border_width(row, 1, 0);
        lv_obj_set_style_radius(row, 18, 0);
        lv_obj_set_style_shadow_width(row, 0, 0);
        lv_obj_add_flag(row, LV_OBJ_FLAG_GESTURE_BUBBLE);
        lv_obj_add_event_cb(row, on_network_chosen, LV_EVENT_CLICKED, reinterpret_cast<void *>(index));
        auto *name = lv_label_create(row);
        lv_label_set_long_mode(name, LV_LABEL_LONG_DOT);
        lv_obj_set_width(name, 230);
        lv_label_set_text(name, access_points[index].ssid.c_str());
        lv_obj_align(name, LV_ALIGN_LEFT_MID, 2, 0);
        auto *detail = lv_label_create(row);
        lv_label_set_text_fmt(detail, "%s%d", access_points[index].secure ? LV_SYMBOL_EYE_CLOSE " " : "",
                              access_points[index].rssi);
        lv_obj_set_style_text_color(detail, lv_color_hex(MUTED), 0);
        lv_obj_align(detail, LV_ALIGN_RIGHT_MID, -2, 0);
    }
}

void on_scan_finished(void *)      // Wi-Fi event task
{
    Lock lock;
    lv_async_call(render_networks, nullptr);
}

void start_scan()
{
    lv_obj_clean(network_list);
    auto *status = make_text(network_list, "Scanning for networks...", MUTED, 300);
    if (network::request_scan(on_scan_finished, nullptr) != ESP_OK) {
        lv_label_set_text(status, "Wi-Fi is busy. Swipe right, then try again.");
    }
}

void on_field_focused(lv_event_t *event)
{
    lv_keyboard_set_textarea(keyboard, static_cast<lv_obj_t *>(lv_event_get_target(event)));
}

void on_save_network(lv_event_t *)
{
    settings::set("garden", lv_textarea_get_text(garden_field));
    garden::forget();
    if (network::connect(lv_textarea_get_text(ssid_field), lv_textarea_get_text(password_field)) != ESP_OK) {
        lv_label_set_text(edit_error, "That password is too long");
        return;
    }
    link = Link::connecting;
    notice.clear();
    go(Back::home);
}

// ---- firmware update -------------------------------------------------------------
void on_update_progress(int percent)   // update task
{
    Lock lock;
    lv_bar_set_value(update_bar, percent, LV_ANIM_OFF);
}

void update_task(void *)
{
    const esp_err_t result = ota::install(update_target, on_update_progress);   // restarts on success
    {
        Lock lock;
        updating = false;
        notice = std::string("Update failed: ") + esp_err_to_name(result);
        lv_screen_load(home);
        render_home();
    }
    vTaskDelete(nullptr);
}

// ---- screens ---------------------------------------------------------------------
void build_home()
{
    home = make_screen();
    pulse = lv_obj_create(home);
    lv_obj_remove_style_all(pulse);
    lv_obj_set_style_radius(pulse, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(pulse, lv_color_hex(ACCENT), 0);
    lv_obj_set_style_bg_opa(pulse, LV_OPA_20, 0);
    lv_obj_remove_flag(pulse, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(pulse, LV_OBJ_FLAG_HIDDEN);

    wordstream.create(home, on_stream_finished);

    auto *gear = make_button(home, LV_SYMBOL_SETTINGS, on_open_settings, 64, 48);
    lv_obj_set_style_bg_opa(gear, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(gear, 0, 0);
    lv_obj_set_style_text_color(gear, lv_color_hex(MUTED), 0);
    lv_obj_align(gear, LV_ALIGN_TOP_MID, 0, 14);

    hint = make_text(home, "", MUTED, 300);
    lv_obj_align(hint, LV_ALIGN_CENTER, 0, 96);

    talk = make_button(home, "Speak", on_talk_clicked, 170, 56);
    lv_obj_set_style_bg_color(talk, lv_color_hex(ACCENT), 0);
    lv_obj_set_style_text_color(talk, lv_color_hex(BACKGROUND), 0);
    lv_obj_align(talk, LV_ALIGN_BOTTOM_MID, 0, -34);

    lv_timer_create(on_pulse_timer, 50, nullptr);
}

void build_settings()
{
    settings_screen = make_screen();
    swipe_right_goes_to(settings_screen, Back::home);

    auto *title = lv_label_create(settings_screen);
    lv_label_set_text(title, "Brightness");
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 96, 62);
    brightness_value = lv_label_create(settings_screen);
    lv_obj_set_style_text_color(brightness_value, lv_color_hex(ACCENT), 0);
    lv_obj_align(brightness_value, LV_ALIGN_TOP_RIGHT, -96, 62);

    auto *slider = lv_slider_create(settings_screen);
    lv_obj_set_size(slider, 290, 14);
    lv_slider_set_range(slider, 20, 100);
    const int brightness = settings::get_int("brightness", 80);
    lv_slider_set_value(slider, brightness, LV_ANIM_OFF);
    lv_label_set_text_fmt(brightness_value, "%d%%", brightness);
    lv_obj_align(slider, LV_ALIGN_TOP_MID, 0, 104);
    lv_obj_add_event_cb(slider, on_brightness_changed, LV_EVENT_VALUE_CHANGED, nullptr);
    lv_obj_add_event_cb(slider, on_brightness_released, LV_EVENT_RELEASED, nullptr);

    auto *wifi = make_button(settings_screen, "Wi-Fi", on_open_networks, 340, 70);
    lv_obj_set_style_radius(wifi, 24, 0);
    lv_obj_align(wifi, LV_ALIGN_TOP_MID, 0, 140);
    lv_obj_align(lv_obj_get_child(wifi, 0), LV_ALIGN_LEFT_MID, 6, 0);
    wifi_name = lv_label_create(wifi);
    lv_obj_set_style_text_color(wifi_name, lv_color_hex(MUTED), 0);
    lv_obj_align(wifi_name, LV_ALIGN_RIGHT_MID, -6, 0);

    info = make_text(settings_screen, "", MUTED, 330);
    lv_obj_set_style_text_font(info, &lv_font_montserrat_16, 0);
    lv_obj_align(info, LV_ALIGN_TOP_MID, 0, 226);

    update_button = make_button(settings_screen, "Firmware is current", on_update_clicked, 270, 48);
    lv_obj_align(update_button, LV_ALIGN_BOTTOM_MID, 0, -66);

    auto *back = make_text(settings_screen, "swipe right to go back", BORDER, 260);
    lv_obj_set_style_text_font(back, &lv_font_montserrat_16, 0);
    lv_obj_align(back, LV_ALIGN_BOTTOM_MID, 0, -30);
}

void build_networks()
{
    network_screen = make_screen();
    swipe_right_goes_to(network_screen, Back::settings);
    auto *title = lv_label_create(network_screen);
    lv_label_set_text(title, "Wi-Fi");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 40);

    network_list = lv_obj_create(network_screen);
    lv_obj_set_size(network_list, 344, 320);
    lv_obj_align(network_list, LV_ALIGN_CENTER, 0, 24);
    lv_obj_set_style_bg_opa(network_list, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(network_list, 0, 0);
    lv_obj_set_style_pad_all(network_list, 4, 0);
    lv_obj_set_style_pad_row(network_list, 7, 0);
    lv_obj_set_flex_flow(network_list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(network_list, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_add_flag(network_list, LV_OBJ_FLAG_GESTURE_BUBBLE);
}

lv_obj_t *make_field(const char *placeholder, int32_t y)
{
    auto *field = lv_textarea_create(edit_screen);
    lv_textarea_set_one_line(field, true);
    lv_textarea_set_placeholder_text(field, placeholder);
    lv_obj_set_size(field, 260, 38);
    lv_obj_align(field, LV_ALIGN_TOP_MID, 0, y);
    lv_obj_set_style_text_font(field, &lv_font_montserrat_16, 0);
    lv_obj_add_flag(field, LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_add_event_cb(field, on_field_focused, LV_EVENT_FOCUSED, nullptr);
    return field;
}

void build_edit()
{
    edit_screen = make_screen();
    swipe_right_goes_to(edit_screen, Back::networks);
    ssid_field = make_field("Network", 40);
    lv_obj_remove_flag(ssid_field, LV_OBJ_FLAG_CLICKABLE);
    password_field = make_field("Password", 82);
    garden_field = make_field("Garden address (empty = automatic)", 124);

    keyboard = lv_keyboard_create(edit_screen);
    lv_obj_set_size(keyboard, 370, 176);
    lv_obj_align(keyboard, LV_ALIGN_CENTER, 0, 56);
    lv_obj_set_style_text_font(keyboard, &lv_font_montserrat_16, 0);
    lv_obj_add_event_cb(keyboard, on_save_network, LV_EVENT_READY, nullptr);

    auto *save = make_button(edit_screen, "Join", on_save_network, 150, 42);
    lv_obj_set_style_bg_color(save, lv_color_hex(ACCENT), 0);
    lv_obj_set_style_text_color(save, lv_color_hex(BACKGROUND), 0);
    lv_obj_align(save, LV_ALIGN_BOTTOM_MID, 0, -30);
    edit_error = make_text(edit_screen, "", ALERT, 260);
    lv_obj_set_style_text_font(edit_error, &lv_font_montserrat_16, 0);
    lv_obj_align(edit_error, LV_ALIGN_BOTTOM_MID, 0, -8);
}

void build_update()
{
    update_screen = make_screen();
    update_label = make_text(update_screen, "", INK, 320);
    lv_obj_align(update_label, LV_ALIGN_CENTER, 0, -30);
    update_bar = lv_bar_create(update_screen);
    lv_obj_set_size(update_bar, 260, 10);
    lv_bar_set_range(update_bar, 0, 100);
    lv_obj_align(update_bar, LV_ALIGN_CENTER, 0, 30);
}

}  // namespace

Lock::Lock()
{
    bsp_display_lock(UINT32_MAX);       // the BSP reads this as "wait forever"
}

Lock::~Lock()
{
    bsp_display_unlock();
}

void build()
{
    build_home();
    build_settings();
    build_networks();
    build_edit();
    build_update();
    lv_screen_load(home);
    render_home();
}

void set_link(Link next, const garden::Hello &hello)
{
    link = next;
    last_hello = hello;
    if (lv_screen_active() == home && phase == Phase::idle) {
        if (next == Link::ready && !notice.empty()) notice.clear();
        render_home();
        greet();
    } else if (lv_screen_active() == settings_screen) {
        refresh_settings();
    }
}

bool idle()
{
    return phase == Phase::idle && !updating && !turn.active() && lv_screen_active() == home;
}

void toggle_talk()
{
    if (updating || lv_screen_active() != home) return;
    switch (phase) {
    case Phase::idle:
        notice.clear();
        if (link != Link::ready) break;                 // the hint already says what is missing
        if (turn.start(garden::base_url(), {on_turn_stage, on_turn_delta, on_turn_finished})) {
            muted = false;
            phase = Phase::listening;
        } else {
            notice = "One moment, the last answer is still arriving";
        }
        break;
    case Phase::listening:
        turn.finish_recording();
        phase = Phase::thinking;
        break;
    case Phase::thinking:
        break;                                          // nothing to interrupt yet
    case Phase::reading:
        wordstream.stop();
        muted = turn.active();
        phase = Phase::idle;
        break;
    }
    render_home();
}

void start_update(const garden::Hello &hello)
{
    if (updating || turn.active()) return;
    updating = true;
    update_target = hello;
    wordstream.stop();
    phase = Phase::idle;
    lv_label_set_text_fmt(update_label, "Updating to %s\nKeep the Pond powered", hello.firmware_version.c_str());
    lv_bar_set_value(update_bar, 0, LV_ANIM_OFF);
    lv_screen_load(update_screen);
    if (xTaskCreate(update_task, "bloom_ota", 8192, nullptr, 4, nullptr) != pdPASS) {
        updating = false;
        lv_screen_load(home);
    }
}

}  // namespace bloom::ui
