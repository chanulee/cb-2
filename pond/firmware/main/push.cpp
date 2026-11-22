#include "push.hpp"

#include <string>

#include "esp_http_server.h"
#include "esp_log.h"

#include "network.hpp"
#include "ota.hpp"

namespace bloom::push {
namespace {

constexpr char TAG[] = "push";
TaskHandle_t waiting = nullptr;

esp_err_t send_info(httpd_req_t *request)
{
    const std::string body = "{\"id\":\"" + network::device_id() + "\",\"version\":\"" +
                             ota::running_version() + "\",\"sha256\":\"" + ota::running_sha256() + "\"}";
    httpd_resp_set_type(request, "application/json");
    return httpd_resp_send(request, body.c_str(), static_cast<ssize_t>(body.size()));
}

esp_err_t on_update(httpd_req_t *request)
{
    ESP_LOGI(TAG, "Garden asked for a firmware update");
    if (waiting != nullptr) xTaskNotifyGive(waiting);
    return send_info(request);
}

}  // namespace

void start(TaskHandle_t listener)
{
    waiting = listener;
    httpd_handle_t server = nullptr;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = 2;
    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "could not start; updates then only work from Pond Settings");
        return;
    }
    httpd_uri_t update = {};
    update.uri = "/api/update";
    update.method = HTTP_POST;
    update.handler = on_update;
    httpd_register_uri_handler(server, &update);
    httpd_uri_t info = {};
    info.uri = "/api/info";
    info.method = HTTP_GET;
    info.handler = send_info;
    httpd_register_uri_handler(server, &info);
}

}  // namespace bloom::push
