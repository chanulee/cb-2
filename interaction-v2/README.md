# Interaction v2 — 논문 기반 인터랙션 업데이트 (생각 정리)

상태: 제안. 코드는 아직 바꾸지 않았다.

- 근거 논문: Singh, Taneja, Guan, Ghosh. *Protecting Human Cognition in the Age of AI*. Tools for Thought at CHI '25. arXiv:2502.12447v3
- 유저 저니 맵 (FigJam): https://www.figma.com/board/qF1ZWOxy3qd5NY6LT0sHfc

## 현재 v1 인터랙션 (코드 기준)

1. Springboard → Pond 앱.
2. 고정 문장 5개 중 하나가 한 단어씩 나온다 (`v1/garden/bloom_garden/session.py`의 `PROMPTS`).
3. `Start speaking` → 녹음 → `I'm done` → `Sending...` (`v1/pond/firmware/main/main.cpp`의 `record_clicked`).
4. Garden: whisper.cpp 전사 → Gemma가 1인칭 질문 1개(25단어 이하)를 만든다. 입력은 직전 전사 1개뿐이다 (`inference.py`의 `chat_payload`).
5. 새 질문이 한 단어씩 나온다. 2로 돌아간다. 종료 상태와 세션 간 저장은 없다.

## 논문에서 가져온 것

논문은 Dewey의 reflective thinking 전제조건 5개를 기준으로, GenAI가 각 조건을 어떻게 약화시키는지와 대응 설계를 제시한다.

| Dewey 전제조건 | GenAI가 약화시키는 방식 (논문) | 논문이 제시한 대응 |
| --- | --- | --- |
| 1. 의문·혼란 상태 | 즉각적으로 합성된 응답이 인지 부조화의 순간을 줄인다 | 응답 일부를 사용자가 하이라이트, 출력 사용 전 작은 마찰(friction) |
| 2. 사전 경험·지식 활용 | — | 스키마(지식 그래프)로 사전 지식 활성화 |
| 3. 능동적·지속적 숙고 | 챗봇이 표면적 대화로 흐른다 | 관련 아이디어를 사전 지식에 연결 |
| 4. 판단 유보, 불확실성 감내 | 기존 믿음에 맞추는 경향, 확신에 찬 어조 | metacognitive prompt, provocation (반대 관점) |
| 5. 관련 아이디어 연결·평가 | 정리된 응답이 이해했다는 착각을 만든다 | 위와 같음 |

추가로: 학습 초반에는 AI 개입을 최소로 두고 스스로 버티는 시간(productive struggle, cognitive endurance)이 필요하다. Bloom 인지 과정(remember → understand → apply → analyze → evaluate → create) 중 LLM 사용 시 아래 단계들이 건너뛰어진다.

## 제안하는 새 흐름

| 단계 | 사용자 | Pond | Garden | 현재 v1과의 차이 | 바꿀 파일 |
| --- | --- | --- | --- | --- | --- |
| 0. 진입 | Pond 앱을 누른다 | "What is still unsettled in me from today?" | 고정 문장 반환 | 지금은 기기가 주제를 정해준다 | `session.py` |
| 1. 혼자 먼저 말하기 | 마음에 걸리는 것을 말한다 | 녹음 30초 전에는 `I'm done`이 흐리고, 누르면 "Keep going?" 1회 | 대기 | 최소 발화 시간 없음 | `main.cpp` |
| 2. 기다림 | 방금 한 말을 다시 본다 | 최소 10초 Particles만 | 전사 → 세션 기록 → 질문 생성 | 응답 즉시 표시 | `turn.cpp` |
| 3. 질문 읽기 + 단어 짚기 | 걸리는 단어에서 탭 | 탭한 단어가 밝게 남는다 | 탭한 단어를 focus로 받는다 | 탭 입력 없음 | `wordstream.cpp`, `/turn` 요청 |
| 4. 같은 주제로 더 깊이 | 짚은 단어에 대해 2~3턴 말한다 | 1~3 반복 | 세션 전체 전사 + focus 전달, 질문 단계를 이해 → 분석 → 평가로 올린다 | 직전 전사 1개만 전달 | `session.py`, `inference.py` |
| 5. 판단 미루기 | 자기 결론의 반대 경우를 말한다 | 4턴째에 "What if the opposite were true about what I just said?" | 동의·칭찬·요약·조언 금지 규칙 | 반대 관점 규칙 없음 | `inference.py` |
| 6. 이전 생각과 연결 | 지난 세션의 자기 말과 비교한다 | "Last time I said: … How does today fit with that?" | 지난 마무리 문장 원문 1개를 불러온다 | 세션 간 저장 없음 | Garden 저장 (신규) |
| 7. 내 말로 마무리 | 한 문장으로 직접 말한다 | 사용자 문장을 그대로 다시 보여주고 종료 | 원문 저장, 요약 생성 안 함 | 종료 없음 | `session.py`, Pond 종료 화면 |

## 논문에 없는 것 (임시로 정한 값)

- 숫자: 최소 녹음 30초, 기다림 10초, 반대 질문 4턴째, 깊이 파기 2~3턴.
- 단어 탭 방식. 논문은 "응답의 일부를 하이라이트"라고만 한다.
- 지난 세션 연결을 마무리 문장 1개로 하는 것. 논문은 지식 그래프를 예로 든다.

## 열린 질문

- 매 세션 같은 첫 문장이면 읽지 않게 되는가?
- Jetson 추론 시간이 이미 충분한 마찰인가? 측정이 필요하다.
- 한 단어씩 지나가는 속도에서 탭이 가능한가? 대안: 끝난 뒤 전체 문장에서 고르기.
- Gemma 4 E2B Q4가 단계 지시(이해 → 분석 → 평가)를 따르는가? ctx 2048에 몇 턴까지 들어가는가?
- 감정적으로 힘든 날에 반대 질문을 건너뛰는 동작이 필요한가?
- 종료 시점: 고정 턴 수 vs 사용자의 동작.
- 논문의 대상은 학습하는 초심자(학생)다. BLOOM은 자기 성찰이라 맥락이 다르다. Dewey 전제조건은 그대로 적용되지만, 논문이 인용한 실험 결과(코딩·작문 과제)는 직접 근거가 아니다.
