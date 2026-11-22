[English](README.md) | **한국어**

# Pond

Waveshare ESP32-S3 Touch AMOLED 1.75용 펌웨어입니다. (466 × 466 원형 AMOLED,
ES7210에 연결된 마이크 2개, 플래시 16 MB, PSRAM 8 MB)

대부분은 이 펌웨어를 직접 빌드할 일이 없습니다. `install.sh`가 릴리스된 파일을
USB-C로 써 넣고, 이후 버전은 Garden이 Wi-Fi로 전달합니다.

## 사용법

| 조작 | 동작 |
| --- | --- |
| **Speak** 버튼 또는 옆면 BOOT 버튼 | 녹음 시작 (최대 60초) |
| **Done** / BOOT | 녹음을 Garden으로 보냄 |
| **Stop** / BOOT | 표시 중인 답을 멈춤 |
| 위쪽 톱니바퀴 | 설정: 밝기, Wi-Fi, 펌웨어 업데이트 |
| 오른쪽으로 쓸기 | 뒤로 |

단어가 표시되는 자리 아래의 한 줄이 Pond가 무엇을 기다리는지 알려줍니다.
"Joining Wi-Fi...", "Looking for Garden...", "Garden is loading its models",
"Press to speak" 중 하나입니다.

## 빌드

ESP-IDF 5.5 (`release/v5.5` 브랜치)를 씁니다.

```bash
cd v2/pond/firmware
idf.py build
idf.py -p /dev/ttyACM0 flash monitor     # USB-C. 기기를 못 찾으면 BOOT를 누른 채로 케이블을 꽂습니다
```

이렇게 써 넣으면 기기에 저장된 Wi-Fi 정보가 그대로 남습니다. `flash_pond.py`와
릴리스가 쓰는 통합 파일을 만들려면 아래 명령도 실행합니다.
`(cd build && python -m esptool --chip esp32s3 merge_bin -o bloom-pond-factory.bin @flash_args)`

## Wi-Fi로 업데이트하기

```bash
idf.py build
../publish.sh                       # Jetson에서 실행할 때
../publish.sh jetson.local TOKEN    # 노트북에서 실행할 때. TOKEN은 garden.json의 upload_token
```

`publish.sh`는 `build/bloom-pond.bin`을 Garden에 올리고, Garden이 그것을 Pond로
밀어 넣습니다. 각 Pond는 "Updating to …"를 표시하고, 파일을 여분 영역에 쓴 뒤
재시작합니다. 1분쯤 걸립니다.

직접 빌드하지 않는 경우에는 `firmware/version.txt`와 같은 버전으로
`pond-vX.Y.Z` 태그를 푸시합니다. CI가 빌드해서 GitHub 릴리스로 올립니다. Jetson의
대시보드에서 "Get latest release from GitHub"를 누른 다음 **Update Ponds now**를
누르면 됩니다.

`garden.json`에 `"firmware": {"auto_install": true}`를 넣지 않는 한 Pond는 스스로
업데이트하지 않습니다. Pond 설정 화면에도 "Update to …" 버튼이 있습니다.

안전장치:

- 6 MB 앱 영역이 두 개 있습니다(`partitions.csv`). 실행 중인 영역은 덮어쓰지
  않습니다.
- 새 빌드는 Wi-Fi에 연결되거나 1분 동안 실행되어야 유지됩니다. 그 전에 리셋되면
  부트로더가 이전 빌드로 부팅합니다.
- `auto_install`을 켠 경우, 한 번 되돌려진 빌드는 스스로 다시 설치하지 않습니다.
  push나 설정 화면의 "Update to …"로는 설치됩니다.

## 소스

| 파일 | 역할 |
| --- | --- |
| `main.cpp` | 시작 처리, Wi-Fi·Garden·업데이트 상태의 백그라운드 확인, BOOT 버튼 |
| `ui.cpp` | 화면들과 대기 → 듣기 → 생각 → 읽기 상태 |
| `wordstream.cpp` | 기준 글자를 고정하는 속독 표시 |
| `turn.cpp` | 녹음, 업로드, 스트리밍 답변 해석 |
| `mic.c` | ES7210을 16 kHz로 읽고 마이크 2개를 평균해서 모노로 만듦 |
| `garden.cpp` | mDNS로 Garden 찾기, `/api/hello` |
| `ota.cpp` | 다운로드, 플래시 기록, 확정 또는 되돌리기 |
| `push.cpp` | Garden의 "지금 업데이트" 신호를 받는 80번 포트 |
| `network.cpp`, `settings.cpp` | Wi-Fi와 저장된 설정 (NVS 네임스페이스 `bloom`) |

## 실제 하드웨어에서 처음 켤 때

이 펌웨어는 CI에서 컴파일됩니다. 아래 항목은 보드에 따라 달라지므로 실제 기기에서
확인이 필요합니다.

1. **마이크.** 녹음 코드는 앞쪽 마이크 2개가 ES7210의 입력 1번과 2번이라고
   가정합니다. 녹음이 무음이거나 예상의 절반 크기라면 `mic.c`를 확인하세요.
2. **USB 콘솔.** 로그는 ESP32-S3 내장 USB 시리얼 포트로 나갑니다.
3. **터치 배치.** 버튼과 키보드 위치는 466픽셀 원형 화면을 실제로 보지 않고
   정했습니다.
4. **BOOT 버튼.** GPIO 0을 말하기 버튼으로 읽습니다.
