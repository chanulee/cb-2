[English](README.md) | **한국어**

# Bloom 2

Bloom 2는 [Cognitive Bloom](https://mapprojectoffice.com/work/cognitive-bloom/)의
후속작으로, 짧은 자기 성찰 의식을 위한 기기입니다. 작고 둥근 휴대 기기의 버튼을
누르고 지금 마음에 있는 것을 말합니다. 집에 있는 컴퓨터가 그 말을 1인칭 생각 한
줄과 질문 하나로 바꾸고, 휴대 기기가 그것을 한 단어씩 보여줍니다. 어떤 데이터도
집 네트워크 밖으로 나가지 않습니다.

| | Pond | Garden |
| --- | --- | --- |
| 하드웨어 | Waveshare ESP32-S3 Touch AMOLED 1.75 | NVIDIA Jetson Orin Nano Super Developer Kit |
| 역할 | 버튼, 마이크, 한 단어씩 보여주는 화면 | 음성 인식, 언어 모델, 펌웨어 업데이트 |
| 코드 | [`pond/`](pond/README.ko.md) (ESP-IDF, C++) | [`garden/`](garden/README.ko.md) (파이썬 표준 라이브러리) |

## 설치

두 기기, 데이터 전송이 되는 USB-C 케이블, 2.4 GHz 대역이 있는 Wi-Fi가 필요합니다.
Jetson은 기본 Ubuntu 데스크톱(JetPack)이 설치되어 있고 인터넷에 연결되어 있어야
합니다.

**1. Jetson에서 터미널을 열고 아래 한 줄을 붙여 넣습니다.**

```bash
curl -fsSL https://raw.githubusercontent.com/chanulee/cb-2/main/install.sh | bash
```

비밀번호를 한 번 묻고, 일곱 단계를 차례로 진행합니다. 시스템 패키지, CUDA와 스왑,
llama.cpp와 Gemma 4 E2B 모델(3.1 GB), whisper.cpp와 `base.en` 모델, 바탕화면
아이콘, Pond 펌웨어, Garden 시작 순서입니다. 처음 실행하면 30분에서 60분이
걸리는데, 거의 전부 컴파일과 다운로드 시간입니다. 이미 끝난 단계는 건너뛰므로
다시 실행해도 됩니다.

**2. "Connect the Pond"라는 안내가 나오면 Pond를 Jetson에 꽂고 Enter를 누릅니다.**

Jetson이 연결된 Wi-Fi를 기본값으로 제시하고, 펌웨어와 Wi-Fi 비밀번호를 Pond에
써 넣은 뒤 Pond를 재시작합니다. 케이블 연결은 이때 한 번만 합니다. 이후 펌웨어는
Wi-Fi로 받습니다.

**3. Pond를 뽑고 사용합니다.** **Speak**(또는 옆면의 BOOT 버튼)를 누르고 말한 뒤
**Done**을 누릅니다. 답이 화면에 한 단어씩 나타납니다.

Jetson을 재부팅한 뒤에는 바탕화면의 **Bloom Garden**을 더블클릭하세요. 모델을
띄우고 대시보드를 엽니다. 브라우저를 닫아도 Garden은 계속 실행됩니다. 메모리를
비우려면 아이콘을 오른쪽 클릭해서 "Stop Bloom Garden"을 고르거나 대시보드의
"Quit Garden"을 누릅니다. `./garden/install.sh --autostart`를 실행하면 로그인할
때마다 자동으로 시작합니다.

## 한 턴이 진행되는 과정

```text
Pond                                   Garden (Jetson)
────                                   ───────────────
Speak를 누르고 말한 뒤 Done
16 kHz 모노 PCM  ── POST /api/turn ──▶ whisper.cpp  (음성 인식, GPU)
                                       llama.cpp    (Gemma 4 E2B, 스트리밍, GPU)
한 단어씩 표시  ◀── 답의 조각마다 ──── {"type":"delta","text":" What"} ...
                    JSON 한 줄
```

- **서로 찾기.** Garden이 mDNS(avahi)로 `_bloom._tcp` 서비스를 알립니다. Pond가
  이 서비스를 질의하므로 IP 주소를 입력하지 않습니다. 공유기가 mDNS를 막는
  경우에는 Pond 설정에서 주소를 직접 입력할 수 있습니다.
- **통신 규약.** 8765번 포트의 일반 HTTP입니다. 한 턴에 요청 하나를 보내고,
  모델이 글자를 만드는 대로 줄 단위 JSON으로 응답합니다. 자세한 내용은
  [`PROTOCOL.md`](PROTOCOL.md)(영어)에 있고, `curl`로 직접 호출해 볼 수 있습니다.
- **한 단어씩 표시(wordstream).** RSVP 속독 방식으로, 분당 270단어 속도로 한 번에
  한 단어만 보여줍니다. 단어마다 가운데보다 약간 왼쪽의 글자 하나를 강조하고, 그
  글자를 항상 화면 정중앙에 그리므로 눈을 움직일 필요가 없습니다. 문장이 끝나는
  단어는 2.2배, 쉼표가 붙은 단어는 1.5배, 긴 단어는 1.3배 더 오래 보여줍니다.
- **업데이트.** Garden은 Pond 펌웨어 파일 하나를 보관합니다. 대시보드에서
  **Update Ponds now**를 누르면 각 Pond에 신호가 가고, 다른 빌드를 쓰고 있는
  Pond는 Garden의 파일을 여분 플래시 영역에 받아 그 빌드로 재시작합니다. 새
  빌드가 Wi-Fi에 연결되기 전에 죽으면 부트로더가 이전 빌드로 되돌립니다.

## 기본값과 바꾸는 곳

| 항목 | 기본값 | 바꾸는 곳 |
| --- | --- | --- |
| 언어 모델 | `llama-server`로 돌리는 Gemma 4 E2B Q4_K_M, 컨텍스트 2048 토큰 | `~/.config/bloom/garden.json`의 `llm` |
| 음성 인식 | `whisper-server`로 돌리는 `ggml-base.en` | `garden.json`의 `stt`, `language` |
| 모델에 주는 지시문 | 1인칭 내면의 목소리, 질문 하나, 45단어 이내 | `~/.config/bloom/system_prompt.txt` |
| 읽기 속도 | 분당 270단어 | `garden.json`의 `wpm` |
| 대화 기억 | 최근 6번의 주고받음, 20분 동안 조용하면 잊음 | `history_turns`, `session_idle_minutes` |
| 펌웨어 업데이트 | "Update Ponds now"를 누를 때 | `firmware.auto_install: true`로 두면 Pond가 스스로 설치 |

모델 선택은 [`archive/garden/g4q4-setup`](archive/garden/g4q4-setup)의 측정 결과를
따랐습니다. E2B Q4_K_M은 Orin Nano Super의 GPU에 전부 올라가고, 8 GB 안에서 음성
인식이 쓸 메모리를 남깁니다.

## 이번 첫 버전의 한계

- **화면 표시는 영어만 됩니다.** Pond 폰트에 한글 등 라틴 문자가 아닌 글자가 없고,
  기본 음성 모델도 영어 전용입니다. Garden은 모델이 낸 글을 ASCII로 줄여서
  보냅니다.
- **소리 출력이 없습니다.** 답은 읽는 것이고, 음성으로 나오지 않습니다.
- **펌웨어는 CI에서 컴파일만 확인했고 실제 기기에서 돌려보지 않았습니다.**
  [`pond/README.ko.md`](pond/README.ko.md)의 첫 실행 점검 목록을 실제 하드웨어에서
  확인해야 합니다.
- **보안 경계는 집 네트워크입니다.** 같은 Wi-Fi에 있는 누구나 Garden에 요청할 수
  있습니다. 펌웨어 업로드에는 토큰이 필요하고, 대시보드의 제어 버튼은 Jetson
  자체에서만 동작합니다.

## 폴더 구성

```text
install.sh               한 줄 설치의 시작점
garden/install.sh        Jetson에서 실행되는 일곱 단계
garden/flash_pond.py     Pond의 첫 USB 플래시, Wi-Fi 정보 포함
garden/launcher/         바탕화면 아이콘과 시작 스크립트
garden/bloom_garden/     서버, 턴 처리, 모델 프로세스 관리, 대시보드
pond/firmware/           ESP-IDF 프로젝트
pond/publish.sh          펌웨어 빌드를 Garden에 넘기기
PROTOCOL.md              Pond와 Garden 사이의 통신 규약
interaction-v2/          인터랙션 설계를 위한 사용자 여정 메모
archive/                 이전 세대, 참고용으로 보관
```

`archive/`에는 더 이상 개발하지 않는 작업이 들어 있습니다. `v1/`(첫 Pond·Garden
개념 증명), `pony/`(LILYGO T7-S3와 Mac 프로토타입), `garden/g4q4-setup`(Jetson에서의
초기 Gemma 4 설치와 벤치마크)입니다. [`archive/README.md`](archive/README.md)를
보세요.
