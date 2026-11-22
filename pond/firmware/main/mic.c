#include "mic.h"

#include "bsp/esp-bsp.h"
#include "esp_check.h"
#include "esp_codec_dev.h"

#define MIC_GAIN_DB 30.0f
#define MAX_FRAMES 512

static const char *TAG = "mic";
static esp_codec_dev_handle_t mic;
static int16_t stereo[MAX_FRAMES * 2];

esp_err_t mic_init(void)
{
    if (mic != NULL) return ESP_OK;
    /* The BSP default is 22.05 kHz mono. whisper.cpp wants 16 kHz, and the two
       microphones arrive as the left and right slot of a standard I2S frame. */
    const i2s_std_config_t config = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(MIC_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = BSP_I2S_MCLK,
            .bclk = BSP_I2S_SCLK,
            .ws = BSP_I2S_LCLK,
            .dout = BSP_I2S_DOUT,
            .din = BSP_I2S_DSIN,
        },
    };
    ESP_RETURN_ON_ERROR(bsp_i2c_init(), TAG, "I2C init failed");
    ESP_RETURN_ON_ERROR(bsp_audio_init(&config), TAG, "I2S init failed");
    mic = bsp_audio_codec_microphone_init();
    ESP_RETURN_ON_FALSE(mic != NULL, ESP_FAIL, TAG, "ES7210 not found");
    return ESP_OK;
}

esp_err_t mic_open(void)
{
    ESP_RETURN_ON_FALSE(mic != NULL, ESP_ERR_INVALID_STATE, TAG, "mic_init has not succeeded");
    esp_codec_dev_sample_info_t format = {
        .bits_per_sample = 16,
        .channel = 2,
        .sample_rate = MIC_SAMPLE_RATE,
    };
    ESP_RETURN_ON_FALSE(esp_codec_dev_open(mic, &format) == ESP_CODEC_DEV_OK, ESP_FAIL, TAG, "open failed");
    esp_codec_dev_set_in_gain(mic, MIC_GAIN_DB);
    return ESP_OK;
}

esp_err_t mic_read(int16_t *mono, size_t frames)
{
    ESP_RETURN_ON_FALSE(mic != NULL && frames <= MAX_FRAMES, ESP_ERR_INVALID_ARG, TAG, "bad read");
    if (esp_codec_dev_read(mic, stereo, (int)(frames * 2 * sizeof(int16_t))) != ESP_CODEC_DEV_OK) {
        return ESP_FAIL;
    }
    for (size_t frame = 0; frame < frames; ++frame) {
        mono[frame] = (int16_t)(((int32_t)stereo[frame * 2] + stereo[frame * 2 + 1]) / 2);
    }
    return ESP_OK;
}

void mic_close(void)
{
    if (mic != NULL) esp_codec_dev_close(mic);
}
