idf_component_register(
    SRCS
        "main.cpp"
        "network.cpp"
        "particles.cpp"
        "system_settings.cpp"
        "turn.cpp"
        "wordstream.cpp"
    INCLUDE_DIRS "."
    REQUIRES esp_codec_dev esp_event esp_http_client esp_netif esp_timer esp_wifi json nvs_flash
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
