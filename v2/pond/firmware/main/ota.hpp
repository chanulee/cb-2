#pragma once

#include <string>

#include "esp_err.h"

#include "garden.hpp"

// Over-the-air update from the image Garden serves at /firmware/pond.bin.
namespace bloom::ota {

std::string running_version();
/** SHA-256 of the running build's ELF file, 64 hex characters. Identifies a build exactly. */
std::string running_sha256();
/** Garden holds a build that is not the one running. */
bool available(const garden::Hello &hello);
/** `available`, Garden asked for automatic installs, and this build was not already tried. */
bool should_auto_install(const garden::Hello &hello);
/** After an update: tell the bootloader this image works, so it is not rolled back. */
void confirm_running_image();
/** Download and flash. Restarts on success, so it only returns on failure. */
esp_err_t install(const garden::Hello &hello, void (*progress)(int percent));

}  // namespace bloom::ota
