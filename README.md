# CxLL — AI Voice Agent Platform

> **Production-grade outbound voice AI for high-volume calling campaigns.**
> Built on LiveKit · Groq · ElevenLabs · Deepgram · Sarvam AI · Next.js

Designed for **3,000+ concurrent calls** with auto-scaling on AWS EKS, real-time monitoring, and full campaign management.

---

## Demo

<video src="https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mp4" controls width="100%"></video>

> **[Download Demo Video (.mp4)](https://github.com/shadabshamim-collab/LivekitAIVoice/releases/download/v1.0.0/demo.mp4)**

---

## Product Evolution — From Prototype to Platform

> *The story of how a single hardcoded voice bot became a full multi-campaign AI calling engine.*

### Stage 1 · The Prototype *(v1.0)*

**Problem:** We needed to test whether AI could handle real phone conversations in Hinglish.

A single Python script. One hardcoded prompt. Groq LLM + Deepgram STT + Sarvam TTS. You ran it from the terminal, it called one number, and you hoped it worked.

**What it proved:** The voice quality was good enough. Customers were engaging.

**What it couldn't do:** Scale, manage multiple campaigns, track outcomes, or survive a restart without re-entering credentials.

```
Terminal → python make_call.py → LiveKit → Vobiz SIP → Customer's Phone
```

---

### Stage 2 · The Dashboard *(v2.0)*

**Problem:** Non-technical team members needed to dispatch calls without touching a terminal.

Built a Next.js dashboard with single-call dispatch, a bulk dialer with CSV upload, and the beginnings of campaign management. Added Redis + BullMQ for call queuing, DND enforcement (9 PM–9 AM IST), and retry logic. Introduced a call state machine (QUEUED → DIALING → CONNECTED → COMPLETED).

**What it unlocked:** Campaign managers could run calls independently. Compliance (DND) was automated. Failed calls retried themselves.

**What was still broken:** Every campaign used the same Anushka/XYZ Finance prompt. Changing the prompt meant editing `config.py` and restarting the agent. No visibility into what happened inside a call.

```
Dashboard UI
    → BullMQ Queue (Redis) → DND check → Rate limit
        → LiveKit Agent Dispatch
            → SIP → Phone
                → Webhook (status only)
```

---

### Stage 3 · Multi-Campaign Engine *(v2.1)*

**Problem:** 10+ campaigns needed to run simultaneously — loan collection, insurance renewal, primary number verification, sales — each with different prompts, voices, languages, and models.

**Solution:** Moved campaign configs into versioned JSON files. Full CRUD API with prompt version history. Campaign config embedded in LiveKit metadata at dispatch time — the agent reads it on every call, so in-progress calls keep their prompt even if the campaign is updated.

Added LLM-powered post-call analysis: outcome classification (payment_committed / callback_scheduled / transferred / refused), sentiment (positive/neutral/negative/frustrated), and disposition summaries. Added Google Sheets as a lead source with bidirectional write-back.

**What it unlocked:** Product, ops, and compliance teams could each manage their own campaign without engineering involvement. Prompt experiments became instant — edit → save → next call picks it up.

```
Campaigns JSON (version-controlled)
    → Dispatch embeds full config in LiveKit metadata
        → Agent reads system_prompt + voice + model from metadata
            → Post-call: LLM classifies outcome → logged to Airtable + Sheet
```

---

### Stage 4 · Voice Quality & Observability *(v2.2 — Current)*

**Problem:** Calls were working but quality was inconsistent. The bot hallucinated numbers. The greeting sometimes spoke its own instructions aloud. No way to watch a live call or understand what was causing latency.

**Solutions shipped in this phase:**

| Problem | Fix |
|---------|-----|
| Bot invents numbers/amounts | `STRICT SCRIPT ADHERENCE` guardrail at top of every prompt + `temperature=0.6` |
| Greeting speaks instruction text aloud | Restructured to `"Speak ONLY this sentence"` directive pattern |
| No visibility into live calls | `/monitor` page — real-time transcript streaming via SSE |
| No latency data | Per-turn STT/LLM/TTS/EOU metrics collected, pipeline breakdown in `/analytics` |
| All campaigns use same voice quality | Per-campaign VAD, temperature, max tokens, STT language in campaign editor |
| SIP trunk rejections look like missed calls | `Dialer Reject` status for SIP 486 < 2s (trunk-level, no retry) |
| ElevenLabs/Gemini not supported | Multi-provider: ElevenLabs Turbo v2.5, Gemini 2.5 Flash Lite, groq-fast added |

**What it unlocked:** The ops team can now watch calls in real time. Engineers can see exactly where latency is coming from. Campaign managers can tune voice quality without code changes.

---

### Where We're Going

| Capability | Status |
|-----------|--------|
| Multi-campaign simultaneous calling | ✅ Live |
| Real-time call monitoring | ✅ Live |
| LLM-powered post-call analysis | ✅ Live |
| Pipeline latency breakdown | ✅ Live |
| Google Sheets lead source + write-back | ✅ Live |
| Per-campaign voice tuning controls | ✅ Live |
| TRAI/DLT compliance (India outbound) | 🔧 In progress |
| Inbound call handling | 📋 Planned |
| Whisper mode (agent assist) | 📋 Planned |
| Multi-language auto-detection | 📋 Planned |

---

## 🚀 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Voice Agent** | Python 3.12 + LiveKit Agents SDK 1.5.x | Production-proven real-time voice handling |
| **STT** | Deepgram Nova-2, ElevenLabs Scribe v1 | Best-in-class accuracy + Hinglish support |
| **LLM** | Groq Llama 3.3 70B, 3.1 8B, OpenAI GPT-4o, Gemini 2.5 Flash Lite | Choice: cost vs. quality |
| **TTS** | ElevenLabs Turbo v2.5 (default), Sarvam Bulbul, Deepgram, OpenAI, Cartesia | Hinglish + multiple voices |
| **VAD** | Silero | Accurate end-of-utterance detection on phone networks |
| **Dashboard** | Next.js 16, React 19, TailwindCSS 4 | Modern, fast, responsive |
| **Realtime** | Server-Sent Events (SSE) | Live transcript streaming, fallback-safe |
| **Queue** | BullMQ + Redis 7 | Rate limiting, retry, scheduling |
| **Storage** | Airtable, JSON files, Google Sheets | Flexible, vendor-neutral |
| **Infra** | AWS EKS, Docker, Kubernetes, HPA | Auto-scaling, zero-downtime deployments |
| **Monitoring** | Custom metrics in agent, dashboard aggregation | Per-turn latency visibility |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CXLL PLATFORM ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  DASHBOARD (Next.js 16 + React 19)                           │  │
│  │  ─────────────────────────────────────────────────────────   │  │
│  │  • Single Call Dispatch        • Campaign Editor             │  │
│  │  • Bulk Dialer (CSV)           • Live Monitor (SSE)          │  │
│  │  • Analytics Dashboard         • Pipeline Latency View       │  │
│  │  • Outcome Modal (Full Detail)                               │  │
│  └────────────────┬─────────────────────────────────────────────┘  │
│                   │                                                │
│                   ▼                                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  API LAYER (Next.js Routes)                                  │  │
│  │  ─────────────────────────────────────────────────────────   │  │
│  │  /api/dispatch     /api/campaigns    /api/calls              │  │
│  │  /api/queue        /api/calls/stream /api/vobiz/webhook      │  │
│  │  /api/health       /api/campaigns/sheets-sync                │  │
│  └────────┬──────────────┬──────────────┬──────────────┬────────┘  │
│           │              │              │              │           │
│           ▼              ▼              ▼              ▼           │
│  ┌──────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐     │
│  │ BullMQ Queue │ │ Redis State │ │ Airtable /  │ │ G-Sheets │     │
│  │ Rate Limit   │ │ Machine     │ │ JSON Files  │ │ Lead Src │     │
│  │ DND Check    │ │ Real-time   │ │ (storage)   │ │ (write-  │     │
│  │ Auto-retry   │ │ counters    │ │             │ │  back)   │     │
│  └──────────────┘ └─────────────┘ └─────────────┘ └──────────┘     │
│           │              │                                         │
│           └──────────┬───┘                                         │
│                      ▼                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  LIVEKIT CLOUD (WebRTC + SIP)                                │  │
│  │  Agent Dispatch ─► Room Assignment ─► SIP Bridge ─► Trunk    │  │
│  └──────────────┬───────────────────────────────────┬───────────┘  │
│                │                                    │              │
│                ▼                                    ▼              │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │  VOICE AGENT (Python)        │  │  PSTN Gateway (Vobiz SIP)  │  │
│  │  ─────────────────────────    │  │  ──────────────────────   │  │
│  │  • STT: Deepgram / ElevenLabs │  │  ─► PSTN/Telecom          │  │
│  │  • LLM: Groq / OpenAI / Google│  │  ─► Customer's Phone      │  │
│  │  • TTS: ElevenLabs / Sarvam   │  │                           │  │
│  │  • VAD: Silero (per-campaign) │  └───────────────────────────┘  │
│  │  • Metrics: Per-turn latency  │                                 │
│  │  • Analysis: Post-call outcome│                                 │
│  │  • Retry: SIP error handling  │                                 │
│  └──────────────────────────────┘                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  KUBERNETES (AWS EKS)                                        │  │
│  │  Agents: HPA 3→50 | Dashboard: 2 replicas | Redis: in-cluster│  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```
Per-turn latency = dial_ms · stt_ms · eou_ms · llm_ttft_ms · tts_ttfb_ms  → aggregated → dashboard 

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              CxLL PLATFORM (v2.2)                                │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐   │
│  │                           DASHBOARD  (Next.js 16)                         │   │
│  │                                                                           │   │
│  │  ┌─────────────┐  ┌───────────-──┐  ┌─────────────-─┐  ┌───────────────┐  │   │
│  │  │  Call       │  │  Bulk        │  │  Campaign     │  │  Live Monitor │  │   │
│  │  │  Dispatcher │  │  Dialer      │  │  Editor       │  │  /monitor     │  │   │
│  │  │  + overrides│  │  CSV upload  │  │  + Tuning UI  │  │  SSE stream   │  │   │
│  │  └──────┬──────┘  └─────-─┬───────┘ └──────┬────────┘  └──────┬────────┘  │   │
│  │         └─────────────────┴────────────────┘                  │           │   │
│  │                           │                                   │           │   │
│  │  ┌──────────────────────────────────────────────────────────────────────┐ │   │
│  │  │                      API Layer  (Next.js Routes)                     │ │   │
│  │  │                                                                      │ │   │
│  │  │  /api/dispatch        /api/queue           /api/campaigns            │ │   │
│  │  │  /api/calls           /api/calls/stream    /api/calls/webhook        │ │   │
│  │  │  /api/vobiz/webhook   /api/health                                    │ │   │
│  │  └───────┬──────────────────┬──────────────────────────┬───────-────────┘ │   │
│  └──────────┼──────────────────┼──────────────────────────┼──────────────────┘   │
│             │                  │                          │                      │
│             v                  v                          v                      │
│  ┌──────────────────┐  ┌────────────────┐       ┌─────────────────────┐          │
│  │  BullMQ Queue    │  │  Redis         │       │  Storage            │          │
│  │  ─────────────   │  │  ────────────  │       │  ─────────────────  │          │
│  │  Rate limiting   │◄─┤  Call state    │       │  Airtable (cloud)   │          │
│  │  DND 9PM–9AM IST │  │  machine       │       │  JSON files (local) │          │
│  │  Auto-retry      │  │  Realtime stats│       │  campaigns/*.json   │          │
│  │  Scheduled calls │  │  Pub/Sub       │       └─────────────────────┘          │
│  └────────┬─────────┘  └────────────────┘                                        │
│           │                                                                      │
│           v                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                      LIVEKIT CLOUD  (WebRTC + SIP)                         │  │
│  │                                                                            │  │
│  │   Agent Dispatch API ──► Room Assignment ──► SIP Bridge ──► Vobiz Trunk    │  │
│  └─────────────────────────────────────┬──────────────────────┬──────────-────┘  │
│                                        │                      │                  │
│                                        v                      v                  │
│  ┌──────────────────────────────────────────────────┐  ┌─────────────────────┐   │
│  │              VOICE AGENT  (Python)               │  │  PSTN / Vobiz SIP   │   │
│  │                                                  │  │  Trunk Gateway      │   │
│  │  ┌────────────────────────────────────────────┐  │  └──────────┬──────────┘   │
│  │  │  STT  Deepgram Nova-2 / ElevenLabs Scribe  │  │             │              │
│  │  ├────────────────────────────────────────────┤  │             v              │
│  │  │  VAD  Silero  (per-campaign threshold)     │  │  ┌─────────────────────┐   │
│  │  ├────────────────────────────────────────────┤  │  │  Customer's Phone   │   │
│  │  │  LLM  Groq · OpenAI · Gemini · groq-fast   │  │  └─────────────────────┘   │
│  │  ├────────────────────────────────────────────┤  │                            │
│  │  │  TTS  ElevenLabs Turbo · Sarvam · Deepgram │  │                            │
│  │  │       OpenAI · Cartesia · Google Cloud TTS │  │                            │
│  │  ├────────────────────────────────────────────┤  │                            │
│  │  │  Noise Cancellation  LiveKit BVC Telephony │  │                            │
│  │  ├────────────────────────────────────────────┤  │                            │
│  │  │  Per-Turn Latency Metrics                  │  │                            │
│  │  │  dial_ms · stt_ms · eou_ms · llm_ttft_ms  │  │                             │
│  │  │  tts_ttfb_ms  → aggregated → dashboard     │  │                            │
│  │  ├────────────────────────────────────────────┤  │                            │
│  │  │  Post-Call Analysis  (LLM-powered)         │  │                            │
│  │  │  Outcome · Sentiment · Disposition         │  │                            │
│  │  └────────────────────────────────────────────┘  │                            │
│  └──────────────────────────────────────────────────┘                            │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                        KUBERNETES  (AWS EKS)                               │  │
│  │   Agent Pods  HPA 3→50     Dashboard  2 replicas     Redis  in-cluster     │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Call Flow

```
 Dashboard           API / Queue         LiveKit Cloud        Voice Agent            Customer
    │                    │                    │                    │                     │
    │  1. Dispatch call  │                    │                    │                     │
    │  (campaign_id,     │                    │                    │                     │
    │   phone_number)    │                    │                    │                     │
    │ ──────────────────>│                    │                    │                     │
    │                    │                    │                    │                     │
    │         2. DND check · Rate limit · Enqueue / Direct dispatch                      │
    │                    │                    │                    │                     │
    │                    │ 3. agentDispatch() │                    │                     │
    │                    │  metadata: {       │                    │                     │
    │                    │   system_prompt,   │                    │                     │
    │                    │   voice_id,        │                    │                     │
    │                    │   model_provider,  │                    │                     │
    │                    │   vad_threshold,   │                    │                     │
    │                    │   temperature ...} │                    │                     │
    │                    │ ──────────────────>│                    │                     │
    │                    │                    │ 4. Assign job      │                     │
    │                    │                    │ ──────────────────>│                     │
    │                    │                    │                    │                     │
    │                    │                    │     5. ctx.connect() + session.start()   │
    │                    │                    │     Build STT/LLM/TTS from metadata      │
    │                    │                    │                    │                     │
    │                    │                    │     ┌──── dial_ms timer ────┐            │
    │                    │                    │     │ 6. SIP INVITE         │            │
    │                    │                    │ ────────────────────────────────────────>│
    │                    │                    │     └───────────────────────┘            │
    │                    │                    │                    │  7. Ringing ...     │
    │                    │                    │                    │                     │
    │                    │                    │              8. Call Answered            │
    │                    │                    │<──────────────────────────────────────── │
    │                    │                    │                    │                     │
    │         Webhook: connected ─────────────────────────────────│                      │
    │                    │                    │                    │                     │
    │                    │                    │     ┌──── ttfr_ms timer ────┐            │
    │                    │                    │     │ 9. generate_reply()   │            │
    │                    │                    │     │    (initial greeting) │            │
    │                    │                    │     └───────────────────────┘            │
    │                    │                    │                    │                     │
    │                    │                    │  10. Conversation Loop                   │
    │                    │                    │      ┌─────────────────────────────────┐ │
    │                    │                    │      │ Customer speaks                 │ │
    │                    │                    │      │  → VAD detects end of utterance │ │
    │                    │                    │      │    [eou_delay_ms]               │ │
    │                    │                    │      │  → Deepgram STT transcribes     │ │
    │                    │                    │      │    [stt_ms]                     │ │
    │                    │                    │      │  → LLM generates response       │ │
    │                    │                    │      │    [llm_ttft_ms · duration_ms]  │ │
    │                    │                    │      │  → TTS synthesises audio        │ │
    │                    │                    │      │    [tts_ttfb_ms · duration_ms]  │ │
    │                    │                    │      │  → Audio streamed to customer   │ │
    │                    │                    │      └─────────────────────────────────┘ │
    │                    │                    │                    │                     │
    │         Webhook: transcript_update (every 2s) ────────────── │                     │
    │         → /monitor page updates live transcript              │                     │
    │                    │                    │                    │                     │
    │                    │                    │     11. Call ends  │                     │
    │                    │                    │<───────────────────│                     │
    │                    │                    │                    │                     │
    │         Webhook: completed ───────────────────────────────── │                     │
    │         Webhook: summary ─────────────────────────────────── │                     │
    │           outcome · sentiment · disposition                  │                     │
    │           latency { dial_ms, avg_stt_ms, avg_llm_ttft_ms,    │                     │
    │                     avg_tts_ttfb_ms, turns[] }               │                     │
    │                    │                    │                    │                     │
    │  ╔══ SIP 486 < 2s (Dialer Reject) ══╗   │                    │                     │
    │  ║ status: dialer_reject            ║   │                    │                     │
    │  ║ no retry — trunk-level rejection ║   │                    │                     │
    │  ╚═══════════════════════════════════╝  │                    │                     │
    │                    │                    │                    │                     │
    │  ╔══ SIP 480/408 (No Answer) ══╗        │                    │                     │
    │  ║ status: completed           ║        │                    │                     │
    │  ║ outcome: missed_call        ║        │                    │                     │
    │  ║ auto-retry in 5–10 min      ║        │                    │                     │
    │  ╚═════════════════════════════╝        │                    │                     │
```

---

## Pipeline Latency Breakdown
```
SETUP PHASE:
  dial_ms = SIP INVITE to answered
           (typical: 2-4 seconds)

FIRST RESPONSE PHASE:
  ttfr_ms = Answered to agent's first greeting
           (typical: 1-2 seconds)
           ├─ LLM latency (ttft_ms)
           └─ TTS latency (ttfb_ms)

PER-TURN CONVERSATION PHASE:
  eou_delay_ms  = VAD silence detection (typical: 400-600ms)
  stt_ms        = Deepgram transcription (typical: 200-300ms)
  llm_ttft_ms   = First token from Groq/OpenAI (typical: 200-500ms)
  llm_duration  = Full response generation (variable)
  tts_ttfb_ms   = First audio byte from TTS (typical: 200-400ms)
  tts_duration  = Full synthesis time (variable)

TARGET: End-to-end < 1.5 seconds per turn
```

Every completed call records a full latency profile across the voice pipeline:

```
 ◄──── dial_ms ────►◄── ttfr_ms (first greeting) ──►
 ┌─────────────────┐┌─────────────────────────────────┐
 │   SIP Connect   ││          First Response          │
 └─────────────────┘└─────────────────────────────────┘

 Per conversation turn (avg/min/max stored):
 ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
 │  EOU Wait │ │    STT    │ │ LLM TTFT  │ │ LLM Body  │ │ TTS TTFB  │
 │ (VAD sil) │ │ Deepgram  │ │  Groq /   │ │ (stream)  │ │ ElevenLabs│
 │  ~400ms   │ │  ~200ms   │ │  OpenAI   │ │           │ │  ~300ms   │
 └───────────┘ └───────────┘ └─────┬─────┘ └───────────┘ └───────────┘
                                   │
                     Target end-to-end < 1.5s
```

Visible in `/analytics` → **Pipeline Latency Breakdown** section with colour-coded stacked bars per call and campaign-level aggregates.

---

## Project Structure

```
CxLL/
│
├── agent/                           # Core Calling Engine (Python)
│   ├── agent.py                     #   Full call lifecycle — STT/LLM/TTS pipeline,
│   │                                #   latency metrics, transcript streaming,
│   │                                #   SIP retry, post-call analysis
│   ├── config.py                    #   Default prompts, model/voice settings, fallback config
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env / .env.example
│   ├── campaigns/                   #   Per-campaign JSON (version-controlled prompts)
│   │   ├── collection-reminder-test.json
│   │   └── primary-number-verification.json
│   └── tools/                       #   SIP utility scripts
│       ├── make_call.py             #     CLI: single outbound call
│       ├── create_trunk.py          #     Create SIP trunk on LiveKit
│       ├── setup_trunk.py           #     Update SIP trunk credentials
│       └── list_trunks.py           #     List configured SIP trunks
│
├── dashboard/                       # Web Dashboard (Next.js 16)
│   ├── app/
│   │   ├── page.tsx                 #   Home — dispatch + bulk dialer + live activity
│   │   ├── layout.tsx               #   Nav: Calls | Campaigns | Monitor | Analytics
│   │   ├── monitor/page.tsx         #   Live call monitor — SSE transcript streaming
│   │   ├── analytics/page.tsx       #   Analytics + pipeline latency breakdown
│   │   ├── campaigns/               #   Campaign CRUD pages (list, new, edit + tuning)
│   │   └── api/
│   │       ├── dispatch/            #     Single call dispatch (campaign metadata embed)
│   │       ├── queue/               #     Bulk call queue
│   │       ├── campaigns/           #     Campaign CRUD + sheets-sync cron
│   │       ├── calls/               #     Call logs, stats, SSE stream, webhook receiver
│   │       ├── vobiz/webhook/       #     Vobiz SIP event receiver
│   │       └── health/              #     K8s readiness/liveness probe
│   ├── components/
│   │   ├── CallDispatcher.tsx       #   Single call form (campaign selector + provider overrides)
│   │   ├── BulkDialer.tsx           #   Bulk dialer with CSV upload + campaign selector
│   │   └── LiveActivity.tsx         #   Real-time call feed (SSE)
│   └── lib/
│       ├── campaigns.ts             #   Campaign file I/O + version history
│       ├── call-logger.ts           #   Airtable + file-based call logging (latency aware)
│       ├── call-state.ts            #   Redis-backed call state machine
│       ├── call-queue.ts            #   BullMQ queue — DND, rate limiting, retry
│       ├── google-sheets.ts         #   Google Sheets lead source + disposition write-back
│       ├── redis.ts                 #   Redis client singleton (graceful degradation)
│       ├── airtable.ts              #   Airtable REST client
│       └── server-utils.ts          #   LiveKit SDK clients
│
├── k8s/                             # Kubernetes Manifests (AWS EKS)
│   ├── namespace.yaml
│   ├── secrets.yaml
│   ├── configmap.yaml
│   ├── redis.yaml                   #   Redis 7 in-cluster
│   ├── agent-deployment.yaml        #   HPA 3→50 pods
│   └── dashboard-deployment.yaml    #   2 replicas + ALB ingress
│
├── docker-compose.yml
├── CHANGELOG.md
└── README.md
```

---

## Features

### Voice Pipeline
| Capability | Detail |
|-----------|--------|
| **Multi-provider STT** | Deepgram Nova-2/3, ElevenLabs Scribe v1 |
| **Multi-provider LLM** | Groq Llama 3.3 70B, Groq 3.1 8B (fast), OpenAI GPT-4o, Gemini 2.5 Flash Lite |
| **Multi-provider TTS** | ElevenLabs Turbo v2.5 *(default)*, Sarvam Bulbul v2 (Indian voices), Deepgram Aura, OpenAI TTS-1, Cartesia Sonic, Google Cloud TTS |
| **Hinglish support** | Natural Hindi-English code-switching via Sarvam + Deepgram Nova-2 multi |
| **Tuned VAD** | Silero with per-campaign `min_silence_duration` (0.3–1.0 s) |
| **Noise cancellation** | LiveKit BVC telephony-grade |
| **Hallucination guardrail** | `STRICT SCRIPT ADHERENCE` prompt block + `temperature=0.6` |
| **Call transfer** | SIP REFER to human agents with validation guard |
| **SIP retry** | Auto-retry: 486→5 min, 480→10 min, 408→2 min. 603 never retried. 486<2s→Dialer Reject (no retry) |
| **Per-call latency metrics** | dial, TTFR, per-turn: stt, eou, llm_ttft, tts_ttfb — avg/min/max |

### Campaign Management
| Capability | Detail |
|-----------|--------|
| **Multi-campaign** | 10-15+ campaigns simultaneously, each with own prompt/voice/model |
| **Version history** | Every prompt change versioned with timestamp and change note |
| **Voice & Tuning controls** | VAD threshold, LLM temperature, max tokens, STT language — per campaign, no restart needed |
| **Google Sheets lead source** | Poll sheet → dispatch → write disposition back — fully automated |
| **Retry ladder** | Per-campaign retry schedule (e.g. +2h / +6h / +16h for missed calls) |
| **DND compliance** | Configurable per-campaign DND window (default: 21:00–09:00 IST) |
| **Active/Inactive toggle** | Pause campaigns without deletion |

### Dashboard
| Capability | Detail |
|-----------|--------|
| **Single call dispatch** | Campaign selector, per-call provider overrides, prompt preview |
| **Bulk operations** | CSV upload, staggered dispatch, rate limiting |
| **Live Call Monitor** | `/monitor` — real-time transcript streaming with 🤖/👤 turn display |
| **Analytics** | 8 stat cards, campaign table, call history with outcome/sentiment/latency |
| **Pipeline Latency** | Stacked mini-bar per call (Dial · EOU · STT · LLM · TTS) + campaign averages |
| **Outcome modal** | Click any outcome badge to view full transcript, duration, sentiment, latency |
| **Status taxonomy** | dispatched · dialing · ringing · connected · completed · failed · **dialer\_reject** |
| **Vobiz webhook** | `/api/vobiz/webhook` receives real-time SIP events for debugging |

### Infrastructure
| Capability | Detail |
|-----------|--------|
| **Graceful degradation** | No Redis → file logs + direct dispatch. With Redis → queue + state machine. With Airtable → cloud storage |
| **BullMQ queue** | Rate limiting, DND enforcement, scheduling, retry |
| **Call state machine** | QUEUED → DIALING → RINGING → CONNECTED → COMPLETED/FAILED |
| **K8s HPA** | 3→50 agent pods on CPU/memory pressure |
| **Health probe** | `/api/health` checks Redis, Airtable, LiveKit, SIP trunk |

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Voice agent | Python 3.12, LiveKit Agents SDK 1.5.x | Call lifecycle, AI pipeline |
| STT | Deepgram Nova-2 · ElevenLabs Scribe v1 | Per-campaign selection |
| LLM | Groq Llama 3.3 70B · 3.1 8B · OpenAI GPT-4o · Gemini 2.5 Flash Lite | Per-campaign, per-call |
| TTS | ElevenLabs Turbo v2.5 · Sarvam Bulbul v2 · Deepgram Aura · OpenAI · Cartesia · Google Cloud | Default: ElevenLabs |
| VAD | Silero | Per-campaign threshold |
| Telephony | LiveKit SIP · Vobiz PSTN | Outbound SIP/PSTN |
| Dashboard | Next.js 16 · React 19 · TailwindCSS 4 | |
| Realtime | SSE (Server-Sent Events) | Live monitor + activity feed |
| Queue | BullMQ · Redis 7 | Rate limiting, DND, retry |
| Storage | Airtable · JSON files · Google Sheets | Graceful degradation |
| Infra | AWS EKS · Docker · Kubernetes · HPA | 3→50 agent pods |

---

## Component Responsibilities

| Component | Technology | Role |
|-----------|-----------|------|
| **Voice Agent** | Python, LiveKit SDK | Call lifecycle, AI loop, metrics, retry, analysis |
| **STT** | Deepgram Nova-2 / ElevenLabs | Real-time speech-to-text |
| **LLM** | Groq / OpenAI / Gemini | Response generation (per-campaign model) |
| **TTS** | ElevenLabs Turbo / Sarvam / Deepgram | Speech synthesis (per-campaign voice) |
| **VAD** | Silero | End-of-utterance detection (per-campaign threshold) |
| **SIP** | Vobiz via LiveKit SIP | PSTN bridge, outbound calls |
| **Dashboard** | Next.js 16 | Campaign management, dispatch, monitor, analytics |
| **Queue** | BullMQ + Redis | DND, rate limiting, scheduling, auto-retry |
| **State** | Redis | Call state machine, real-time counters |
| **Storage** | Airtable / JSON | Call logs, outcomes, latency data |
| **Lead source** | Google Sheets | Read leads, write dispositions back |
| **Infra** | AWS EKS | Auto-scaling, HA deployment |

---

## Setup & Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- [LiveKit Cloud](https://cloud.livekit.io/) account
- [Deepgram](https://deepgram.com/) API key (STT)
- [Groq](https://groq.com/) API key (LLM)
- [ElevenLabs](https://elevenlabs.io/) API key (TTS — recommended)
- SIP provider (Vobiz or equivalent)

### Quick Start

```bash
git clone https://github.com/shadabshamim-collab/CxLL.git
cd CxLL

# Agent setup
cd agent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # Fill in API keys

# Dashboard setup
cd ../dashboard
npm install
# Create dashboard/.env with LiveKit + optional Redis/Airtable credentials
```

### Start

```bash
# Terminal 1 — Voice agent
cd agent && source venv/bin/activate
python agent.py start

# Terminal 2 — Dashboard
cd dashboard
npm run dev
# Open http://localhost:3000
```

### Environment Variables

**`agent/.env`**

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | ✅ | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | ✅ | LiveKit API key |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit API secret |
| `GROQ_API_KEY` | ✅ | Groq LLM key |
| `DEEPGRAM_API_KEY` | ✅ | Deepgram STT key |
| `ELEVENLABS_API_KEY` | ✅ | ElevenLabs TTS key (default provider) |
| `VOBIZ_SIP_TRUNK_ID` | ✅ | LiveKit SIP trunk ID |
| `VOBIZ_SIP_DOMAIN` | ✅ | SIP server domain |
| `OPENAI_API_KEY` | — | Optional — for OpenAI LLM/TTS |
| `GOOGLE_API_KEY` | — | Optional — for Gemini LLM |
| `DASHBOARD_WEBHOOK_URL` | — | Defaults to `http://localhost:3000/api/calls/webhook` |

**`dashboard/.env`**

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | ✅ | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | ✅ | LiveKit API key |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit API secret |
| `VOBIZ_SIP_TRUNK_ID` | ✅ | SIP trunk ID for dispatch |
| `REDIS_URL` | — | Optional — enables queue + state machine |
| `AIRTABLE_API_KEY` | — | Optional — enables persistent cloud storage |
| `AIRTABLE_BASE_ID` | — | Optional — Airtable base ID |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` | — | Optional — for Google Sheets lead source |

### Create SIP Trunk

```bash
cd agent && source venv/bin/activate
python tools/create_trunk.py
# Copy the Trunk ID → add to both agent/.env and dashboard/.env as VOBIZ_SIP_TRUNK_ID
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Dialer Reject (SIP 486 < 2s)` | Vobiz trunk rejects before ringing | Check Vobiz account balance · outbound PSTN enabled · TRAI DLT registration |
| `SIP 486` → auto-retries | Customer was busy | Built-in retry in 5 min |
| `SIP 480` → auto-retries | No answer | Built-in retry in 10 min |
| `Address already in use :8081` | Previous agent still running | `lsof -ti :8081 \| xargs kill -9` |
| `method object is not iterable` | LiveKit SDK version mismatch | Fixed in agent — `_get_history_items()` handles both API shapes |
| `max_tokens not a valid param` | Old constructor usage | Fixed — use `max_completion_tokens` for `openai.LLM` |
| `402 Payment Required` | ElevenLabs/Vobiz balance depleted | Top up account credits |
| `Speaker not compatible` | Invalid Sarvam voice name | Use: `anushka · arya · abhilash · karun · hitesh` |
| Agent speaks its own instructions | Greeting prompt not structured correctly | Use `"Speak ONLY this sentence"` directive pattern |

---

## Webhook Events

The agent posts to `/api/calls/webhook` throughout a call's lifecycle:

| Status | When | Payload |
|--------|------|---------|
| `connected` | Customer picks up | `room_name` |
| `transcript_update` | Every 2 seconds | `room_name, turn_count, transcript` |
| `completed` | Call ends | `room_name, duration_seconds` |
| `summary` | Post-call analysis done | `outcome, disposition, sentiment, transcript, latency{}` |
| `retry` | SIP busy/no-answer | `sip_status, reason, retry_delay_seconds, phone_number` |
| `failed` | Unrecoverable SIP error | `error` |

Vobiz SIP events arrive at `/api/vobiz/webhook` and are logged for debugging trunk-level rejections.

---

## 📊 Investor Summary

**CxLL** addresses a $50B+ market: outbound calling automation for enterprise. We've built a platform that:
- Handles 3,000+ concurrent calls (previously impossible at this scale with AI)
- Reduces calling costs by 70% (automation + silence detection)
- Improves call success by 45% (LLM + real-time tuning)
- Enables non-technical operators (UI, not code)
- Scales from startup to enterprise (Kubernetes-native)

**Revenue models:** Per-minute calling, SaaS per-campaign, Enterprise licensing.

See **[Investor Pitch](./docs/INVESTOR_PITCH.md)** for full business case.

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m "Add my feature"`)
4. Push to branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📈 Performance & Scaling

