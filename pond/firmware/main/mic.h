#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define MIC_SAMPLE_RATE 16000

/** Set up I2S and the ES7210 microphone codec once at boot. */
esp_err_t mic_init(void);
/** Start capturing. */
esp_err_t mic_open(void);
/** Block until `frames` mono samples (16 kHz, 16 bit) are read; both microphones are averaged. */
esp_err_t mic_read(int16_t *mono, size_t frames);
void mic_close(void);

#ifdef __cplusplus
}
#endif
