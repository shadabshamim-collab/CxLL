# LiveKit AI Voice Agent

A production-ready AI voice agent for outbound calls using **LiveKit**, **Deepgram**, **Groq**, and **Sarvam AI**.
Built for loan collection reminders with a Next.js dashboard for call dispatching.

---

## Demo Video

<video src="https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mp4" controls width="100%"></video>

> The demo shows the full flow: dispatching a call from the dashboard, the AI agent greeting the customer in Hinglish, handling the EMI reminder conversation, and presenting payment options.
>
> If the video doesn't play inline: **[Download Demo Video (.mp4)](https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mp4)** | **[Original Recording (.mov)](https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mov)**

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SYSTEM OVERVIEW                              │
│                                                                     │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────┐  │
│  │   Dashboard   │────>│   LiveKit Cloud   │────>│  Voice Agent   │  │
│  │  (Next.js)    │     │   (WebRTC/SIP)    │     │  (Python)      │  │
│  └──────────────┘     └────────┬─────────┘     └───────┬────────┘  │
│                                │                        │           │
│                                v                        v           │
│                       ┌────────────────┐    ┌─────────────────────┐ │
│                       │  Vobiz (PSTN)  │    │   AI Services       │ │
│                       │  SIP Trunking  │    │  ┌───────────────┐  │ │
│                       └───────┬────────┘    │  │ Groq (LLM)    │  │ │
│                               │             │  │ Llama 3.3 70B │  │ │
│                               v             │  └───────────────┘  │ │
│                       ┌────────────────┐    │  ┌───────────────┐  │ │
│                       │  Customer's    │    │  │ Deepgram      │  │ │
│                       │  Phone         │    │  │ STT + TTS     │  │ │
│                       └────────────────┘    │  └───────────────┘  │ │
│                                             │  ┌───────────────┐  │ │
│                                             │  │ Sarvam AI     │  │ │
│                                             │  │ Indian TTS    │  │ │
│                                             │  └───────────────┘  │ │
│                                             └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Call Flow

```
Dashboard/CLI                LiveKit Cloud              Voice Agent               Customer
     │                            │                          │                       │
     │  1. Dispatch Agent         │                          │                       │
     │ ──────────────────────>    │                          │                       │
     │                            │  2. Assign Job           │                       │
     │                            │ ───────────────────────> │                       │
     │                            │                          │                       │
     │                            │  3. Create SIP Call      │                       │
     │                            │ <─────────────────────── │                       │
     │                            │                          │                       │
     │                            │         4. SIP INVITE (via Vobiz)               │
     │                            │ ─────────────────────────────────────────────>   │
     │                            │                          │                       │
     │                            │         5. Call Answered                         │
     │                            │ <─────────────────────────────────────────────   │
     │                            │                          │                       │
     │                            │  6. Audio Stream (WebRTC)│                       │
     │                            │ <─────────────────────── │ ──────────────────>   │
     │                            │                          │                       │
     │                            │        7. Conversation Loop                      │
     │                            │        ┌─────────────────┼───────────────────┐   │
     │                            │        │ Customer speaks │                   │   │
     │                            │        │     ──> Deepgram STT ──> Text      │   │
     │                            │        │     ──> Groq LLM ──> Response      │   │
     │                            │        │     ──> Deepgram/Sarvam TTS ──>    │   │
     │                            │        │                 │    Agent speaks   │   │
     │                            │        └─────────────────┼───────────────────┘   │
     │                            │                          │                       │
```

### Component Responsibilities

| Component | Technology | Role |
|-----------|-----------|------|
| **Voice Agent** | Python + LiveKit Agents SDK | Manages call lifecycle, runs AI conversation loop |
| **STT (Speech-to-Text)** | Deepgram Nova-2 | Converts customer's speech to text in real-time |
| **LLM (Brain)** | Groq - Llama 3.3 70B | Generates contextual responses based on system prompt |
| **TTS (Text-to-Speech)** | Deepgram Aura / Sarvam Bulbul v2 | Converts agent's text responses to natural speech |
| **VAD (Voice Activity)** | Silero | Detects when customer starts/stops speaking |
| **SIP Trunking** | Vobiz | Bridges WebRTC audio to the PSTN phone network |
| **Dashboard** | Next.js + React + TailwindCSS | Web UI for dispatching calls and bulk dialing |
| **Noise Cancellation** | LiveKit BVC Telephony | Removes background noise from phone audio |

---

## Project Structure

```
LivekitAIVoice/
│
├── agent.py                  # Main voice agent — entry point, call lifecycle, AI pipeline
├── config.py                 # Prompt playground — system prompts, model/voice settings
├── make_call.py              # CLI script to initiate a single outbound call
├── create_trunk.py           # Create a new SIP trunk on LiveKit
├── setup_trunk.py            # Update existing SIP trunk credentials
├── list_trunks.py            # List all configured SIP trunks
├── requirements.txt          # Python dependencies
├── Dockerfile                # Docker container config
├── docker-compose.yml        # Docker Compose for deployment
├── .env.example              # Template for environment variables
├── .gitignore                # Git ignore rules
├── transfer_call.md          # SIP call transfer documentation
│
├── dashboard/                # Next.js Web Dashboard
│   ├── app/
│   │   ├── api/
│   │   │   ├── dispatch/
│   │   │   │   └── route.ts      # API: Single call dispatch
│   │   │   └── queue/
│   │   │       └── route.ts      # API: Bulk call queue
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Home page
│   │   └── globals.css           # Global styles
│   ├── components/
│   │   ├── CallDispatcher.tsx    # Single call dispatch UI
│   │   └── BulkDialer.tsx        # Bulk dialing UI
│   ├── lib/
│   │   └── server-utils.ts      # LiveKit SDK clients (SIP, Room, Agent)
│   ├── package.json
│   ├── tailwind.config.js
│   └── tsconfig.json
│
└── README.md
```

