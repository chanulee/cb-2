[English](README.md) | **한국어**

# BLOOM

BLOOM은 두 기기로 이루어진 자기 성찰 의식이며, 모든 처리가 집 안에서 이루어집니다.

- **Pond** — 손에 쥐는 Waveshare ESP32-S3 Touch AMOLED 1.75 기기입니다. 문장을
  한 단어씩 보여주고, 사용자의 말을 녹음하며, 기기에서 하는 동작 하나로 "다
  말했다"를 알립니다.
- **Garden** — NVIDIA Jetson Orin Nano Super Developer Kit입니다. 음성 인식을
  로컬에서 수행하고, 다음에 보여줄 1인칭 성찰 문장을 만드는 로컬 언어 모델을
  돌립니다.

## 저장소의 세대별 폴더

| 경로 | 상태 | 용도 |
| --- | --- | --- |
| [`pony/`](pony/) | 개발 베타, 보존 | 예전 `pond/` 프로토타입: LILYGO T7-S3 + Mac 음성 비서. 제품 이름은 Pony입니다. |
| [`garden/`](garden/) | 실험 | 기존 Jetson/Gemma 설치 작업. |
| [`v1/`](v1/) | 개념 증명, 보존 | Springboard, Wordstream, Particles, Wi-Fi, 녹음 한 턴, Garden 응답. |
| [`v2/`](v2/) | 현재 개발 중 | 기본 소프트웨어: 한 줄 설치, 더블클릭으로 켜는 Garden, 스트리밍 답변, 속독 표시, Pond 무선 업데이트. |

[`v2/README.ko.md`](v2/README.ko.md)부터 읽으세요. Jetson에 설치하려면:

```bash
curl -fsSL https://raw.githubusercontent.com/chanulee/cb-2/main/install.sh | bash
```
