#pragma once

#include <cstdint>
#include <deque>
#include <string>

#include "lvgl.h"

namespace bloom {

// Speed-reading display (RSVP): one word at a time at a fixed spot. The letter the eye
// should land on, the "pivot", is highlighted and always drawn at the screen centre, so
// the eyes do not move. Text can be appended while it plays, which is how a streamed
// answer is shown. All methods must be called with the display lock held.
class Wordstream {
public:
    using Finished = void (*)();

    void create(lv_obj_t *parent, Finished on_finished);
    /** Start an empty stream at this speed. */
    void begin(int words_per_minute);
    /** Add streamed text. A word is queued once the whitespace after it has arrived. */
    void append(const char *text);
    /** No more text will come; `on_finished` runs after the last word. */
    void end();
    /** Show a complete text. */
    void say(const char *text, int words_per_minute);
    /** Stop now and clear the screen. `on_finished` is not called. */
    void stop();
    bool active() const { return active_; }

private:
    static void on_timer(lv_timer_t *timer);
    void tick();
    void show(const std::string &word);
    void clear();

    lv_obj_t *before_ = nullptr;
    lv_obj_t *pivot_ = nullptr;
    lv_obj_t *after_ = nullptr;
    lv_timer_t *timer_ = nullptr;
    Finished on_finished_ = nullptr;
    std::deque<std::string> words_;
    std::string partial_;
    int64_t next_word_us_ = 0;
    uint32_t base_dwell_ms_ = 222;
    bool active_ = false;
    bool ended_ = false;
};

}  // namespace bloom
