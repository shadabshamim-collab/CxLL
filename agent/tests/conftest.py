import pytest
import os
import sys

# Add agent directory to path so `import agent` and `import config` work.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    """Pin all environment variables for every test.

    This prevents the agent's own .env from polluting test runs and ensures
    each test starts from a clean, deterministic environment.
    """
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key-fixture")
    monkeypatch.setenv("OPENAI_API_KEY", "")  # prefer Groq in all tests
    monkeypatch.setenv("DASHBOARD_WEBHOOK_URL", "http://localhost:3000/api/calls/webhook")
    # Avoid certifi import path issues on CI machines
    monkeypatch.setenv("SSL_CERT_FILE", "/etc/ssl/cert.pem")


@pytest.fixture
def mock_session():
    """Factory that returns a lightweight fake AgentSession.

    Usage::

        def test_something(mock_session):
            session = mock_session(["Customer: Haan main hoon.", "Agent: Thank you."])
    """

    class MockChatItem:
        def __init__(self, role: str, content: str):
            self.role = role
            self.content = content

    class MockChatCtx:
        def __init__(self, items):
            self.items = items

    class MockSession:
        def __init__(self, transcript_lines=None):
            items = []
            for line in transcript_lines or []:
                role, text = line.split(": ", 1)
                items.append(
                    MockChatItem(
                        role="user" if role == "Customer" else "assistant",
                        content=text,
                    )
                )
            self.chat_ctx = MockChatCtx(items)

    return MockSession
