# Interaction v2: updating the BLOOM ritual from the paper

Status: proposal. No code has been changed.

- Paper: Singh, Taneja, Guan, Ghosh. *Protecting Human Cognition in the Age of AI*. Tools for Thought at CHI '25. arXiv:2502.12447v3.
- Product concept: <https://mapprojectoffice.com/work/cognitive-bloom/>
- User journey map (FigJam): <https://www.figma.com/board/qF1ZWOxy3qd5NY6LT0sHfc>

## What the concept defines

The physical interaction comes from the Cognitive Bloom concept page, not from this proposal:

- The Pond is held in the hand.
- The user tilts the Pond toward one of four areas of personal growth: critical thinking, emotional support, self understanding, decision making.
- The user presses the bezel down to select the area. This starts the wordstream.
- The wordstream shows first-person reflections one word at a time.
- A progress bar tracks the session. Once enough depth is reached, the user can choose to end.
- The Garden is the hub. It shows one plant per area, and each plant flourishes or wilts with the care given to that area.

## What the v1 code does today

1. The Pond boots to an on-screen Springboard. The user taps the Pond app icon.
2. One of five fixed prompts appears one word at a time (`PROMPTS` in `v1/garden/bloom_garden/session.py`).
3. The user taps `Start speaking`, talks, then taps `I'm done` (`record_clicked` in `v1/pond/firmware/main/main.cpp`).
4. The Garden transcribes the audio with whisper.cpp. Gemma writes one first-person question of at most 25 words. Gemma receives only the last transcript (`chat_payload` in `inference.py`).
5. The new question appears and the loop returns to step 3.

There is no tilt, no bezel input, no area selection, no progress bar, no ending, and nothing is stored between sessions.

## What the paper says

The paper uses Dewey's five prerequisites for reflective thinking to explain how generative AI weakens thinking, and what a design can do about it.

| Dewey's prerequisite | How generative AI weakens it | What the paper suggests |
| --- | --- | --- |
| 1. A state of perplexity, confusion or doubt | Immediate, synthesized answers remove the moments of dissonance that start further thinking | Let people highlight parts of a response; add a small friction before the output can be used |
| 2. Prior experience and knowledge to draw on | Not discussed directly | Show related prior knowledge when new information arrives (schemas, knowledge graph) |
| 3. Active, persistent consideration of ideas | Chatbots favor surface-level discussion | Help people connect related ideas to what they already know |
| 4. Suspended judgment and tolerance for uncertainty | Models align with existing beliefs and sound confident | Metacognitive prompts and provocations that raise alternative views |
| 5. Connecting and evaluating related ideas | Structured, coherent answers create an illusion of understanding | Same as 3 and 4 |

The paper also says that effort at the beginning matters (productive struggle, cognitive endurance), so AI involvement should be minimal at the start and increase gradually. It uses Bloom's revised taxonomy (remember, understand, apply, analyze, evaluate, create) to show which cognitive steps people skip when a model does the work.

## Proposed flow

### Before the session

**1. The person notices the Garden while at home.** The Garden sits in the room and shows its plants. One plant has yellowing leaves. The Garden sends no notification, makes no sound and shows no prompt. The person decides alone whether to start. The paper's first prerequisite is that reflection begins from the person's own doubt, and it names notifications and information overload as a strain on attention.

**2. The person picks the Pond up from the Garden.** They hold it in one hand. The Pond wakes when lifted and shows the four areas around the edge of the round screen. It shows no words yet. The person starts the session; the device does not.

### Beginning

**3. The person tilts the Pond to choose an area, then presses the bezel.** The Pond highlights the area under the tilt and the bezel press locks it. The Pond then shows one casual opening line, the same every day: "So, how was my day?" The opening is deliberately light. It does not ask for a difficult topic and it does not ask a generated question.

**4. The person talks about their day before the Pond asks anything.** They press the bezel and talk the way they would to a friend. There is no right topic and no minimum length. They press the bezel again when done. While they talk, the Pond shows particles and no text. This step exists because the paper says AI involvement should be minimal at the start: the first material of the session comes from the person, and the first generated question comes only after it.

### Reflecting

