# CxLL — AI Voice Agent Platform

A production-grade AI voice agent platform for high-volume outbound calling. Built on **LiveKit**, **Groq**, **Deepgram**, and **Sarvam AI** with a full-featured Next.js dashboard for campaign management, call orchestration, and real-time analytics.

Designed for **3,000+ concurrent calls** with auto-scaling on AWS EKS.

---

## Demo

<video src="https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mp4" controls width="100%"></video>

> **[Download Demo Video (.mp4)](https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mp4)** | **[Original Recording (.mov)](https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mov)**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CxLL PLATFORM ARCHITECTURE                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         DASHBOARD (Next.js)                         │    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │    │
│  │  │ Call       │  │ Bulk       │  │ Campaign   │  │ Analytics   │  │    │
│  │  │ Dispatcher │  │ Dialer     │  │ Manager    │  │ + Live Feed │  │    │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┬──────┘  │    │
│  │        └───────────┬───┘               │                │         │    │
│  │                    v                   v                v         │    │
│  │  ┌──────────────────────────────────────────────────────────────┐ │    │
│  │  │                    API Layer (Next.js Routes)                │ │    │
│  │  │  /api/dispatch  /api/queue  /api/campaigns  /api/calls      │ │    │
│  │  │  /api/health    /api/calls/stream (SSE)    /api/calls/webhook│ │    │
│  │  └────────┬─────────────┬──────────────────────────┬───────────┘ │    │
│  └───────────┼─────────────┼──────────────────────────┼─────────────┘    │
│              │             │                          │                   │
│              v             v                          v                   │
│  ┌───────────────┐  ┌──────────┐              ┌────────────┐             │
│  │  BullMQ Queue  │  │  Redis   │              │  Airtable  │             │
│  │  (Optional)    │◄─┤  State   │              │  / File    │             │
│  │  Rate Limit    │  │  Machine │              │  Storage   │             │
│  │  DND Enforce   │  │  Pub/Sub │              └────────────┘             │
│  │  Retry Logic   │  └──────────┘                                        │
│  └───────┬───────┘                                                       │
│          │                                                                │
│          v                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                       LIVEKIT CLOUD (WebRTC + SIP)                  │  │
│  │   Agent Dispatch API  ──>  Room Assignment  ──>  SIP Bridge         │  │
│  └──────────┬────────────────────────────────────────────┬─────────────┘  │
│             │                                            │                │
│             v                                            v                │
│  ┌──────────────────────────┐                ┌─────────────────────┐     │
│  │   VOICE AGENT (Python)   │                │  PSTN / Vobiz SIP   │     │
│  │  ┌────────────────────┐  │                │  Trunk Gateway      │     │
│  │  │ Deepgram STT       │  │                └──────────┬──────────┘     │
│  │  │ (Nova-2, Realtime) │  │                           │                │
│  │  ├────────────────────┤  │                           v                │
│  │  │ Groq LLM           │  │                ┌─────────────────────┐     │
│  │  │ (Llama 3.3 70B)    │  │                │  Customer's Phone   │     │
│  │  ├────────────────────┤  │                └─────────────────────┘     │
│  │  │ Sarvam / Deepgram  │  │                                            │
│  │  │ TTS (Indian voices)│  │                                            │
│  │  ├────────────────────┤  │                                            │
│  │  │ Silero VAD         │  │                                            │
│  │  │ (Tuned for Indian  │  │                                            │
│  │  │  telecom networks) │  │                                            │
│  │  ├────────────────────┤  │                                            │
│  │  │ Post-Call Analysis  │  │                                            │
│  │  │ (LLM-powered)      │  │                                            │
│  │  └────────────────────┘  │                                            │
│  └──────────────────────────┘                                            │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    KUBERNETES (AWS EKS)                              │  │
│  │   Agent Pods (HPA: 3→50)  │  Dashboard (2 replicas)  │  Redis      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Call Flow

