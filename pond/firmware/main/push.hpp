#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// A small HTTP server on the Pond (port 80) so Garden can reach it:
//   POST /api/update   "install the firmware you hold now"
//   GET  /api/info     device id and running firmware version
namespace bloom::push {

/** Start listening. `listener` is notified (xTaskNotifyGive) when an update is requested. */
void start(TaskHandle_t listener);

}  // namespace bloom::push
