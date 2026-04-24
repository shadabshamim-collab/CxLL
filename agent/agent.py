import os
import certifi

# Fix for macOS SSL Certificate errors - MUST be before other imports
os.environ['SSL_CERT_FILE'] = certifi.where()

import logging
import json
import time
import asyncio
import aiohttp
from dotenv import load_dotenv

from livekit import agents, api
from livekit.agents import AgentSession, Agent, RoomInputOptions, AutoSubscribe
from livekit.plugins import (
    openai,
    cartesia,
    deepgram,
    noise_cancellation,
    silero,
    sarvam,
)
from livekit.agents import llm
from typing import Annotated, Optional

# Load environment variables from agent/.env
_agent_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_agent_dir, ".env"))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("outbound-agent")

import config

DASHBOARD_WEBHOOK_URL = os.getenv("DASHBOARD_WEBHOOK_URL", "http://localhost:3000/api/calls/webhook")

RETRYABLE_SIP_CODES = {
    486: "busy",
    480: "no_answer",
    408: "timeout",
    503: "service_unavailable",
    603: "declined",
}

RETRY_DELAYS = {
    486: 300,   # Busy — retry in 5 min
    480: 600,   # No answer — retry in 10 min
    408: 120,   # Timeout — retry in 2 min
    503: 60,    # Service unavailable — retry in 1 min
    603: 0,     # Declined — don't auto-retry
}

import re

def _parse_sip_status(error_str: str) -> int:
    """Extract SIP status code from LiveKit TwirpError string."""
    match = re.search(r"sip[_ ]status[_ ]code['\"]?\s*[:=]\s*['\"]?(\d{3})", error_str)
    if match:
        return int(match.group(1))
    match = re.search(r"sip status:\s*(\d{3})", error_str)
    if match:
        return int(match.group(1))
    return 0


async def _notify_dashboard(room_name: str, status: str, **kwargs):
    try:
        payload = {"room_name": room_name, "status": status, **kwargs}
        async with aiohttp.ClientSession() as session:
            async with session.post(DASHBOARD_WEBHOOK_URL, json=payload, timeout=aiohttp.ClientTimeout(total=5)):
                pass
    except Exception as e:
        logger.warning(f"Failed to notify dashboard: {e}")


def _build_fallback_llm():
    """Lightweight LLM for post-call analysis (higher rate limits than primary)."""
    if os.getenv("GROQ_API_KEY"):
        return openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model="llama-3.1-8b-instant",
            temperature=0.2,
        )
    if os.getenv("OPENAI_API_KEY"):
        return openai.LLM(model="gpt-4o-mini", temperature=0.2)
    return None


async def _analyze_call_transcript(transcript: str) -> dict:
    """Analyze call transcript via direct API call to Groq/OpenAI."""
    api_key = os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key or not transcript.strip():
        return {}

    base_url = "https://api.groq.com/openai/v1" if os.getenv("GROQ_API_KEY") else "https://api.openai.com/v1"
    model = "llama-3.1-8b-instant" if os.getenv("GROQ_API_KEY") else "gpt-4o-mini"

    try:
        async with aiohttp.ClientSession() as http:
            resp = await http.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model,
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "Analyze this call transcript. Return JSON with exactly these fields: "
                                '"outcome" (one of: payment_committed, callback_scheduled, transferred, '
                                'refused, no_answer, incomplete), '
                                '"disposition" (one-line summary under 100 chars), '
                                '"sentiment" (one of: positive, neutral, negative, frustrated)'
                            ),
                        },
                        {"role": "user", "content": transcript},
                    ],
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=10),
            )
            if resp.status == 200:
                result = await resp.json()
                content = result["choices"][0]["message"]["content"]
                return json.loads(content)
    except Exception as e:
        logger.warning(f"Call transcript analysis failed: {e}")
    return {}


async def _post_call_summary(session: AgentSession, room_name: str, duration: int, campaign_id: str = None):
    """Extract transcript from session, analyze it, and send summary to dashboard."""
    try:
        transcript_lines = []
        try:
            if hasattr(session, 'chat_ctx') and session.chat_ctx:
                for item in session.chat_ctx.items:
                    role = getattr(item, 'role', None)
                    content = getattr(item, 'content', None)
                    if role and content and role in ('user', 'assistant'):
                        speaker = "Customer" if role == "user" else "Agent"
                        text = content if isinstance(content, str) else str(content)
                        if text.strip():
                            transcript_lines.append(f"{speaker}: {text}")
        except Exception as e:
            logger.debug(f"Could not extract chat context: {e}")

        summary = {
            "duration_seconds": duration,
            "turn_count": len(transcript_lines),
            "campaign_id": campaign_id,
        }

        if transcript_lines:
            transcript = "\n".join(transcript_lines[-30:])
            analysis = await _analyze_call_transcript(transcript)
            if analysis:
                summary.update(analysis)
            summary["transcript_preview"] = transcript[:500]
        else:
            summary["outcome"] = "no_conversation"

        await _notify_dashboard(room_name, "summary", **summary)
        logger.info(f"Post-call summary sent for {room_name}: {summary.get('outcome', 'unknown')}")

    except Exception as e:
        logger.warning(f"Post-call summary failed: {e}")


