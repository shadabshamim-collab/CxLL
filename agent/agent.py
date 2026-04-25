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
    elevenlabs,
    google as google_plugin,
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
    486: "missed_call",
    480: "missed_call",
    408: "missed_call",
    503: "missed_call",
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


# 4-value taxonomy for primary-number-verification campaign
_VERIFICATION_DISPOSITIONS = {"Verified", "Not Verified", "Callback Requested", "Missed Call"}


async def _analyze_verification_call(transcript: str, user_name: str) -> dict:
    """Classify a verification call into exactly one of 4 dispositions.

    Tie-breaker rules (from campaign spec §6.3):
    - Confirmed name but asks to call later → Verified (confirmation wins)
    - "haan bol raha hoon" without explicit name → Verified (implicit confirmation)
    - Connected but cut off before confirmation → Not Verified
    - Answering machine / IVR → Missed Call
    """
    api_key = os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key or not transcript.strip():
        return {"disposition": "Missed Call", "outcome": "no_answer", "sentiment": "neutral"}

    base_url = "https://api.groq.com/openai/v1" if os.getenv("GROQ_API_KEY") else "https://api.openai.com/v1"
    model = "llama-3.1-8b-instant" if os.getenv("GROQ_API_KEY") else "gpt-4o-mini"

    system_msg = (
        f"You are classifying a number-verification call made on behalf of Ring (formerly Kissht). "
        f"The agent was calling to confirm whether the person is '{user_name}'. "
        "Return JSON with exactly these fields:\n"
        "  \"disposition\": one of [\"Verified\", \"Not Verified\", \"Callback Requested\", \"Missed Call\"]\n"
        "  \"sentiment\": one of [\"positive\", \"neutral\", \"negative\", \"frustrated\"]\n"
        "  \"summary\": 1-2 sentence human-readable summary of what happened in the call\n"
        "  \"notes\": optional free text under 80 chars (e.g. callback time if requested)\n\n"
        "Tie-breaker rules:\n"
        f"- Person confirms being '{user_name}' but asks to call later → Verified\n"
        "- Person says 'haan' / 'yes' / 'bol' without naming themselves, in response to a "
        f"  greeting that already named '{user_name}' → Verified (implicit)\n"
        "- Call connected but ended before any confirmation → Not Verified\n"
        "- No answer / voicemail / IVR / auto-reject → Missed Call\n"
        "- Person explicitly denies being the named individual → Not Verified"
    )

    try:
        async with aiohttp.ClientSession() as http:
            resp = await http.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model,
                    "temperature": 0.0,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system_msg},
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
                parsed = json.loads(result["choices"][0]["message"]["content"])
                disp = parsed.get("disposition", "")
                if disp not in _VERIFICATION_DISPOSITIONS:
                    logger.warning(
                        f"Verification LLM returned unknown disposition '{disp}' — defaulting to 'Not Verified'"
                    )
                    parsed["disposition"] = "Not Verified"
                parsed["outcome"] = disp.lower().replace(" ", "_")
                return parsed
    except Exception as e:
        logger.warning(f"Verification call analysis failed: {e}")
    return {"disposition": "Not Verified", "outcome": "not_verified", "sentiment": "neutral"}


async def _post_call_summary(
    session: AgentSession,
    room_name: str,
    duration: int,
    campaign_id: str = None,
    user_name: str = "",
    sheets_meta: str = None,
):
    """Extract transcript from session, analyze it, and send summary to dashboard."""
    try:
        transcript_lines = []
        try:
            # session.history is the correct attribute (session.chat_ctx does not exist)
            history = getattr(session, 'history', None)
            if history:
                for item in (getattr(history, 'messages', None) or getattr(history, 'items', [])):
                    role = getattr(item, 'role', None)
                    content = getattr(item, 'content', None)
                    if not role or not content or role not in ('user', 'assistant'):
                        continue
                    speaker = "Customer" if role == "user" else "Agent"
                    # content is list[ImageContent | AudioContent | Instructions | str]
                    if isinstance(content, list):
                        text = ' '.join(c for c in content if isinstance(c, str)).strip()
                    else:
                        text = str(content).strip()
                    if text:
                        transcript_lines.append(f"{speaker}: {text}")
        except Exception as e:
            logger.warning(f"Could not extract transcript from session.history: {e}")

        turn_count = len(transcript_lines) // 2 if transcript_lines else 0  # Divide by 2: agent + customer pairs
        avg_turn_latency_ms = int((duration * 1000 / turn_count)) if turn_count > 0 else 0

        summary = {
            "duration_seconds": duration,
            "turn_count": turn_count,
            "avg_turn_latency_ms": avg_turn_latency_ms,
            "campaign_id": campaign_id,
        }

        if transcript_lines:
            transcript_text = "\n".join(transcript_lines[-30:])

            # Route to verification-specific classifier for K2R campaign
            if campaign_id == "primary-number-verification":
                analysis = await _analyze_verification_call(transcript_text, user_name or "the customer")
            else:
                analysis = await _analyze_call_transcript(transcript_text)

            if analysis:
                summary.update(analysis)
            # Send full transcript to dashboard (written to Col K in Google Sheet)
            summary["transcript"] = transcript_text
            # Keep preview for backward compat with non-sheet call logs
            summary["transcript_preview"] = transcript_text[:500]
        else:
            # No transcript — treat as missed call for verification, no_conversation otherwise
            if campaign_id == "primary-number-verification":
                summary["disposition"] = "Missed Call"
                summary["outcome"] = "missed_call"
                summary["summary"] = "Missed call — no conversation recorded."
            else:
                summary["outcome"] = "no_conversation"

        if sheets_meta:
            summary["sheets_meta"] = sheets_meta
        await _notify_dashboard(room_name, "summary", **summary)
        logger.info(f"Post-call summary sent for {room_name}: {summary.get('outcome', 'unknown')}")

    except Exception as e:
        logger.warning(f"Post-call summary failed: {e}")