### Throughput
- **Single agent pod:** ~50-100 concurrent calls (depends on LLM latency)
- **HPA autoscaling:** 3→50 pods, scales up 5 pods/60s, down 2 pods/120s
- **Peak capacity:** 3,000+ concurrent calls on production cluster

### Latency Targets
- **Dial time:** 2-4 seconds (SIP provider dependent)
- **First greeting:** 1-2 seconds (LLM + TTS)
- **Per-turn latency:** < 1.5 seconds (VAD + STT + LLM + TTS)

### Cost Optimization
- **Groq 70B:** $0.27/1M tokens (best latency)
- **Groq 8B Fast:** $0.04/1M tokens (cost-optimized)
- **ElevenLabs TTS:** $5/1M characters (production voice quality)
- **Deepgram STT:** $0.003/min (batch), $0.0043/min (streaming)

## 📚 Documentation

- **[Product Spec](./docs/PRODUCT_SPEC.md)** — Features, use cases, roadmap
- **[API Reference](./docs/API.md)** — All endpoints, webhooks, error codes
- **[Deployment Guide](./docs/DEPLOYMENT.md)** — Local, Docker, Kubernetes
- **[Architecture Deep Dive](./docs/ARCHITECTURE.md)** — System design, decisions
- **[Investor Pitch](./docs/INVESTOR_PITCH.md)** — Market, TAM, business model
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** — Common issues, fixes

---

## 📄 License

MIT License — See [LICENSE](./LICENSE) file for details.

---
