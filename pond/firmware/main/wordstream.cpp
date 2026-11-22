#include "wordstream.hpp"

#include <algorithm>

#include "esp_timer.h"

namespace bloom {
namespace {

constexpr uint32_t INK = 0xF4F0E7;
constexpr uint32_t PIVOT = 0x9DE7ED;
constexpr uint32_t GUIDE = 0x3B4B48;
// Half of the round display's width at its middle row, minus a margin.
constexpr int32_t MAX_HALF_WIDTH = 205;

// These three rules are mirrored in the dashboard preview (garden/bloom_garden/static/index.html).
size_t pivot_index(size_t length)
{
    if (length <= 1) return 0;
    if (length <= 5) return 1;
    if (length <= 9) return 2;
    if (length <= 13) return 3;
    return 4;
}

float dwell_factor(const std::string &word)
{
    size_t last = word.size();
    while (last > 0 && (word[last - 1] == '"' || word[last - 1] == '\'' || word[last - 1] == ')')) --last;
    const char end = last > 0 ? word[last - 1] : ' ';
    if (end == '.' || end == '!' || end == '?') return 2.2F;
    if (end == ',' || end == ';' || end == ':') return 1.5F;
    return word.size() > 8 ? 1.3F : 1.0F;
}

int32_t text_width(const lv_font_t *font, const std::string &text, size_t from, size_t to)
{
    int32_t width = 0;
    for (size_t index = from; index < to; ++index) {
        const uint32_t next = index + 1 < text.size() ? static_cast<uint8_t>(text[index + 1]) : 0;
        width += lv_font_get_glyph_width(font, static_cast<uint8_t>(text[index]), next);
    }
    return width;
}

const lv_font_t *fit_font(const std::string &word, size_t pivot)
{
    static const lv_font_t *const fonts[] = {
        &lv_font_montserrat_48, &lv_font_montserrat_40, &lv_font_montserrat_36,
        &lv_font_montserrat_32, &lv_font_montserrat_28, &lv_font_montserrat_24,
        &lv_font_montserrat_20, &lv_font_montserrat_16,
    };
    for (const auto *font : fonts) {
        const int32_t half_pivot = text_width(font, word, pivot, pivot + 1) / 2;
        const int32_t left = text_width(font, word, 0, pivot) + half_pivot;
        const int32_t right = text_width(font, word, pivot + 1, word.size()) + half_pivot;
        if (std::max(left, right) <= MAX_HALF_WIDTH) return font;
    }
    return &lv_font_montserrat_16;
}

lv_obj_t *make_label(lv_obj_t *parent, uint32_t color)
{
    auto *label = lv_label_create(parent);
    lv_label_set_text(label, "");
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    return label;
}

void make_guide(lv_obj_t *parent, int32_t y)
{
    auto *mark = lv_obj_create(parent);
    lv_obj_remove_style_all(mark);
    lv_obj_set_size(mark, 2, 12);
    lv_obj_set_style_bg_color(mark, lv_color_hex(GUIDE), 0);
    lv_obj_set_style_bg_opa(mark, LV_OPA_COVER, 0);
    lv_obj_align(mark, LV_ALIGN_CENTER, 0, y);
}

}  // namespace

void Wordstream::create(lv_obj_t *parent, Finished on_finished)
{
    on_finished_ = on_finished;
    make_guide(parent, -46);
    make_guide(parent, 46);
    before_ = make_label(parent, INK);
    pivot_ = make_label(parent, PIVOT);
    after_ = make_label(parent, INK);
    timer_ = lv_timer_create(on_timer, 10, this);
    lv_timer_pause(timer_);
}

void Wordstream::begin(int words_per_minute)
{
    stop();
    base_dwell_ms_ = 60000U / static_cast<uint32_t>(std::clamp(words_per_minute, 100, 600));
    active_ = true;
    next_word_us_ = esp_timer_get_time();
    lv_timer_resume(timer_);
}

void Wordstream::append(const char *text)
{
    if (!active_ || ended_ || text == nullptr) return;
    for (const char *cursor = text; *cursor != '\0'; ++cursor) {
        const auto byte = static_cast<uint8_t>(*cursor);
        if (byte > ' ' && byte < 0x7F) {
            if (partial_.size() < 40) partial_.push_back(*cursor);
        } else if (!partial_.empty()) {      // whitespace, or a byte the font cannot draw
            words_.push_back(partial_);
            partial_.clear();
        }
    }
}

void Wordstream::end()
{
    if (!active_) return;
    if (!partial_.empty()) words_.push_back(partial_);
    partial_.clear();
    ended_ = true;
}

void Wordstream::say(const char *text, int words_per_minute)
{
    begin(words_per_minute);
    append(text);
    end();
}

void Wordstream::stop()
{
    active_ = false;
    ended_ = false;
    words_.clear();
    partial_.clear();
    if (timer_ != nullptr) lv_timer_pause(timer_);
    clear();
}

void Wordstream::clear()
{
    if (before_ == nullptr) return;
    lv_label_set_text(before_, "");
    lv_label_set_text(pivot_, "");
    lv_label_set_text(after_, "");
}

void Wordstream::on_timer(lv_timer_t *timer)
{
    static_cast<Wordstream *>(lv_timer_get_user_data(timer))->tick();
}

void Wordstream::tick()
{
    if (!active_ || esp_timer_get_time() < next_word_us_) return;
    if (words_.empty()) {
        if (!ended_) return;                // the model is slower than the reader: hold the last word
        stop();
        if (on_finished_ != nullptr) on_finished_();
        return;
    }
    const std::string word = words_.front();
    words_.pop_front();
    show(word);
    next_word_us_ = esp_timer_get_time() +
                    static_cast<int64_t>(static_cast<float>(base_dwell_ms_) * dwell_factor(word) * 1000.0F);
}

void Wordstream::show(const std::string &word)
{
    const size_t pivot = std::min(pivot_index(word.size()), word.size() - 1);
    const lv_font_t *font = fit_font(word, pivot);
    const int32_t half_pivot = text_width(font, word, pivot, pivot + 1) / 2;
    const int32_t half_screen = lv_obj_get_width(lv_obj_get_parent(pivot_)) / 2;

    for (auto *label : {before_, pivot_, after_}) lv_obj_set_style_text_font(label, font, 0);
    lv_label_set_text(before_, word.substr(0, pivot).c_str());
    lv_label_set_text(pivot_, word.substr(pivot, 1).c_str());
    lv_label_set_text(after_, word.substr(pivot + 1).c_str());
    // The pivot letter sits on the centre; the rest of the word grows away from it.
    lv_obj_align(pivot_, LV_ALIGN_CENTER, 0, 0);
    lv_obj_align(before_, LV_ALIGN_RIGHT_MID, -(half_screen + half_pivot), 0);
    lv_obj_align(after_, LV_ALIGN_LEFT_MID, half_screen + half_pivot, 0);
}

}  // namespace bloom
