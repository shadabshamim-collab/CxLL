"""
Conversation simulator — LLM plays the customer, another LLM plays the agent.
Produces a multi-turn transcript for the judge to evaluate.
"""

import json
import ssl
import certifi
import aiohttp

SSL_CTX = ssl.create_default_context(cafile=certifi.where())


async def _chat(
    messages: list[dict],
    api_key: str,
    base_url: str,
    model: str,
    temperature: float = 0.4,
) -> str:
    """Single LLM chat completion call."""
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=SSL_CTX)) as session:
        resp = await session.post(
            f"{base_url}/chat/completions",
            json={
                "model": model,
                "temperature": temperature,
                "messages": messages,
                "max_tokens": 300,
            },
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=aiohttp.ClientTimeout(total=15),
        )
        if resp.status != 200:
            error = await resp.text()
            raise RuntimeError(f"API error {resp.status}: {error}")

        result = await resp.json()
        return result["choices"][0]["message"]["content"]


async def simulate_conversation(
    agent_system_prompt: str,
    agent_greeting: str,
    persona: dict,
    api_key: str,
    base_url: str = "https://api.groq.com/openai/v1",
    agent_model: str = "llama-3.3-70b-versatile",
    customer_model: str = "llama-3.1-8b-instant",
) -> list[dict]:
    """
    Simulate a multi-turn phone conversation.

    Returns a list of messages: [{"role": "assistant"|"user", "content": "..."}]
    """
    max_turns = persona.get("max_turns", 8)

    # Conversation history for both sides
    agent_messages = [
        {"role": "system", "content": agent_system_prompt},
    ]
    customer_messages = [
        {
            "role": "system",
            "content": (
                f"{persona['system_prompt']}\n\n"
                "IMPORTANT RULES:\n"
                "- You are on a phone call. Keep responses short (1-2 sentences max).\n"
                "- Respond naturally as a real person would on a call.\n"
                "- If the conversation has reached a natural end (goodbye, bye, etc.), "
                "respond with exactly '[END]'.\n"
                "- Never break character. Never mention you are an AI."
            ),
        },
    ]

    transcript = []

    # Agent opens with greeting
    agent_greeting_response = await _chat(
        agent_messages + [{"role": "user", "content": agent_greeting}],
        api_key, base_url, agent_model,
    )
    agent_messages.append({"role": "user", "content": agent_greeting})
    agent_messages.append({"role": "assistant", "content": agent_greeting_response})
    transcript.append({"role": "assistant", "content": agent_greeting_response})

    for turn in range(max_turns):
        # Customer responds to agent
        customer_messages.append({"role": "user", "content": agent_greeting_response})
        customer_response = await _chat(
            customer_messages, api_key, base_url, customer_model, temperature=0.6,
        )
        customer_messages.append({"role": "assistant", "content": customer_response})

        # Check for natural end
        if "[END]" in customer_response:
            customer_response = customer_response.replace("[END]", "").strip()
            if customer_response:
                transcript.append({"role": "user", "content": customer_response})
            break

        transcript.append({"role": "user", "content": customer_response})

        # Agent responds to customer
        agent_messages.append({"role": "user", "content": customer_response})
        agent_greeting_response = await _chat(
            agent_messages, api_key, base_url, agent_model,
        )
        agent_messages.append({"role": "assistant", "content": agent_greeting_response})
        transcript.append({"role": "assistant", "content": agent_greeting_response})

        # Check if agent closed the call
        close_signals = ["have a great day", "aapka din achha rahe", "goodbye", "bye", "thank you for your patience"]
        if any(signal in agent_greeting_response.lower() for signal in close_signals):
            break

    return transcript