### Key Files Explained

| File | Purpose |
|------|---------|
| `agent.py` | Core voice agent. Handles room join, SIP dial-out, STT/LLM/TTS pipeline, and call transfer. |
| `config.py` | **Prompt playground.** Edit `SYSTEM_PROMPT`, `INITIAL_GREETING` to change agent behavior. Swap LLM/TTS providers here. |
| `dashboard/app/api/dispatch/route.ts` | Dispatches agent to a room via LiveKit Agent Dispatch API. |
| `dashboard/components/CallDispatcher.tsx` | Frontend form — phone number, prompt, model provider, and voice selection. |
| `dashboard/lib/server-utils.ts` | Initializes LiveKit server SDK clients (SipClient, AgentDispatchClient, RoomServiceClient). |

---

## Features

- **Multi-LLM Support**: Groq (Llama 3.3 70B) or OpenAI (GPT-4o)
- **Multi-TTS Support**: Deepgram (fastest), Sarvam AI (Indian voices), OpenAI, Cartesia
- **Hinglish Support**: Natural Hindi-English conversation via Sarvam AI voices
- **Call Transfer**: Transfer to human agents via SIP REFER
- **Dashboard**: Web UI for single and bulk call dispatching
- **Noise Cancellation**: LiveKit BVC telephony-grade noise removal
- **Docker Ready**: Dockerfile and docker-compose included

---

## Setup & Installation

### 1. Prerequisites
- Python 3.10+ (Recommended: 3.12)
- Node.js 18+ (for dashboard)
- [LiveKit Cloud](https://cloud.livekit.io/) account
- [Deepgram](https://deepgram.com/) API Key
- [Groq](https://groq.com/) API Key
- SIP Provider (e.g., Vobiz)

### 2. Clone & Install

```bash
git clone https://github.com/shadabshamim-collab/LivekitAIVoice.git
cd LivekitAIVoice

# Python setup
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Dashboard setup
cd dashboard && npm install && cd ..
```

### 3. Configure Environment

```bash
cp .env.example .env
# Fill in your API keys (LiveKit, Deepgram, Groq, Vobiz)
```

**Required Variables:**
| Variable | Description |
|----------|-------------|
| `LIVEKIT_URL` | Your LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `DEEPGRAM_API_KEY` | Deepgram API key for STT/TTS |
| `GROQ_API_KEY` | Groq API key for LLM |
| `VOBIZ_SIP_DOMAIN` | SIP server address |
| `VOBIZ_USERNAME` | SIP auth username |
| `VOBIZ_PASSWORD` | SIP auth password |
| `VOBIZ_OUTBOUND_NUMBER` | Caller ID number |
| `VOBIZ_SIP_TRUNK_ID` | LiveKit SIP trunk ID (created via `create_trunk.py`) |

### 4. Create SIP Trunk

```bash
python create_trunk.py
# Copy the Trunk ID and add to .env as VOBIZ_SIP_TRUNK_ID and OUTBOUND_TRUNK_ID
```

Also create `dashboard/.env`:
```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
VOBIZ_SIP_TRUNK_ID=your_trunk_id
```

---

## Usage

### Start the Agent
```bash
source venv/bin/activate
python agent.py start
```

### Make a Call (CLI)
```bash
python make_call.py --to +91XXXXXXXXXX
```

### Start the Dashboard
```bash
cd dashboard && npm run dev
# Open http://localhost:3000
```

---

## Customizing the Agent

Edit `config.py` to change the agent's personality, language, and behavior:

```python
# Change the system prompt
SYSTEM_PROMPT = """Your custom prompt here..."""

# Change the greeting
INITIAL_GREETING = """Your custom greeting..."""

# Switch LLM provider
DEFAULT_LLM_PROVIDER = "groq"  # or "openai"

# Switch TTS provider  
DEFAULT_TTS_PROVIDER = "deepgram"  # or "sarvam" or "openai"
```

After editing, restart the agent: `pkill -f "agent.py"; python agent.py start`

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `OPENAI_API_KEY not set` | Dashboard defaulting to OpenAI | Select "Groq" in model provider dropdown |
| `Speaker not compatible` | Invalid Sarvam voice name | Use: anushka, arya, abhilash, karun, hitesh |
| `402 Payment Required` | Vobiz account has no balance | Top up Vobiz calling credits |
| `SIP Trunk not configured` | Missing `VOBIZ_SIP_TRUNK_ID` in dashboard `.env` | Add trunk ID to `dashboard/.env` |
| `Address already in use :8081` | Another agent instance running | `pkill -f "python agent.py"` |
| `TypeAlias import error` | Python version < 3.10 | Install Python 3.10+ |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice Agent | Python 3.12, LiveKit Agents SDK 1.5.x |
| LLM | Groq (Llama 3.3 70B Versatile) |
| STT | Deepgram Nova-2 |
| TTS | Deepgram Aura, Sarvam Bulbul v2, OpenAI TTS-1 |
| VAD | Silero |
| Telephony | LiveKit SIP, Vobiz PSTN Gateway |
| Dashboard | Next.js 16, React 19, TailwindCSS 4 |
| Deployment | Docker, Docker Compose |
