"""Pure ritual transition used by Garden and its single test."""

from dataclasses import dataclass


PROMPTS = (
    "Let's look back on my day to understand myself better.",
    "What was the most challenging part of my day, and what did I learn from it?",
    "Think back to a moment today that made me smile or feel grateful.",
    "If I could do one thing differently today, what would it be and why?",
    "What small victory did I achieve today that I'm proud of?",
)


@dataclass(frozen=True)
class Turn:
    prompt_index: int
    prompt: str
    transcript: str = ""
    audio_bytes: int = 0

    def to_dict(self) -> dict[str, str | int]:
        return {
            "prompt_index": self.prompt_index,
            "prompt": self.prompt,
            "transcript": self.transcript,
            "audio_bytes": self.audio_bytes,
        }


def opening_turn(prompt_index: int = 0) -> Turn:
    index = prompt_index % len(PROMPTS)
    return Turn(index, PROMPTS[index])


def next_turn(
    prompt_index: int, transcript: str, audio_bytes: int, generated_prompt: str = ""
) -> Turn:
    if audio_bytes < 0:
        raise ValueError("audio_bytes cannot be negative")
    index = (prompt_index + 1) % len(PROMPTS)
    prompt = generated_prompt.strip() or PROMPTS[index]
    return Turn(index, prompt, transcript.strip(), audio_bytes)