def _build_stt(config_provider: str = None):
    provider = (config_provider or os.getenv("STT_PROVIDER", config.STT_PROVIDER)).lower()

    if provider == "elevenlabs":
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            logger.warning("ElevenLabs STT requested but ELEVENLABS_API_KEY not set — falling back to Deepgram")
        else:
            model_id = os.getenv("ELEVENLABS_STT_MODEL", config.ELEVENLABS_STT_MODEL)
            lang = os.getenv("ELEVENLABS_STT_LANGUAGE", config.ELEVENLABS_STT_LANGUAGE) or None
            logger.info(f"Using ElevenLabs STT (model: {model_id})")
            return elevenlabs.STT(api_key=api_key, model_id=model_id, language_code=lang)

    if provider == "deepgram-nova3":
        logger.info("Using Deepgram STT (model: nova-3)")
        return deepgram.STT(model="nova-3", language=config.STT_LANGUAGE)

    logger.info(f"Using Deepgram STT (model: {config.STT_MODEL})")
    return deepgram.STT(model=config.STT_MODEL, language=config.STT_LANGUAGE)


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

    if provider == "elevenlabs":
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            logger.warning("ElevenLabs TTS requested but ELEVENLABS_API_KEY not set — falling back to OpenAI")
        else:
            voice_id = config_voice or os.getenv("ELEVENLABS_VOICE_ID", config.ELEVENLABS_VOICE_ID)
            model = os.getenv("ELEVENLABS_TTS_MODEL", config.ELEVENLABS_TTS_MODEL)
            lang = os.getenv("ELEVENLABS_LANGUAGE", config.ELEVENLABS_LANGUAGE) or None
            logger.info(f"Using ElevenLabs TTS (voice: {voice_id}, model: {model})")
            return elevenlabs.TTS(api_key=api_key, voice_id=voice_id, model=model, language=lang)

    # Auto-detect Google Cloud TTS by voice name pattern (e.g. hi-IN-Wavenet-A, en-US-Neural2-F)
    if provider == "google" or (config_voice and re.match(r"^[a-z]{2}-[A-Z]{2}-", config_voice)):
        sa_json = os.getenv("GOOGLE_TTS_CREDENTIALS_JSON") or os.getenv("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON")
        if not sa_json:
            logger.warning("Google Cloud TTS requested but GOOGLE_TTS_CREDENTIALS_JSON not set — falling back to OpenAI")
        else:
            try:
                sa_info = json.loads(sa_json)
                voice_name = config_voice or "hi-IN-Wavenet-A"
                lang = "-".join(voice_name.split("-")[:2])  # "hi-IN-Wavenet-A" → "hi-IN"
                logger.info(f"Using Google Cloud TTS (voice: {voice_name}, lang: {lang})")
                return google_plugin.TTS(
                    credentials_info=sa_info,
                    language=lang,
                    voice_name=voice_name,
                )
            except Exception as e:
                logger.error(f"Google TTS init failed: {e} — falling back to OpenAI")

    logger.info(f"Using OpenAI TTS (Voice: {config_voice})")
    model = os.getenv("OPENAI_TTS_MODEL", "tts-1")
    voice = config_voice or os.getenv("OPENAI_TTS_VOICE", config.DEFAULT_TTS_VOICE)
    return openai.TTS(model=model, voice=voice)


