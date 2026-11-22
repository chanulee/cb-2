#pragma once

#include <string>

// Finding Garden on the LAN and asking it who it is. Protocol: v2/PROTOCOL.md.
namespace bloom::garden {

struct Hello {
    bool ok = false;            // Garden answered
    bool ready = false;         // its speech and language models are loaded
    int wpm = 270;
    std::string opening;
    bool has_firmware = false;  // Garden holds a Pond image
    bool firmware_auto = false; // install without asking
    std::string firmware_version;
    std::string firmware_sha256;
    std::string firmware_url;   // absolute
};

/**
 * "http://host:port" of Garden, or "" when it cannot be found. Uses the address typed
 * in Settings if there is one, otherwise an mDNS query for _bloom._tcp (blocks up to 3 s).
 */
std::string base_url();
/** True when the address came from Settings rather than from discovery. */
bool manual();
/** Forget the discovered address so the next base_url() searches again. */
void forget();
Hello hello();

}  // namespace bloom::garden
