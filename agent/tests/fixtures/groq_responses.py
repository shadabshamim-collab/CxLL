"""
Realistic recorded Groq API response fixtures for TC-05 disposition classification tests.

Each fixture is a full chat.completion response body as returned by
https://api.groq.com/openai/v1/chat/completions with model llama-3.1-8b-instant.
"""

import json


def _groq_response(content_dict: dict) -> dict:
    """Build a realistic Groq chat completion response."""
    return {
        "id": "chatcmpl-test-fixture",
        "object": "chat.completion",
        "created": 1714000000,
        "model": "llama-3.1-8b-instant",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": json.dumps(content_dict),
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 120,
            "completion_tokens": 30,
            "total_tokens": 150,
        },
    }


# TC-051: Direct Hindi confirmation
VERIFIED_DIRECT = _groq_response(
    {"disposition": "Verified", "sentiment": "positive", "notes": ""}
)

# TC-052: English confirmation
VERIFIED_ENGLISH = _groq_response(
    {"disposition": "Verified", "sentiment": "positive", "notes": ""}
)

# TC-053: Implicit Hindi confirmation ("haan bolo")
VERIFIED_IMPLICIT = _groq_response(
    {"disposition": "Verified", "sentiment": "neutral", "notes": "Implicit confirmation"}
)

# TC-054: Wrong number
NOT_VERIFIED_WRONG_NUMBER = _groq_response(
    {"disposition": "Not Verified", "sentiment": "neutral", "notes": "Wrong number"}
)

# TC-055: Person not present
NOT_VERIFIED_ABSENT = _groq_response(
    {"disposition": "Not Verified", "sentiment": "neutral", "notes": "Person not available"}
)

# TC-056: Callback requested without identity confirmation
CALLBACK_REQUESTED = _groq_response(
    {"disposition": "Callback Requested", "sentiment": "neutral", "notes": "Requested callback"}
)

# TC-057: Confirmed identity but asked for callback — tie-breaker: Verified wins
VERIFIED_WITH_CALLBACK = _groq_response(
    {
        "disposition": "Verified",
        "sentiment": "positive",
        "notes": "Confirmed identity, requested callback at 6 PM",
    }
)

# TC-059: Voicemail / answering machine detected
VOICEMAIL = _groq_response(
    {"disposition": "Missed Call", "sentiment": "neutral", "notes": "Voicemail detected"}
)

# TC-0510: LLM returns an invalid disposition enum value
INVALID_ENUM = _groq_response(
    {"disposition": "Probably Verified", "sentiment": "positive", "notes": ""}
)

# TC-0511: LLM returns extra unexpected fields — only disposition/sentiment/notes should be used
EXTRA_FIELDS = _groq_response(
    {
        "disposition": "Verified",
        "sentiment": "positive",
        "notes": "",
        "confidence": 0.95,
        "language": "hinglish",
    }
)
