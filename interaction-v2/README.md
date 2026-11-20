# Interaction v2: BLOOM user journey

Status: proposal. No code has been changed.

- Paper: Singh, Taneja, Guan, Ghosh. *Protecting Human Cognition in the Age of AI*. Tools for Thought at CHI '25. arXiv:2502.12447v3.
- Product concept: <https://mapprojectoffice.com/work/cognitive-bloom/>
- User journey map (FigJam): <https://www.figma.com/board/qF1ZWOxy3qd5NY6LT0sHfc>

The design drops the four fixed areas (tilt selection) and clicking on flowing
words, and moves to a **text (ASCII) tree on the Garden touchscreen** and a
**loop of deep breathing and Socratic questioning**. It resolves the hardware
and UX bottlenecks of v1.

## Three core UX bottlenecks the v2 pivot resolves

- **Removes motor-cognitive overload.** Removes the fatigue of the earlier
  approach, where the person had to time a bezel press on a question passing
  quickly as a speed-reading wordstream. Instead the roles are separated: the
  person first picks a **keyword or nuance extracted from their own speech**,
  then reads the Socratic question the Pond asks with full attention.
- **Turns system latency into ritual.** The roughly 10 seconds of silence taken
  by speech-to-text and LLM inference becomes **deep breathing in time with the
  expansion and contraction of the particles**, not a boring loading state. It
  is a physical and cognitive buffer in which the person steps back from the raw
  material they just poured out and looks at it objectively.
- **From fixed categories to organic context (branches).** Instead of fitting
  thoughts into four predefined categories, the person chooses on a single text
  tree whether to **continue yesterday's thought (an existing branch) or sprout
  a new one (a new branch)**. This builds a long-term trajectory of thinking.

## Updated user journey map (BLOOM v2)

| Phase | Step | User action | System response (Garden & Pond) | Design intent and technical point |
| --- | --- | --- | --- | --- |
| **BEFORE** | **1. Explore the tree and choose a branch** | Looks at the **text (ASCII) tree** shown on the Garden's touchscreen, then touches the branch they were continuing yesterday, or touches **Create new branch** | Plays a text-growing animation from the selected branch. At the same time the docked **Pond glows**, inviting the person to pick it up | A self-initiated start with no notification (Dewey prerequisite 1). Continuity of thought (existing branch) and a fresh start (new branch) are separated spatially |
| **BEGIN** | **2. Pick up the Pond and get a tailored opening** | Picks up the glowing Pond | The Pond screen activates and shows a casual first question matched to the selected branch.<br>• **New branch:** fixed script (*"How was my day today?"*)<br>• **Existing branch:** question based on the earlier context (*"That [topic] I talked about yesterday, how was it today?"*) | Minimizes early AI involvement, but connects the previous session's context naturally only when the branch is an existing one |
| | **3. Speak raw thoughts (raw material)** | Talks freely about what happened today and what they think, as if talking to a friend (the turn ends with a bezel click or silence detection) | While recording, only the particles react. It listens without showing text and without interrupting | Before any judgment or summary, the person fully produces the first raw material themselves |
| **REFLECT**<br>*(repeats for 2-3 turns)* | **4. Breathing and background analysis** | Holding the Pond, takes short deep breaths in time with the particle movement and turns over what they just said | **Pond:** particles expand and contract as if breathing in and out (about 8-10 seconds)<br>**Garden:** transcribes the speech, then extracts the key keywords and nuances from what the person said | Turns technical processing time into cognitive room. Prevents the break in thinking that an immediate answer causes |
| | **5. Choose a keyword or nuance** | From the few keywords and nuances shown on screen, touches/selects the one they most want to dig into right now | Fixes the selected keyword as this session's **Focus** and syncs it to the Garden | The AI does not set the topic. The person points directly at the key gap in their own words |
| | **6. Socratic question and depth measurement** | Reads the question flowing as a wordstream and keeps answering in depth for 2-3 turns, centered on the selected keyword | Gemma receives the whole conversation plus the Focus and generates a Socratic question and a thinking-depth score (`depth %`) at the same time. The progress bar rises by the **depth ratio**, not by time | Dewey 3 (persistent consideration) + Bloom (analyze, evaluate). The backend controls progress with JSON (`{question, depth_percent}`) |
| | **7. Counter-question on the opposite possibility (once)** | In response to *"What if the exact opposite of what I just said were true?"*, assumes the opposite case out loud | Once per session, throws a counterfactual question that shakes the existing belief. Praise, agreement, advice and summary are excluded entirely | Dewey 4 (suspended judgment) and blocking the LLM's sycophancy bias |
| | **8. Compare a past sentence with today** *(existing branch only)* | Sees the original closing sentence they left in the last session, and says how today's thinking continues from it or has changed | *"Last time I said this: '(previous closing sentence, verbatim)'. How does today's thinking connect with it?"* (shown verbatim, not as an AI summary) | Dewey 2 and 5 (connecting past experience with the present). The retrospective effect is strongest on an existing branch that continues from yesterday |
| **END** | **9. Self-directed one-sentence summary** | When the progress bar reaches 100%, long-presses the bezel to choose to end, and says the thought they arrived at today in **one sentence of their own** | Shows *"If I put it in one sentence, what am I thinking right now?"*, then reflects the person's sentence back once as a wordstream and stores it verbatim | The person performs Bloom's top level (Create) directly. Prevents the "illusion of understanding" that arises when AI summarizes for them |
| | **10. Dock the Pond and the text tree grows** | Puts the Pond back down on the Garden | On the Garden's **text (ASCII) tree**, that branch actually grows by the depth of thinking reached (no score or evaluation text) | Feedback in which the person's reflective effort itself, not an AI evaluation, accumulates as a living text landscape |

## Details to settle together for the `cb-2` implementation

Fixing these three before designing the Gemma prompt and the front end (Garden
touchscreen, Pond round screen) will make development much smoother.

1. **Gemma's structured response schema (depth-based progress).** If the LLM
   returns not only the question text each turn but
   `{"depth_score": 45, "question": "..."}`, with the logical specificity and
   self-reflection depth of the conversation so far as a number from 0 to 100,
   the structure of "handing over a progress number together with the generated
   question" can be implemented exactly.
2. **Conditional execution of step 8 (past sentence comparison).** On the first
   day of a new branch (Day 1) there is no previous sentence to load, so step 8
   is skipped automatically and the flow goes to step 9 (today's one-sentence
   summary). Step 8 activates only when the person touches an existing branch to
   continue it, so the flow does not break.
3. **Data mapping of the text (ASCII) tree.** Decide whether the text fragments
   that make up the tree on the Garden screen are decorative symbols, or whether
   the **verbatim one-sentence closings (step 9) and keywords from each session
   accumulate as the actual text that forms the branches and leaves**. The
   second makes a much more narrative interface.
