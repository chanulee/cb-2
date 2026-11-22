#include "wordstream.hpp"

#include <algorithm>
#include <cctype>

#include "esp_timer.h"

namespace bloom {
namespace {

std::size_t recognition_point(const std::string &word)
{
    const auto length = word.size();
    if (length <= 1) return 0;
    if (length <= 5) return 1;
    if (length <= 9) return 2;
    if (length <= 13) return 3;
    return 4;
}

bool has_sentence_pause(const std::string &word)
{
    return word.find_last_of(".!?") != std::string::npos;
}

const lv_font_t *fit_font(const std::string &word, int32_t max_width)
{
    const lv_font_t *fonts[] = {
        &lv_font_montserrat_48, &lv_font_montserrat_40, &lv_font_montserrat_36,
        &lv_font_montserrat_32, &lv_font_montserrat_28, &lv_font_montserrat_24,
        &lv_font_montserrat_20, &lv_font_montserrat_16,
    };
    for (const auto *font : fonts) {
        if (lv_text_get_width(word.c_str(), word.size(), font, 0) <= max_width) return font;
    }
    return &lv_font_montserrat_16;
}

void opacity_animation(void *object, int32_t value)
{
    lv_obj_set_style_opa(static_cast<lv_obj_t *>(object), static_cast<lv_opa_t>(value), 0);
}

}  // namespace

void Wordstream::create(lv_obj_t *parent)
{
    label_ = lv_label_create(parent);
    lv_label_set_long_mode(label_, LV_LABEL_LONG_CLIP);
    lv_label_set_recolor(label_, true);
    lv_obj_set_size(label_, 390, 64);
    lv_obj_set_style_text_align(label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(label_, lv_color_hex(0xF4F0E7), 0);
    lv_obj_set_style_text_font(label_, &lv_font_montserrat_48, 0);
    lv_obj_center(label_);

    hint_ = lv_label_create(parent);
    lv_label_set_text(hint_, "waiting for Garden");
    lv_obj_set_style_text_color(hint_, lv_color_hex(0x6F827D), 0);
    lv_obj_align(hint_, LV_ALIGN_BOTTOM_MID, 0, -78);

    timer_ = lv_timer_create(timer_callback, 20, this);
    lv_timer_pause(timer_);
}

void Wordstream::play(const char *text, uint16_t words_per_minute)
{
    stop();
    if (text == nullptr || label_ == nullptr) return;

    std::string source(text);
    std::size_t cursor = 0;
    while (cursor < source.size()) {
        while (cursor < source.size() && std::isspace(static_cast<unsigned char>(source[cursor]))) {
            ++cursor;
        }
        const auto start = cursor;
        while (cursor < source.size() && !std::isspace(static_cast<unsigned char>(source[cursor]))) {
            ++cursor;
        }
        if (cursor > start) words_.emplace_back(source.substr(start, cursor - start));
    }
    if (words_.empty()) return;

    const auto safe_wpm = std::clamp<uint16_t>(words_per_minute, 100, 500);
    base_dwell_ms_ = 60000U / safe_wpm;
    index_ = 0;
    next_word_us_ = esp_timer_get_time();
    playing_ = true;
    lv_label_set_text(hint_, "inner voice");
    lv_timer_resume(timer_);
    tick();
}

void Wordstream::stop()
{
    playing_ = false;
    words_.clear();
    index_ = 0;
    if (timer_ != nullptr) lv_timer_pause(timer_);
}

void Wordstream::set_hint(const char *text)
{
    if (hint_ != nullptr) lv_label_set_text(hint_, text == nullptr ? "" : text);
}

void Wordstream::timer_callback(lv_timer_t *timer)
{
    auto *self = static_cast<Wordstream *>(lv_timer_get_user_data(timer));
    if (self != nullptr) self->tick();
}

void Wordstream::tick()
{
    if (!playing_ || esp_timer_get_time() < next_word_us_) return;
    if (index_ >= words_.size()) {
        playing_ = false;
        lv_timer_pause(timer_);
        lv_label_set_text(label_, "");
        lv_label_set_text(hint_, "take the time I need");
        // Runtime adapter publishes wordstream.finished here.
        return;
    }

    const auto &word = words_[index_++];
    show_word(word);
    const float multiplier = has_sentence_pause(word) ? 1.65F : 1.0F;
    next_word_us_ = esp_timer_get_time() +
                    static_cast<int64_t>(static_cast<float>(base_dwell_ms_) * multiplier * 1000.0F);
}

void Wordstream::show_word(const std::string &word)
{
    lv_obj_set_style_text_font(label_, fit_font(word, 390), 0);
    const auto pivot = std::min(recognition_point(word), word.size() - 1);
    std::string marked = word.substr(0, pivot);
    marked += "#9DE7ED ";
    marked += word[pivot];
    marked += "#";
    marked += word.substr(pivot + 1);
    lv_label_set_text(label_, marked.c_str());

    lv_anim_delete(label_, opacity_animation);
    lv_obj_set_style_opa(label_, LV_OPA_TRANSP, 0);
    lv_anim_t animation;
    lv_anim_init(&animation);
    lv_anim_set_var(&animation, label_);
    lv_anim_set_exec_cb(&animation, opacity_animation);
    lv_anim_set_values(&animation, LV_OPA_TRANSP, LV_OPA_COVER);
    lv_anim_set_duration(&animation, std::min<uint32_t>(base_dwell_ms_ / 2, 220));
    lv_anim_set_path_cb(&animation, lv_anim_path_ease_out);
    lv_anim_start(&animation);
}

}  // namespace bloom