```
 Dashboard                  API / Queue            LiveKit Cloud           Voice Agent             Customer
    │                           │                       │                      │                      │
    │  1. Select campaign       │                       │                      │                      │
    │     + phone number        │                       │                      │                      │
    │  ────────────────────>    │                       │                      │                      │
    │                           │                       │                      │                      │
    │           2. DND check + rate limit               │                      │                      │
    │              Enqueue or direct dispatch            │                      │                      │
    │                           │                       │                      │                      │
    │                           │  3. Agent Dispatch     │                      │                      │
    │                           │  (campaign metadata)   │                      │                      │
    │                           │ ─────────────────────> │                      │                      │
    │                           │                       │  4. Assign to agent  │                      │
    │                           │                       │ ────────────────────> │                      │
    │                           │                       │                      │                      │
    │                           │                       │  5. ctx.connect()    │                      │
    │                           │                       │ <──────────────────── │                      │
    │                           │                       │                      │                      │
    │                           │                       │  6. SIP INVITE       │                      │
    │                           │                       │  (via Vobiz trunk)   │                      │
    │                           │                       │ ─────────────────────────────────────────>  │
    │                           │                       │                      │                      │
    │                           │                       │              7. Call Answered               │
    │                           │                       │ <─────────────────────────────────────────  │
    │                           │                       │                      │                      │
    │                           │                       │     8. Audio Stream (WebRTC bidirectional)  │
    │                           │                       │ <────────────────────>│<──────────────────> │
    │                           │                       │                      │                      │
    │                           │                       │      9. Conversation Loop                   │
    │                           │                       │      ┌───────────────┼──────────────────┐   │
    │                           │                       │      │ Speech ─> Deepgram STT ─> Text  │   │
    │                           │                       │      │ Text ──> Groq LLM ──> Response  │   │
    │                           │                       │      │ Response ─> Sarvam TTS ─> Audio │   │
    │                           │                       │      └───────────────┼──────────────────┘   │
    │                           │                       │                      │                      │
    │                           │                       │     10. Call Ends     │                      │
    │                           │                       │ <──────────────────── │                      │
    │                           │                       │                      │                      │
    │  11. Webhook: completed   │  <──────────────────────────────────────────│                      │
    │  12. Webhook: summary     │  <──────────────────────────────────────────│                      │
    │      (LLM-analyzed outcome,│                      │                      │                      │
    │       sentiment, disposition)                     │                      │                      │
    │                           │                       │                      │                      │
    │  *** If SIP 486 (Busy) ***│                       │                      │                      │
    │  13. Webhook: retry       │                       │                      │                      │
    │      Auto-requeue in 5min │                       │                      │                      │
```

---

## Project Structure

```
CxLL/
│
├── agent/                        # Core Calling Engine (Python)
│   ├── agent.py                  #   Voice agent — call lifecycle, AI pipeline, retry logic
│   ├── config.py                 #   Prompt playground — system prompts, model/voice settings
│   ├── requirements.txt          #   Python dependencies
│   ├── Dockerfile                #   Agent container build
│   ├── .env                      #   LiveKit, Groq, Deepgram, SIP credentials
│   ├── .env.example              #   Environment variable template
│   ├── transfer_call.md          #   SIP transfer documentation
│   ├── campaigns/                #   Campaign JSON files (version-controlled prompts)
│   │   └── collection-reminder-test.json
│   └── tools/                    #   SIP utility scripts
│       ├── make_call.py          #     CLI: single outbound call
│       ├── create_trunk.py       #     Create SIP trunk on LiveKit
│       ├── setup_trunk.py        #     Update SIP trunk credentials
│       └── list_trunks.py        #     List configured SIP trunks
│
├── dashboard/                    # Web Dashboard (Next.js)
│   ├── app/
│   │   ├── page.tsx              #   Home — dispatch + bulk dialer + live activity
│   │   ├── layout.tsx            #   Nav bar (Calls | Campaigns | Analytics)
│   │   ├── campaigns/            #   Campaign CRUD pages (list, create, edit)
│   │   ├── analytics/            #   Call analytics with stats + history
│   │   └── api/
│   │       ├── dispatch/         #     Single call dispatch
│   │       ├── queue/            #     Bulk call queue
│   │       ├── campaigns/        #     Campaign CRUD API
│   │       ├── calls/            #     Call logs, stats, SSE stream, webhook
│   │       └── health/           #     K8s readiness/liveness probe
│   ├── components/
│   │   ├── CallDispatcher.tsx    #   Single call form with campaign selector
│   │   ├── BulkDialer.tsx        #   Bulk dialer with CSV upload
│   │   └── LiveActivity.tsx      #   Real-time call feed (SSE)
│   ├── lib/
│   │   ├── campaigns.ts          #   Campaign file I/O + versioning
│   │   ├── call-logger.ts        #   Airtable + file-based call logging
│   │   ├── call-state.ts         #   Redis-backed call state machine
│   │   ├── call-queue.ts         #   BullMQ queue with DND + rate limiting
│   │   ├── redis.ts              #   Redis client singleton
│   │   ├── airtable.ts           #   Airtable REST client
│   │   └── server-utils.ts       #   LiveKit SDK clients
│   ├── Dockerfile                #   Dashboard container (standalone)
│   ├── instrumentation.ts        #   BullMQ worker startup hook
│   └── .env                      #   Dashboard-specific environment
│
├── k8s/                          # Kubernetes Manifests (AWS EKS)
│   ├── namespace.yaml
│   ├── secrets.yaml
│   ├── configmap.yaml
│   ├── redis.yaml                #   Redis 7 deployment + service
│   ├── agent-deployment.yaml     #   Agent HPA (3→50 pods)
│   └── dashboard-deployment.yaml #   Dashboard + ALB ingress
│
├── docker-compose.yml            # Local development compose
└── README.md
```

