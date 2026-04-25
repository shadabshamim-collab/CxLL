"""
TC-04 — SIP status parsing, retry-code table, and _post_call_summary
empty-transcript path.
"""

import pytest
from unittest.mock import AsyncMock, patch

from agent import (
    RETRYABLE_SIP_CODES,
    RETRY_DELAYS,
    _parse_sip_status,
    _post_call_summary,
)


# ---------------------------------------------------------------------------
# _parse_sip_status — unit tests (synchronous)
# ---------------------------------------------------------------------------


class TestParseSipStatus:
    def test_tc0412_no_answer_480(self):
        """Standard TwirpError string with SIP 480."""
        assert _parse_sip_status(
            "twirp error: sip status: 480: Temporarily Unavailable"
        ) == 480

    def test_tc0413_busy_486(self):
        """INVITE failure string with SIP 486."""
        assert _parse_sip_status("INVITE failed: sip status: 486: Busy Here") == 486

    def test_tc0414_invalid_number_404(self):
        """Minimal sip status: prefix with SIP 404."""
        assert _parse_sip_status("sip status: 404: Not Found") == 404

    def test_tc_sip_unknown_returns_zero(self):
        """Unrelated error string → 0."""
        assert _parse_sip_status("connection reset") == 0

    def test_tc_sip_variant_underscore_with_quotes(self):
        """sip_status_code: '486' variant (underscore + quoted value)."""
        assert _parse_sip_status("sip_status_code: '486'") == 486

    def test_empty_string_returns_zero(self):
        assert _parse_sip_status("") == 0

    def test_sip_status_503(self):
        assert _parse_sip_status("sip status: 503: Service Unavailable") == 503

    def test_sip_status_603(self):
        assert _parse_sip_status("sip status: 603: Declined") == 603


# ---------------------------------------------------------------------------
# RETRYABLE_SIP_CODES table
# ---------------------------------------------------------------------------


class TestRetryableSipCodes:
    def test_tc0413b_486_is_missed_call(self):
        """SIP 486 (busy) maps to missed_call."""
        assert RETRYABLE_SIP_CODES[486] == "missed_call"

    def test_tc_declined_603(self):
        """SIP 603 maps to declined."""
        assert RETRYABLE_SIP_CODES[603] == "declined"

    def test_tc_declined_retry_delay_zero(self):
        """Declined calls should not be auto-retried (delay == 0)."""
        assert RETRY_DELAYS[603] == 0

    def test_480_is_missed_call(self):
        assert RETRYABLE_SIP_CODES[480] == "missed_call"

    def test_408_is_missed_call(self):
        assert RETRYABLE_SIP_CODES[408] == "missed_call"

    def test_503_is_missed_call(self):
        assert RETRYABLE_SIP_CODES[503] == "missed_call"


# ---------------------------------------------------------------------------
# _post_call_summary — empty transcript + verification campaign
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_call_summary_empty_transcript_verification(mock_session):
    """
    _post_call_summary with no transcript lines and campaign_id=
    'primary-number-verification' must notify the dashboard with
    status='summary', disposition='Missed Call', outcome='missed_call'.
    """
    session = mock_session([])  # no transcript lines

    with patch("agent._notify_dashboard", new_callable=AsyncMock) as mock_notify:
        await _post_call_summary(
            session=session,
            room_name="test-room-001",
            duration=0,
            campaign_id="primary-number-verification",
            user_name="Shadab",
        )

    mock_notify.assert_called_once()
    call_args, call_kwargs = mock_notify.call_args

    # Positional args: room_name, status
    assert call_args[0] == "test-room-001"
    assert call_args[1] == "summary"

    # Keyword payload must include Missed Call / missed_call
    assert call_kwargs.get("disposition") == "Missed Call", (
        f"Expected disposition='Missed Call', got {call_kwargs.get('disposition')!r}"
    )
    assert call_kwargs.get("outcome") == "missed_call", (
        f"Expected outcome='missed_call', got {call_kwargs.get('outcome')!r}"
    )


@pytest.mark.asyncio
async def test_post_call_summary_empty_transcript_non_verification(mock_session):
    """
    For a non-verification campaign with no transcript, outcome should be
    'no_conversation' (not Missed Call).
    """
    session = mock_session([])

    with patch("agent._notify_dashboard", new_callable=AsyncMock) as mock_notify:
        await _post_call_summary(
            session=session,
            room_name="test-room-002",
            duration=0,
            campaign_id="collection-reminder",
            user_name="",
        )

    mock_notify.assert_called_once()
    _, call_kwargs = mock_notify.call_args
    assert call_kwargs.get("outcome") == "no_conversation"


@pytest.mark.asyncio
async def test_post_call_summary_passes_sheets_meta(mock_session):
    """sheets_meta is forwarded verbatim to the dashboard webhook."""
    session = mock_session([])
    meta = '{"row": 5, "sheet": "Leads"}'

    with patch("agent._notify_dashboard", new_callable=AsyncMock) as mock_notify:
        await _post_call_summary(
            session=session,
            room_name="test-room-003",
            duration=42,
            campaign_id="primary-number-verification",
            sheets_meta=meta,
        )

    _, call_kwargs = mock_notify.call_args
    assert call_kwargs.get("sheets_meta") == meta
    assert call_kwargs.get("duration_seconds") == 42
