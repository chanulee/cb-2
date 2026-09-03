#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "lvgl.h"

namespace bloom {

class Wordstream {
public:
    void create(lv_obj_t *parent);
    void play(const char *text, uint16_t words_per_minute = 270);
    void stop();
    void set_hint(const char *text);
    bool playing() const { return playing_; }

private:
    static void timer_callback(lv_timer_t *timer);
    void tick();
    void show_word(const std::string &word);

    lv_obj_t *label_ = nullptr;
    lv_obj_t *hint_ = nullptr;
    lv_timer_t *timer_ = nullptr;
    std::vector<std::string> words_;
    std::size_t index_ = 0;
    int64_t next_word_us_ = 0;
    uint32_t base_dwell_ms_ = 222;
    bool playing_ = false;
};

}  // namespace bloom