**5. The Pond stays quiet for a few seconds before it shows a question.** The Pond shows particles for at least 10 seconds. During this time the Garden transcribes the audio, adds the turn to the session history and writes one question. The paper says immediate answers remove the moment in which a person notices what they have just said, and recommends a small, deliberate friction before output.

**6. The person reads the question and presses the bezel on the word that stands out.** The question is one first-person sentence of at most 25 words, shown one word at a time, as in v1. The word the person marks stays lit and is sent to the Garden as the focus of the next question. This is the point where the casual talk turns into one specific thing to think about, and the person chooses it. The paper suggests letting people highlight parts of a response to find the gap in their own understanding and to feed that back to the system.

**7. The person keeps talking about that same word for two or three turns.** Steps 5 to 7 repeat. Gemma receives the whole session and the marked word, not just the last transcript, so the questions stay on one subject. The questions climb in order: what happened, why it happened, whether the person's judgment was right. The progress bar fills according to the depth reached, not the time spent. This addresses the third prerequisite (persistent consideration) and follows Bloom's levels of understand, analyze and evaluate.

**8. The Pond asks, once, whether the opposite could be true.** The question is "What if the opposite were true about what I just said?" The person says the opposite case out loud. At no point does the Pond agree, praise, summarize or give advice. The paper says models tend to align with what a person already believes and to sound confident, which discourages suspended judgment, and it recommends metacognitive prompts and provocations.

**9. The Pond shows what the person said last time and asks how today compares.** The Pond shows the person's own closing sentence from the previous session in this area, word for word, followed by "How does today fit with that?" It is not an AI summary. This addresses the second and fifth prerequisites: drawing on prior experience and connecting related ideas.

### Ending

**10. The person ends the session by saying one sentence of their own.** When the progress bar is full, the person can choose to end by holding the bezel down. The Pond asks "In one sentence, what do I now think?" The person says it. The Pond replays that sentence as a wordstream and the Garden stores it word for word. The device generates no summary. In Bloom's taxonomy the top level is to create, and here the person does it. The paper warns that a coherent AI summary makes people believe they understood more than they did.

**11. The person puts the Pond back and the Garden plant changes.** The plant for the chosen area grows according to the depth reached in the session. The Garden shows no text and no score. This step is not from the paper. It is our proposal that feedback should reflect the person's own effort rather than AI output.

## Code changes this would need

| Step | Change | Where |
| --- | --- | --- |
| 1 | Garden plant display | New |
| 2 | Wake on lift | Pond firmware, IMU |
| 3 | Tilt selection, bezel press, four areas, one fixed opening line | Pond firmware; `session.py` |
| 4 | Bezel press replaces the on-screen record buttons | `main.cpp` |
| 5 | Minimum delay between receiving the response and showing it | `turn.cpp` |
| 6 | Record which word was showing at the bezel press; send it with the turn | `wordstream.cpp`; turn request |
| 7 | Session history, question level per turn, progress bar | `session.py`, `inference.py`; Pond UI |
| 8 | Rules in the system prompt; one opposite-view turn | `inference.py` |
| 9 | Store one closing sentence per area per session | Garden, new local storage |
| 10 | End state; replay of the closing sentence | `session.py`; Pond UI |
| 11 | Plant growth from session depth | Garden display |

## Placeholders that come from neither source

- The 10-second wait in step 5 and the two or three turns in step 7.
- The opening line "So, how was my day?"
- Pressing the bezel to mark a word. The paper only says "highlight parts of responses".
- Holding the bezel to end, and waking the Pond on lift.
- Linking to the previous session with a single closing sentence. The paper's example is a knowledge graph.

## Open questions

- Is the Jetson's inference time already long enough to serve as the wait in step 5? This needs measuring.
- Can a person press the bezel on the right word at wordstream speed? The alternative is to choose from the full sentence after the stream ends.
- Can Gemma 4 E2B Q4 follow an instruction to raise the question level each turn? How many turns fit in a 2048-token context?
- Should the opposite-view question be skippable on an emotionally hard day, especially in the emotional support area?
- How do the four areas change the questions? This proposal uses the same flow for all four.
- The paper studies novices who are learning (students doing coding and writing tasks). BLOOM is for self-reflection. Dewey's prerequisites apply directly, but the experiments the paper cites are not direct evidence for BLOOM.
