idf_component_register(
    SRCS
        "main.cpp"
        "garden.cpp"
        "mic.c"
        "network.cpp"
        "ota.cpp"
        "settings.cpp"
        "turn.cpp"
        "ui.cpp"
        "wordstream.cpp"
    INCLUDE_DIRS "."
    REQUIRES
        app_update esp_app_format esp_driver_gpio esp_event esp_http_client esp_https_ota
        esp_netif esp_timer esp_wifi json nvs_flash
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