---

## Features

### Calling Engine
- **Multi-LLM**: Groq (Llama 3.3 70B) with automatic fallback to Llama 3.1 8B Instant
- **Multi-TTS**: Sarvam AI (Indian voices), Deepgram Aura, OpenAI, Cartesia
- **Hinglish Support**: Natural Hindi-English conversation via Sarvam Bulbul v2
- **Tuned VAD**: Silero parameters optimized for Indian telecom audio quality
- **Call Transfer**: SIP REFER to human agents when needed
- **SIP Error Handling**: Auto-retry on busy (486), no answer (480), timeout (408)
- **Post-Call Analysis**: LLM-powered outcome classification, sentiment, and disposition
- **Noise Cancellation**: LiveKit BVC telephony-grade noise removal

### Campaign Management
- **Multi-Campaign**: 10-15+ campaigns running simultaneously with distinct prompts/voices
- **Version History**: Every prompt change is versioned with timestamps and change notes
- **Per-Call Overrides**: Model and voice can be overridden per call even within a campaign
- **Active/Inactive Toggle**: Campaigns can be paused without deletion

### Dashboard
- **Single Call Dispatch**: Campaign selector, model/voice dropdowns, prompt preview
- **Bulk Operations**: CSV upload, staggered dispatch with rate limiting
- **Live Activity Feed**: SSE-powered real-time call status on the main page
- **Analytics**: 8 stat cards, campaign performance table, call history with outcome/sentiment
- **Phone Masking**: Last 6 digits masked in all UI views
- **Copyable Errors**: One-click copy on error messages

### Infrastructure
- **Graceful Degradation**: Works without Redis (direct dispatch + file logging), gains queue/state machine when Redis is available, adds persistent storage with Airtable
- **BullMQ Queue**: Rate limiting, DND enforcement (9 PM–9 AM IST), retry with exponential backoff
- **Call State Machine**: QUEUED → DIALING → RINGING → CONNECTED → COMPLETED/FAILED
- **K8s Ready**: HPA auto-scaling 3→50 agent pods, ALB ingress, health probes
- **Docker**: Multi-stage builds for both agent and dashboard

---

## Component Responsibilities

| Component | Technology | Role |
|-----------|-----------|------|
| **Voice Agent** | Python, LiveKit Agents SDK 1.5.x | Call lifecycle, AI conversation loop, SIP retry, post-call analysis |
| **STT** | Deepgram Nova-2 | Real-time speech-to-text |
| **LLM** | Groq (Llama 3.3 70B) + fallback (8B Instant) | Contextual response generation |
| **TTS** | Sarvam Bulbul v2 / Deepgram Aura | Text-to-speech with Indian voice support |
| **VAD** | Silero (tuned) | Voice activity detection for Indian telecom |
| **SIP** | Vobiz via LiveKit SIP | PSTN bridge for outbound calls |
| **Dashboard** | Next.js 16, React 19, TailwindCSS 4 | Campaign management, call dispatch, analytics |
| **Queue** | BullMQ + Redis | Rate limiting, DND, scheduling, retry |
| **State** | Redis | Real-time call state machine + pub/sub |
| **Storage** | Airtable / JSON files | Call logs, campaign configs |
| **Infra** | AWS EKS, Docker | Auto-scaling, containerized deployment |

