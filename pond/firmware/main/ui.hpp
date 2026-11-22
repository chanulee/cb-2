#pragma once

#include "garden.hpp"

// Screens of the Pond. Every function here must run with the display lock held
// (ui::Lock), except where noted.
namespace bloom::ui {

enum class Link { no_wifi, connecting, searching, loading, ready };

/** Holds the LVGL lock for its lifetime. */
struct Lock {
    Lock();
    ~Lock();
    Lock(const Lock &) = delete;
    Lock &operator=(const Lock &) = delete;
};

void build();
/** Latest result of the background link check. */
void set_link(Link link, const garden::Hello &hello);
/** Home screen is showing and nothing is being recorded, sent or read. */
bool idle();
/** The talk button: start speaking, finish speaking, or stop the answer. */
void toggle_talk();
/** Switch to the update screen and install the firmware Garden offers. */
void start_update(const garden::Hello &hello);

}  // namespace bloom::ui
