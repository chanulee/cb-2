[English](README.md) | **한국어**

# Garden

Bloom 2의 Jetson 쪽 프로그램입니다. Ubuntu에 기본으로 들어 있는 파이썬만 있으면
됩니다. 모델 서버 두 개(`llama-server`, `whisper-server`)는 별도 프로그램이고,
Garden이 이들을 켜고 끕니다.

## 평소 사용

| 이렇게 하면 | 이렇게 됩니다 |
| --- | --- |
| 바탕화면의 **Bloom Garden** 더블클릭 | Garden을 시작하고 대시보드를 엽니다 |
| 아이콘 오른쪽 클릭 후 "Stop Bloom Garden" | Garden을 멈추고 GPU 메모리를 비웁니다 |
| `./launcher/start.sh --background` | 브라우저 없이 시작합니다 (`--autostart`가 쓰는 방식) |
| `python3 -m bloom_garden --mock` | 모델 없이 정해진 답으로 실행합니다. Pond 테스트용입니다 |

대시보드(<http://localhost:8765>)에서는 모델이 올라왔는지, 어떤 Pond가 접속했는지,
Garden이 보관 중인 펌웨어, 최근 턴과 소요 시간을 볼 수 있습니다. 텍스트 상자에
글을 넣으면 Pond 없이 한 턴을 돌리고 한 단어씩 표시되는 모습을 미리 볼 수
있습니다.

## 설정

`~/.config/bloom/garden.json`은 처음 시작할 때 만들어집니다. 바꾸고 싶은 키만
적으면 되고, 기본값은 [`bloom_garden/config.py`](bloom_garden/config.py)에
있습니다.

```json
{
  "wpm": 300,
  "language": "en",
  "llm": { "model": "/home/me/models/gemma-4-E4B-it-Q4_K_M.gguf", "ctx_size": 4096 },
  "firmware": { "auto_install": false }
}
```

모델에 주는 지시문을 바꾸려면 [`bloom_garden/system_prompt.txt`](bloom_garden/system_prompt.txt)를
`~/.config/bloom/system_prompt.txt`로 복사한 뒤 복사본을 고치세요. 바꾼 뒤에는
Garden을 다시 시작해야 합니다.

Garden은 `llama.cpp/build/bin/llama-server`, `whisper.cpp/build/bin/whisper-server`,
`models/`를 `~/.local/share/bloom`, `$BLOOM_SCRATCH_DIR`, `~/.gemini/antigravity/scratch`
(이전 `archive/garden/g4q4-setup`의 위치) 순서로 찾습니다. 8080이나 8081 포트에서 이미
서버가 응답하고 있으면 새로 띄우지 않고 그 서버를 씁니다.

## 개발

```bash
cd garden
python3 -m unittest discover -s tests -v    # 모델, GPU, 네트워크가 없어도 됩니다
python3 -m bloom_garden --mock --open
```

- `bloom_garden/pipeline.py` 한 턴 처리: PCM → whisper.cpp → llama.cpp → 이벤트
- `bloom_garden/server.py` HTTP 경로 ([`../PROTOCOL.md`](../PROTOCOL.md))
- `bloom_garden/services.py` 모델 서버 프로세스와 mDNS 알림
- `bloom_garden/firmware.py` Garden이 내주는 Pond 펌웨어 파일
- `bloom_garden/static/index.html` 대시보드