---

## Setup & Installation

### Prerequisites
- Python 3.10+ (Recommended: 3.12)
- Node.js 18+
- [LiveKit Cloud](https://cloud.livekit.io/) account
- [Deepgram](https://deepgram.com/) API Key
- [Groq](https://groq.com/) API Key
- SIP Provider (e.g., Vobiz)

### Quick Start

```bash
git clone https://github.com/shadabshamim-collab/LivekitAIVoice.git
cd LivekitAIVoice

# Agent setup
cd agent
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Fill in your API keys
cd ..

# Dashboard setup
cd dashboard
npm install
# Create dashboard/.env with LiveKit credentials
cd ..
```

### Environment Variables

**`agent/.env`** — Core calling credentials:

| Variable | Description |
|----------|-------------|
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `DEEPGRAM_API_KEY` | Deepgram API key (STT/TTS) |
| `GROQ_API_KEY` | Groq API key (LLM) |
| `VOBIZ_SIP_DOMAIN` | SIP server address |
| `VOBIZ_USERNAME` | SIP auth username |
| `VOBIZ_PASSWORD` | SIP auth password |
| `VOBIZ_SIP_TRUNK_ID` | LiveKit SIP trunk ID |

**`dashboard/.env`** — Dashboard credentials:

| Variable | Description |
|----------|-------------|
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `OUTBOUND_TRUNK_ID` | SIP trunk ID for dispatch |
| `REDIS_URL` | Redis URL (optional — enables queue + state machine) |
| `AIRTABLE_API_KEY` | Airtable PAT (optional — enables persistent storage) |
| `AIRTABLE_BASE_ID` | Airtable base ID (optional) |

### Create SIP Trunk

```bash
cd agent
source venv/bin/activate
python tools/create_trunk.py
# Copy the Trunk ID → add to both agent/.env and dashboard/.env
```

---

## Usage

### Start the Agent
```bash
cd agent
source venv/bin/activate
python agent.py start
```

### Start the Dashboard
```bash
cd dashboard
npm run dev
# Open http://localhost:3000
```

### Make a Call (CLI)
```bash
cd agent
source venv/bin/activate
python tools/make_call.py --to +91XXXXXXXXXX
```

---

## Customizing the Agent

Edit `agent/config.py` to change the agent's personality, language, and behavior:

```python
SYSTEM_PROMPT = """Your custom prompt here..."""
INITIAL_GREETING = """Your custom greeting..."""

DEFAULT_LLM_PROVIDER = "groq"       # or "openai"
DEFAULT_TTS_PROVIDER = "sarvam"     # or "deepgram", "openai", "cartesia"
```

Or create a campaign via the dashboard UI at `/campaigns/new` for version-controlled prompt management.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `SIP 486: Busy Here` | Customer is on another call | Auto-retries in 5 minutes (built-in) |
| `SIP 480: No Answer` | Customer didn't pick up | Auto-retries in 10 minutes (built-in) |
| `OPENAI_API_KEY not set` | Dashboard defaulting to OpenAI | Select "Groq" in model provider dropdown |
| `Speaker not compatible` | Invalid Sarvam voice name | Use: anushka, arya, abhilash, karun, hitesh |
| `402 Payment Required` | Vobiz balance depleted | Top up Vobiz calling credits |
| `Address already in use :8081` | Agent already running | `pkill -f "python agent.py"` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice Agent | Python 3.12, LiveKit Agents SDK 1.5.x |
| LLM | Groq (Llama 3.3 70B + 3.1 8B fallback) |
| STT | Deepgram Nova-2 |
| TTS | Sarvam Bulbul v2, Deepgram Aura, OpenAI TTS-1 |
| VAD | Silero (tuned for Indian telecom) |
| Telephony | LiveKit SIP, Vobiz PSTN Gateway |
| Dashboard | Next.js 16, React 19, TailwindCSS 4 |
| Queue | BullMQ, Redis |
| Storage | Airtable, JSON files |
| Infra | AWS EKS, Docker, Kubernetes |