def _build_llm(config_provider: str = None):
    provider = (config_provider or os.getenv("LLM_PROVIDER", config.DEFAULT_LLM_PROVIDER)).lower()

    if provider == "groq":
        logger.info(f"Using Groq LLM (model: {os.getenv('GROQ_MODEL', config.GROQ_MODEL)})")
        return openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model=os.getenv("GROQ_MODEL", config.GROQ_MODEL),
            temperature=float(os.getenv("GROQ_TEMPERATURE", str(config.GROQ_TEMPERATURE))),
            max_tokens=120,
        )

    if provider == "groq-fast":
        logger.info("Using Groq LLM (fast: llama-3.1-8b-instant)")
        return openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model="llama-3.1-8b-instant",
            temperature=0.2,
            max_tokens=120,
        )

    if provider == "openai-mini":
        logger.info("Using OpenAI LLM (gpt-4o-mini)")
        return openai.LLM(model="gpt-4o-mini", max_tokens=120)

    if provider in ("gemini", "google"):
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            logger.warning("Gemini requested but GOOGLE_API_KEY not set — falling back to Groq")
            return openai.LLM(
                base_url="https://api.groq.com/openai/v1",
                api_key=os.getenv("GROQ_API_KEY"),
                model=config.GROQ_MODEL,
                temperature=config.GROQ_TEMPERATURE,
                max_tokens=120,
            )
        model = os.getenv("GEMINI_MODEL", config.GEMINI_MODEL)
        logger.info(f"Using Google Gemini (model: {model})")
        # Use native google plugin (not OpenAI-compat) — avoids "contents not specified" warmup error.
        # Disable thinking on 2.5 family for low-latency voice (saves 100+ tokens of internal reasoning).
        from google.genai.types import ThinkingConfig
        return google_plugin.LLM(
            model=model,
            api_key=api_key,
            temperature=0.3,
            thinking_config=ThinkingConfig(thinking_budget=0),
        )

    logger.info("Using OpenAI LLM (gpt-4o)")
    return openai.LLM(model=config.DEFAULT_LLM_MODEL, max_tokens=120)



class TransferFunctions(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: str = None, session: AgentSession = None):
        super().__init__(tools=[])
        self.ctx = ctx
        self.phone_number = phone_number
        self.session = session

    def _user_has_spoken(self) -> bool:
        """Check if the customer has produced at least one transcript turn."""
        if not self.session:
            return False
        history = getattr(self.session, 'history', None)
        if not history:
            return False
        items = getattr(history, 'messages', None) or getattr(history, 'items', []) or []
        try:
            return any(getattr(m, 'role', None) == 'user' for m in items)
        except Exception:
            return False

    @llm.function_tool(description="Transfer the call to a human support agent. ONLY use after the customer has explicitly asked for the support team, or payment difficulty is unresolved after multiple attempts, or customer has a complaint. NEVER call this in the first turn or before greeting the customer. The destination MUST be a valid phone number in E.164 format (e.g. +918001234567) — never use generic strings like 'support' or 'support_team'.")
    async def transfer_call(self, destination: Optional[str] = None):
        # Guard 1: only transfer after the customer has spoken
        if not self._user_has_spoken():
            logger.warning(f"transfer_call blocked: customer hasn't spoken yet (destination={destination!r})")
            return "Cannot transfer yet — please greet the customer first and wait for their response. Continue the conversation normally."

        # Guard 2: validate destination is a real phone number, not a hallucinated string
        def _looks_like_phone(s: str) -> bool:
            if not s: return False
            s = s.strip()
            if s.startswith('+') or s.startswith('tel:') or s.startswith('sip:'):
                return True
            digits = s.replace('-','').replace(' ','').replace('(','').replace(')','')
            return digits.isdigit() and len(digits) >= 7

        if destination and not _looks_like_phone(destination):
            logger.warning(f"transfer_call: rejecting invalid destination {destination!r} — using configured default")
            destination = None

        if destination is None:
            destination = config.DEFAULT_TRANSFER_NUMBER
            if not destination:
                logger.warning("transfer_call: no DEFAULT_TRANSFER_NUMBER configured")
                return "Cannot transfer — no support team number is configured. Please continue helping the customer yourself or close the call politely."

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