def _build_tts(config_provider: str = None, config_voice: str = None):
    provider = (config_provider or os.getenv("TTS_PROVIDER", config.DEFAULT_TTS_PROVIDER)).lower()

    sarvam_voices = ["anushka", "manisha", "vidya", "arya", "abhilash", "karun", "hitesh"]
    deepgram_voices = ["aura-asteria-en", "aura-luna-en", "aura-orion-en", "aura-arcas-en"]
    if config_voice in sarvam_voices:
        provider = "sarvam"
    elif config_voice in deepgram_voices:
        provider = "deepgram"

    if provider == "cartesia":
        logger.info("Using Cartesia TTS")
        model = os.getenv("CARTESIA_TTS_MODEL", config.CARTESIA_MODEL)
        voice = os.getenv("CARTESIA_TTS_VOICE", config.CARTESIA_VOICE)
        return cartesia.TTS(model=model, voice=voice)

    if provider == "sarvam":
        logger.info(f"Using Sarvam TTS (Voice: {config_voice})")
        model = os.getenv("SARVAM_TTS_MODEL", config.SARVAM_MODEL)
        voice = config_voice or os.getenv("SARVAM_VOICE", "anushka")
        language = os.getenv("SARVAM_LANGUAGE", config.SARVAM_LANGUAGE)
        return sarvam.TTS(model=model, speaker=voice, target_language_code=language)

    if provider == "deepgram":
        model = config_voice if config_voice and config_voice.startswith("aura-") else os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en")
        logger.info(f"Using Deepgram TTS (Voice: {model})")
        return deepgram.TTS(model=model)

    logger.info(f"Using OpenAI TTS (Voice: {config_voice})")
    model = os.getenv("OPENAI_TTS_MODEL", "tts-1")
    voice = config_voice or os.getenv("OPENAI_TTS_VOICE", config.DEFAULT_TTS_VOICE)
    return openai.TTS(model=model, voice=voice)


def _build_llm(config_provider: str = None):
    provider = (config_provider or os.getenv("LLM_PROVIDER", config.DEFAULT_LLM_PROVIDER)).lower()

    if provider == "groq":
        logger.info("Using Groq LLM")
        return openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model=os.getenv("GROQ_MODEL", config.GROQ_MODEL),
            temperature=float(os.getenv("GROQ_TEMPERATURE", str(config.GROQ_TEMPERATURE))),
        )

    logger.info("Using OpenAI LLM")
    return openai.LLM(model=config.DEFAULT_LLM_MODEL)



class TransferFunctions(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: str = None):
        super().__init__(tools=[])
        self.ctx = ctx
        self.phone_number = phone_number

    @llm.function_tool(description="Transfer the call to a human support agent. Only use when customer explicitly asks for support team, or payment difficulty is unresolved, or customer has a complaint.")
    async def transfer_call(self, destination: Optional[str] = None):
        if destination is None:
            destination = config.DEFAULT_TRANSFER_NUMBER
            if not destination:
                 return "Error: No default transfer number configured."
        if "@" not in destination:
            if config.SIP_DOMAIN:
                clean_dest = destination.replace("tel:", "").replace("sip:", "")
                destination = f"sip:{clean_dest}@{config.SIP_DOMAIN}"
            else:
                if not destination.startswith("tel:") and not destination.startswith("sip:"):
                     destination = f"tel:{destination}"
        elif not destination.startswith("sip:"):
             destination = f"sip:{destination}"

        logger.info(f"Transferring call to {destination}")

        participant_identity = None
        if self.phone_number:
            participant_identity = f"sip_{self.phone_number}"
        else:
            for p in self.ctx.room.remote_participants.values():
                participant_identity = p.identity
                break

        if not participant_identity:
            logger.error("Could not determine participant identity for transfer")
            return "Failed to transfer: could not identify the caller."

        try:
            logger.info(f"Transferring participant {participant_identity} to {destination}")
            await self.ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=self.ctx.room.name,
                    participant_identity=participant_identity,
                    transfer_to=destination,
                    play_dialtone=False
                )
            )
            return "Transfer initiated successfully."
        except Exception as e:
            logger.error(f"Transfer failed: {e}")
            return f"Error executing transfer: {e}"


class OutboundAssistant(Agent):
    def __init__(self, tools: list, instructions: str = None) -> None:
        super().__init__(
            instructions=instructions or config.SYSTEM_PROMPT,
            tools=tools,
        )


