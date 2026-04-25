"""
TC-05 — Disposition classification for the primary-number-verification campaign.

Strategy: aioresponses intercepts the real aiohttp POST to Groq so the full
parsing pipeline (_analyze_verification_call) is exercised without a live
network call.  _analyze_verification_call is NEVER mocked directly.
"""

import pytest
from aioresponses import aioresponses as aioresponses_ctx

from agent import _analyze_verification_call, _post_call_summary
from tests.fixtures.groq_responses import (
    CALLBACK_REQUESTED,
    EXTRA_FIELDS,
    INVALID_ENUM,
    NOT_VERIFIED_ABSENT,
    NOT_VERIFIED_WRONG_NUMBER,
    VERIFIED_DIRECT,
    VERIFIED_ENGLISH,
    VERIFIED_IMPLICIT,
    VERIFIED_WITH_CALLBACK,
    VOICEMAIL,
)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _make_transcript(*lines: str) -> str:
    """Join transcript lines into a single string."""
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# TC-051  Direct Hindi confirmation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc051_verified_direct_hindi():
    """'Haan, main Shadab bol raha hoon.' → Verified / positive."""
    transcript = _make_transcript(
        "Agent: Namaste, kya main Shadab ji se baat kar sakta hoon?",
        "Customer: Haan, main Shadab bol raha hoon.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=VERIFIED_DIRECT, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Verified"
    assert result["sentiment"] == "positive"


# ---------------------------------------------------------------------------
# TC-052  English confirmation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc052_verified_english():
    """'Yes, speaking.' → Verified."""
    transcript = _make_transcript(
        "Agent: May I speak with Shadab please?",
        "Customer: Yes, speaking.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=VERIFIED_ENGLISH, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Verified"


# ---------------------------------------------------------------------------
# TC-053  Implicit Hindi confirmation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc053_verified_implicit():
    """'Haan bolo.' (in context of agent naming Shadab) → Verified (implicit)."""
    transcript = _make_transcript(
        "Agent: Shadab ji, namaskar. Main Ring ki taraf se bol raha hoon.",
        "Customer: Haan bolo.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=VERIFIED_IMPLICIT, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Verified"


# ---------------------------------------------------------------------------
# TC-054  Wrong number
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc054_not_verified_wrong_number():
    """'Nahi, galat number.' → Not Verified."""
    transcript = _make_transcript(
        "Agent: Kya aap Shadab hain?",
        "Customer: Nahi, galat number.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=NOT_VERIFIED_WRONG_NUMBER, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Not Verified"


# ---------------------------------------------------------------------------
# TC-055  Person not present
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc055_not_verified_absent():
    """'Woh abhi nahi hai.' → Not Verified."""
    transcript = _make_transcript(
        "Agent: Kya Shadab ji available hain?",
        "Customer: Woh abhi nahi hai.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=NOT_VERIFIED_ABSENT, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Not Verified"


# ---------------------------------------------------------------------------
# TC-056  Callback requested
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc056_callback_requested():
    """'Kal call karna.' → Callback Requested."""
    transcript = _make_transcript(
        "Agent: Shadab ji, Ring ki taraf se call hai.",
        "Customer: Kal call karna.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=CALLBACK_REQUESTED, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Callback Requested"


# ---------------------------------------------------------------------------
# TC-057  Tie-breaker: confirmed identity + callback request → Verified wins
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc057_verified_with_callback_tiebreaker():
    """Confirmed identity but asked for callback — Verified wins (§6.3 tie-breaker)."""
    transcript = _make_transcript(
        "Agent: Kya aap Shadab hain?",
        "Customer: Haan main hoon, but abhi busy hoon, shaam ko call karna.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=VERIFIED_WITH_CALLBACK, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Verified"


# ---------------------------------------------------------------------------
# TC-058  Empty transcript — no HTTP call should be made
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc058_empty_transcript_fallback():
    """Empty transcript → immediate fallback dict, no Groq HTTP call fired."""
    # aioresponses context with no registered routes; any unexpected HTTP call
    # would raise ConnectionError and fail the test.
    with aioresponses_ctx():
        result = await _analyze_verification_call("", "Shadab")

    assert result["disposition"] == "Missed Call"
    assert result["outcome"] == "no_answer"
    assert result["sentiment"] == "neutral"


# ---------------------------------------------------------------------------
# TC-059  Voicemail
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc059_voicemail():
    """Voicemail transcript → Missed Call."""
    transcript = _make_transcript(
        "Customer: Please leave a message after the beep.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=VOICEMAIL, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Missed Call"


# ---------------------------------------------------------------------------
# TC-0510  LLM returns invalid disposition enum → normalised to Not Verified
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc0510_invalid_enum_normalised(caplog):
    """'Probably Verified' is not in the valid set → normalised to 'Not Verified', warning logged."""
    import logging

    transcript = _make_transcript(
        "Agent: Are you Shadab?",
        "Customer: Yeah I think so.",
    )
    with caplog.at_level(logging.WARNING, logger="outbound-agent"):
        with aioresponses_ctx() as m:
            m.post(GROQ_URL, payload=INVALID_ENUM, repeat=True)
            result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Not Verified", (
        "Invalid enum should be normalised to 'Not Verified'"
    )
    # Function must not raise
    assert "disposition" in result
    # A warning should have been logged about the unknown disposition
    assert any("Probably Verified" in r.message for r in caplog.records), (
        "Expected a warning log mentioning the invalid disposition value"
    )


# ---------------------------------------------------------------------------
# TC-0511  LLM returns extra unexpected fields — only known fields used
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc0511_extra_fields_ignored():
    """Extra LLM response fields (confidence, language) don't cause a crash; disposition parsed OK."""
    transcript = _make_transcript(
        "Agent: Kya aap Shadab hain?",
        "Customer: Haan, main hoon.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, payload=EXTRA_FIELDS, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Verified"
    # Extra fields may be present (agent passes parsed dict through) — that's fine,
    # but the function must not raise an exception.


# ---------------------------------------------------------------------------
# TC-0512  Groq HTTP 503 → error fallback dict
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tc0512_groq_503_fallback():
    """Groq returns 503 → function falls back to Not Verified / neutral without raising."""
    transcript = _make_transcript(
        "Agent: Kya aap Shadab hain?",
        "Customer: Haan.",
    )
    with aioresponses_ctx() as m:
        m.post(GROQ_URL, status=503, repeat=True)
        result = await _analyze_verification_call(transcript, "Shadab")

    assert result["disposition"] == "Not Verified"
    assert result["sentiment"] == "neutral"