async def _push_transcript_update(room_name: str, session: AgentSession, campaign_id: str = None):
    """Push live transcript update to dashboard (for real-time monitor)."""
    try:
        transcript_lines = []
        history = getattr(session, 'history', None)
        if history:
            for item in (getattr(history, 'messages', None) or getattr(history, 'items', [])):
                role = getattr(item, 'role', None)
                content = getattr(item, 'content', None)
                if not role or not content or role not in ('user', 'assistant'):
                    continue
                speaker = "Customer" if role == "user" else "Agent"
                if isinstance(content, list):
                    text = ' '.join(c for c in content if isinstance(c, str)).strip()
                else:
                    text = str(content).strip()
                if text:
                    transcript_lines.append(f"{speaker}: {text}")

        turn_count = len(transcript_lines) // 2 if transcript_lines else 0
        transcript_text = "\n".join(transcript_lines[-30:])
        await _notify_dashboard(
            room_name,
            "transcript_update",
            turn_count=turn_count,
            transcript=transcript_text,
            campaign_id=campaign_id,
        )
    except Exception as e:
        logger.debug(f"Transcript update failed: {e}")


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

    # Apply {{user_name}} substitution here in the agent as the authoritative step.
    # The cron may have already done this, but re-applying is harmless (idempotent).
    # For UI-dispatched calls where the cron didn't run, this is the only substitution.
    user_name_raw = config_dict.get("user_name", "")
    if user_name_raw:
        system_prompt    = system_prompt.replace("{{user_name}}", user_name_raw)
        initial_greeting = initial_greeting.replace("{{user_name}}", user_name_raw)
        fallback_greet   = fallback_greet.replace("{{user_name}}", user_name_raw)
        logger.info(f"Substituted {{{{user_name}}}} → '{user_name_raw}' in all prompts")
    elif "{{user_name}}" in system_prompt or "{{user_name}}" in initial_greeting:
        logger.warning(
            "{{user_name}} placeholder present in prompts but user_name is not set in metadata. "
            "Dispatch this campaign via the Google Sheet tab (sheets-sync) to ensure the name is injected."
        )

    if config_dict.get("system_prompt"):
        logger.info(f"Using campaign prompt ({len(system_prompt)} chars)")
    else:
        logger.info("Using default prompt from config.py")

    # ── Tuned VAD for Indian telecom networks ──
    # min_silence_duration: can be overridden per-campaign (default 0.4s for fast turn-taking).
    # Set higher (0.6-0.8) only if customers are getting cut off mid-pause.
    min_silence_dur = float(config_dict.get("vad_min_silence_duration", 0.4))
    session = AgentSession(
        vad=silero.VAD.load(
            min_speech_duration=0.05,
            min_silence_duration=min_silence_dur,
            activation_threshold=0.5,
            prefix_padding_duration=0.2,
        ),
        stt=_build_stt(config_dict.get("stt_provider") or config_dict.get("model_provider")),
        llm=_build_llm(config_dict.get("model_provider")),
        tts=_build_tts(config_dict.get("tts_provider") or config_dict.get("model_provider"), config_dict.get("voice_id")),
    )

    # TransferFunctions needs session reference to check user_has_spoken before transferring
    fnc_ctx = TransferFunctions(ctx, phone_number, session=session)

    call_start_time = None
    campaign_id = config_dict.get("campaign_id")
    user_name = config_dict.get("user_name", "")
    sheets_meta_raw = config_dict.get("sheets_meta")  # JSON string; echoed in all webhook calls

    @ctx.room.on("disconnected")
    def _on_disconnect():
        transcript_update_stop.set()
        duration = int(time.time() - call_start_time) if call_start_time else 0
        extra = {"duration_seconds": duration}
        if sheets_meta_raw:
            extra["sheets_meta"] = sheets_meta_raw
        asyncio.ensure_future(_notify_dashboard(ctx.room.name, "completed", **extra))
        asyncio.ensure_future(_post_call_summary(session, ctx.room.name, duration, campaign_id, user_name, sheets_meta_raw))

    # Background task to stream transcript updates every 2 seconds
    transcript_update_stop = asyncio.Event()

    async def _stream_transcript_updates():
        while not transcript_update_stop.is_set():
            await _push_transcript_update(ctx.room.name, session, campaign_id)
            try:
                await asyncio.wait_for(transcript_update_stop.wait(), timeout=2.0)
                break
            except asyncio.TimeoutError:
                pass

    await session.start(
        room=ctx.room,
        agent=OutboundAssistant(tools=list(fnc_ctx.function_tools.values()), instructions=system_prompt),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVCTelephony(),
        ),
    )

    # Start background transcript streaming
    asyncio.create_task(_stream_transcript_updates())

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
                clean_error = f"SIP {sip_status}: {reason}"
                logger.info(f"SIP {sip_status} for {phone_number} ({reason}) — will retry")
                retry_payload = dict(
                    error=clean_error,
                    sip_status=sip_status,
                    reason=reason,
                    phone_number=phone_number,
                    campaign_id=campaign_id,
                    retry_delay_seconds=RETRY_DELAYS.get(sip_status, 300),
                )
                if sheets_meta_raw:
                    retry_payload["sheets_meta"] = sheets_meta_raw
                await _notify_dashboard(ctx.room.name, "retry", **retry_payload)
            else:
                logger.error(f"Outbound call failed for {phone_number}: SIP {sip_status or 'unknown'}")
                failed_payload = {"error": error_str}
                if sheets_meta_raw:
                    failed_payload["sheets_meta"] = sheets_meta_raw
                await _notify_dashboard(ctx.room.name, "failed", **failed_payload)
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