async def _safe_generate_reply(session: AgentSession, instructions: str, retries: int = 2):
    """Generate reply with retry on failure. Falls back to static TTS greeting if LLM is down."""
    for attempt in range(retries):
        try:
            await session.generate_reply(instructions=instructions)
            return True
        except Exception as e:
            logger.error(f"generate_reply attempt {attempt + 1} failed: {e}")
            if attempt < retries - 1:
                await asyncio.sleep(1.0)

    logger.error("All generate_reply attempts failed — speaking static fallback greeting via TTS")
    try:
        fallback_text = "Hello, namaskar! Main Anushka bol rahi hoon XYZ Finance ki taraf se. Abhi hamare system mein thodi technical difficulty aa rahi hai. Kya main aapko thodi der mein dobara call kar sakti hoon?"
        await session.say(fallback_text)
    except Exception as e:
        logger.error(f"Even TTS fallback failed: {e}")
    return False


async def entrypoint(ctx: agents.JobContext):
    logger.info(f"Connecting to room: {ctx.room.name}")

    # ── CRITICAL: Connect to the room first ──
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Connected to room")

    # Parse metadata
    phone_number = None
    config_dict = {}

    try:
        if ctx.job.metadata:
            data = json.loads(ctx.job.metadata)
            phone_number = data.get("phone_number")
            config_dict = data
    except Exception:
        pass

    try:
        if ctx.room.metadata:
            data = json.loads(ctx.room.metadata)
            if data.get("phone_number"):
                phone_number = data.get("phone_number")
            config_dict.update(data)
    except Exception:
        logger.warning("No valid JSON metadata found in Room.")

    system_prompt = config_dict.get("system_prompt") or config.SYSTEM_PROMPT
    initial_greeting = config_dict.get("initial_greeting") or config.INITIAL_GREETING
    fallback_greet = config_dict.get("fallback_greeting") or config.fallback_greeting

    if config_dict.get("system_prompt"):
        logger.info(f"Using campaign prompt ({len(system_prompt)} chars)")
    else:
        logger.info("Using default prompt from config.py")

    fnc_ctx = TransferFunctions(ctx, phone_number)

    # ── Tuned VAD for Indian telecom networks ──
    # Higher min_silence_duration: don't cut off customers mid-pause
    # Lower activation_threshold: catch softer speech on phone networks
    # More prefix padding: don't clip the start of utterances
    session = AgentSession(
        vad=silero.VAD.load(
            min_speech_duration=0.05,
            min_silence_duration=0.8,
            activation_threshold=0.45,
            prefix_padding_duration=0.3,
        ),
        stt=deepgram.STT(model=config.STT_MODEL, language=config.STT_LANGUAGE),
        llm=_build_llm(config_dict.get("model_provider")),
        tts=_build_tts(config_dict.get("model_provider"), config_dict.get("voice_id")),
    )

    call_start_time = None
    campaign_id = config_dict.get("campaign_id")

    @ctx.room.on("disconnected")
    def _on_disconnect():
        duration = int(time.time() - call_start_time) if call_start_time else 0
        asyncio.ensure_future(_notify_dashboard(ctx.room.name, "completed", duration_seconds=duration))
        asyncio.ensure_future(_post_call_summary(session, ctx.room.name, duration, campaign_id))

    await session.start(
        room=ctx.room,
        agent=OutboundAssistant(tools=list(fnc_ctx.function_tools.values()), instructions=system_prompt),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVCTelephony(),
        ),
    )

    # ── Dial out or greet ──
    should_dial = False
    if phone_number:
        user_already_here = False
        for p in ctx.room.remote_participants.values():
            if f"sip_{phone_number}" in p.identity or "sip_" in p.identity:
                user_already_here = True
                break

        if not user_already_here:
            should_dial = True
            logger.info("User not in room. Agent will initiate dial-out.")
        else:
            logger.info("User already in room (Dashboard dispatched).")

    if should_dial:
        logger.info(f"Initiating outbound SIP call to {phone_number}...")
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=config.SIP_TRUNK_ID,
                    sip_call_to=phone_number,
                    participant_identity=f"sip_{phone_number}",
                    wait_until_answered=True,
                )
            )
            logger.info("Call answered! Agent is now listening.")
            if call_start_time is None:
                call_start_time = time.time()
            await _notify_dashboard(ctx.room.name, "connected")

            # Brief pause for audio pipeline to stabilize
            await asyncio.sleep(1.0)
            await _safe_generate_reply(session, initial_greeting)

        except Exception as e:
            error_str = str(e)
            sip_status = _parse_sip_status(error_str)
            if sip_status in RETRYABLE_SIP_CODES:
                reason = RETRYABLE_SIP_CODES[sip_status]
                logger.warning(f"SIP {sip_status} ({reason}) for {phone_number} — requesting retry")
                await _notify_dashboard(
                    ctx.room.name, "retry",
                    error=error_str,
                    sip_status=sip_status,
                    reason=reason,
                    phone_number=phone_number,
                    campaign_id=campaign_id,
                    retry_delay_seconds=RETRY_DELAYS.get(sip_status, 300),
                )
            else:
                logger.error(f"Failed to place outbound call: {e}")
                await _notify_dashboard(ctx.room.name, "failed", error=error_str)
            ctx.shutdown()
    else:
        logger.info("Greeting user already in room...")
        await asyncio.sleep(0.5)
        await _safe_generate_reply(session, fallback_greet)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="outbound-caller",
        )
    )
