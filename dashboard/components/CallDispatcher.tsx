"use client";

import { useState, useEffect, useCallback } from 'react';
import { Phone, MessageSquare, Loader2, Sparkles, Megaphone, Wifi, WifiOff, RefreshCw, Sheet, PhoneCall, Mic, Volume2 } from 'lucide-react';

interface Campaign {
    id: string;
    name: string;
    description: string;
    status: string;
    model_provider: string;
    voice_id: string;
    language: string;
    lead_source?: { type: string; sheet_id?: string; tab_name?: string };
}

interface HealthCheck {
    ok: boolean;
    detail?: string;
    latency_ms?: number;
}

interface AgentHealth {
    status: 'ready' | 'degraded';
    ready: boolean;
    checks: Record<string, HealthCheck>;
}

function inferTtsProvider(voiceId: string): string {
    if (!voiceId) return 'openai';
    const sarvamVoices = ['anushka', 'manisha', 'vidya', 'arya', 'abhilash', 'karun', 'hitesh'];
    if (sarvamVoices.includes(voiceId)) return 'sarvam';
    if (voiceId.startsWith('aura-')) return 'deepgram';
    // Google Cloud TTS voices: hi-IN-Wavenet-A, en-US-Neural2-F, etc.
    if (/^[a-z]{2}-[A-Z]{2}-/.test(voiceId)) return 'google';
    // ElevenLabs voice IDs are 20-char alphanumeric
    if (voiceId.length === 20 && /^[a-zA-Z0-9]+$/.test(voiceId)) return 'elevenlabs';
    return 'openai';
}

export default function CallDispatcher() {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [prompt, setPrompt] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [syncResult, setSyncResult] = useState<any>(null);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState('');
    const [leadMode, setLeadMode] = useState<'manual' | 'sheets'>('manual');
    const [health, setHealth] = useState<AgentHealth | null>(null);
    const [healthLoading, setHealthLoading] = useState(true);
    const [modelProvider, setModelProvider] = useState('groq');
    const [voiceId, setVoiceId] = useState('anushka');
    const [sttProvider, setSttProvider] = useState('deepgram');

    const checkHealth = useCallback(async () => {
        setHealthLoading(true);
        try {
            const res = await fetch('/api/agent/health');
            const data = await res.json();
            setHealth(data);
        } catch {
            setHealth({ status: 'degraded', ready: false, checks: { agent_process: { ok: false, detail: 'dashboard error' } } });
        } finally {
            setHealthLoading(false);
        }
    }, []);

    useEffect(() => {
        checkHealth();
        const interval = setInterval(checkHealth, 30000);
        return () => clearInterval(interval);
    }, [checkHealth]);

    useEffect(() => {
        fetch('/api/campaigns?status=active')
            .then(res => res.json())
            .then(data => setCampaigns(data.campaigns || []))
            .catch(() => {});
    }, []);

    const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);
    const isSheetsCampaign = selectedCampaign?.lead_source?.type === 'google_sheets';

    const handleCampaignChange = (id: string) => {
        setSelectedCampaignId(id);
        const c = campaigns.find(x => x.id === id);
        if (c) {
            setModelProvider(c.model_provider || 'groq');
            setVoiceId(c.voice_id || 'anushka');
        }
        if (c?.lead_source?.type !== 'google_sheets') setLeadMode('manual');
        setSyncResult(null);
        setStatus('idle');
        setMessage('');
    };

    const handleDispatch = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('loading');
        setMessage('');
        setSyncResult(null);

        // ── Google Sheet mode ─────────────────────────────────────────────
        if (leadMode === 'sheets') {
            try {
                const res = await fetch('/api/campaigns/sheets-sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campaignId: selectedCampaignId }),
                });
                const data = await res.json();
                setSyncResult(data);
                setStatus(res.ok ? 'success' : 'error');
            } catch (err: any) {
                setSyncResult({ error: err.message });
                setStatus('error');
            }
            return;
        }

        // ── Manual mode ───────────────────────────────────────────────────
        try {
            const res = await fetch('/api/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber,
                    prompt,
                    modelProvider,
                    voice: voiceId,
                    ttsProvider: inferTtsProvider(voiceId),
                    sttProvider,
                    campaignId: selectedCampaignId || undefined,
                }),
            });

            const data = await res.json();

            if (res.ok) {
                setStatus('success');
                const campaignLabel = selectedCampaign ? ` [${selectedCampaign.name}]` : '';
                setMessage(`Call dispatched to ${phoneNumber}${campaignLabel}`);
            } else {
                setStatus('error');
                setMessage(data.error || 'Failed to dispatch call');
            }
        } catch (err: any) {
            setStatus('error');
            setMessage(err.message || 'Network error');
        }
    };

    return (
        <div className="relative group max-w-md w-full">
            {/* Glow Effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 blur-lg animate-tilt"></div>

            <div className="relative p-8 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                        Deploy Agent
                    </h2>
                    <Sparkles className="w-5 h-5 text-purple-400 animate-pulse" />
                </div>

                {/* Agent Connection Status */}
                <div className={`flex items-center justify-between p-3 rounded-xl border mb-6 transition-all ${
                    healthLoading ? 'bg-white/5 border-white/10' :
                    health?.ready ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'
                }`}>
                    <div className="flex items-center gap-3">
                        {healthLoading ? (
                            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : health?.ready ? (
                            <Wifi className="w-4 h-4 text-green-400" />
                        ) : (
                            <WifiOff className="w-4 h-4 text-red-400" />
                        )}
                        <div>
                            <p className={`text-sm font-medium ${
                                healthLoading ? 'text-gray-400' :
                                health?.ready ? 'text-green-300' : 'text-red-300'
                            }`}>
                                {healthLoading ? 'Checking connection...' :
                                 health?.ready ? 'Agent Connected' : 'Agent Offline'}
                            </p>
                            {!healthLoading && health && !health.ready && (
                                <p className="text-xs text-red-400/70 mt-0.5">
                                    {Object.entries(health.checks)
                                        .filter(([, c]) => !c.ok)
                                        .map(([name, c]) => `${name.replace('_', ' ')}: ${c.detail}`)
                                        .join(' · ')}
                                </p>
                            )}
                            {!healthLoading && health?.ready && health.checks.agent_process?.latency_ms != null && (
                                <p className="text-xs text-green-400/50 mt-0.5">
                                    Latency: {health.checks.agent_process.latency_ms}ms · LiveKit: {health.checks.livekit_cloud?.latency_ms}ms
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={checkHealth}
                        disabled={healthLoading}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-all disabled:opacity-50"
                        title="Refresh connection status"
                    >
                        <RefreshCw className={`w-4 h-4 ${healthLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <form onSubmit={handleDispatch} className="space-y-6">
                    {/* Campaign Selector */}
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
                            <Megaphone className="w-4 h-4" /> Campaign
                        </label>
                        <select
                            value={selectedCampaignId}
                            onChange={(e) => handleCampaignChange(e.target.value)}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="">Custom (No Campaign)</option>
                            {campaigns.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        {selectedCampaign && (
                            <p className="text-xs text-gray-500">{selectedCampaign.description}</p>
                        )}
                    </div>

                    {/* Lead Source Tabs */}
                    <div className="space-y-3">
                        <div className="flex rounded-xl overflow-hidden border border-white/10 text-sm">
                            <button
                                type="button"
                                onClick={() => setLeadMode('manual')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors ${
                                    leadMode === 'manual'
                                        ? 'bg-purple-600/30 text-purple-300'
                                        : 'bg-white/5 text-gray-500 hover:text-gray-300 hover:bg-white/10'
                                }`}
                            >
                                <PhoneCall className="w-3.5 h-3.5" /> Phone Number
                            </button>
                            {isSheetsCampaign && (
                                <button
                                    type="button"
                                    onClick={() => setLeadMode('sheets')}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 border-l border-white/10 transition-colors ${
                                        leadMode === 'sheets'
                                            ? 'bg-emerald-600/30 text-emerald-300'
                                            : 'bg-white/5 text-gray-500 hover:text-gray-300 hover:bg-white/10'
                                    }`}
                                >
                                    <Sheet className="w-3.5 h-3.5" /> Google Sheet
                                </button>
                            )}
                        </div>

                        {/* Manual: phone input */}
                        {leadMode === 'manual' && (
                            <div>
                                <input
                                    type="tel"
                                    placeholder="+919876543210"
                                    required
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-600 outline-none transition-all duration-300"
                                />
                            </div>
                        )}

                        {/* Sheets: sheet info panel */}
                        {leadMode === 'sheets' && selectedCampaign?.lead_source && (
                            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                                <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium">
                                    <Sheet className="w-4 h-4" /> Google Sheet
                                </div>
                                <div className="text-xs text-gray-400 space-y-1 font-mono">
                                    <div>Sheet ID: <span className="text-gray-300">{selectedCampaign.lead_source.sheet_id?.slice(0, 24)}…</span></div>
                                    <div>Tab: <span className="text-gray-300">{selectedCampaign.lead_source.tab_name || 'Leads'}</span></div>
                                </div>
                                <p className="text-xs text-emerald-400/70">
                                    Dispatches all undialed leads (Col D empty). Writes sentinel before each call.
                                </p>
                            </div>
                        )}
                    </div>

                    {!selectedCampaignId && (
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" /> Context / Prompt
                            </label>
                            <textarea
                                placeholder="e.g. You are calling regarding a coffee order..."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent text-white placeholder-gray-600 outline-none transition-all duration-300 h-28 resize-none"
                            />
                        </div>
                    )}

                    {selectedCampaignId && (
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" /> Additional Instructions (Optional)
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Customer name is Rahul, EMI amount is 5000..."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent text-white placeholder-gray-600 outline-none transition-all duration-300"
                            />
                        </div>
                    )}

                    {/* LLM + STT row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium flex items-center gap-1.5">
                                LLM
                            </label>
                            <select
                                className="w-full px-3 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                value={modelProvider}
                                onChange={(e) => setModelProvider(e.target.value)}
                            >
                                <option value="groq-fast">Groq Llama 3.1 8B ⚡ (lowest latency)</option>
                                <option value="groq">Groq Llama 3.3 70B</option>
                                <option value="gemini">Google Gemini 2.5 Flash</option>
                                <option value="openai">OpenAI (GPT-4o)</option>
                                <option value="openai-mini">OpenAI (GPT-4o mini)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium flex items-center gap-1.5">
                                <Mic className="w-3.5 h-3.5" /> STT
                            </label>
                            <select
                                className="w-full px-3 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                value={sttProvider}
                                onChange={(e) => setSttProvider(e.target.value)}
                            >
                                <option value="deepgram">Deepgram Nova-2</option>
                                <option value="deepgram-nova3">Deepgram Nova-3</option>
                                <option value="elevenlabs">ElevenLabs Scribe</option>
                            </select>
                        </div>
                    </div>

                    {/* TTS Voice */}
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium flex items-center gap-1.5">
                            <Volume2 className="w-3.5 h-3.5" /> Voice (TTS)
                            {voiceId && (
                                <span className="ml-auto text-xs px-2 py-0.5 rounded bg-white/5 text-gray-500 capitalize">
                                    {inferTtsProvider(voiceId)}
                                </span>
                            )}
                        </label>
                        <select
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                            value={voiceId}
                            onChange={(e) => setVoiceId(e.target.value)}
                        >
                            <optgroup label="Google Cloud — Hindi (1M chars/mo free)">
                                <option value="hi-IN-Wavenet-A">hi-IN Wavenet-A (Female)</option>
                                <option value="hi-IN-Wavenet-D">hi-IN Wavenet-D (Female)</option>
                                <option value="hi-IN-Wavenet-B">hi-IN Wavenet-B (Male)</option>
                                <option value="hi-IN-Wavenet-C">hi-IN Wavenet-C (Male)</option>
                                <option value="hi-IN-Neural2-A">hi-IN Neural2-A (Female, premium)</option>
                                <option value="hi-IN-Neural2-D">hi-IN Neural2-D (Female, premium)</option>
                                <option value="hi-IN-Neural2-B">hi-IN Neural2-B (Male, premium)</option>
                                <option value="hi-IN-Neural2-C">hi-IN Neural2-C (Male, premium)</option>
                            </optgroup>
                            <optgroup label="ElevenLabs — Female (free tier)">
                                <option value="EXAVITQu4vr4xnSDxMaL">Sarah (Mature, Reassuring)</option>
                                <option value="cgSgspJ2msm6clMCkdW9">Jessica (Playful, Warm)</option>
                                <option value="hpp4J3VqNfWAUOO0d1Us">Bella (Professional, Bright)</option>
                                <option value="XrExE9yKIg1WjnnlVkGX">Matilda (Knowledgable, Professional)</option>
                                <option value="Xb7hH8MSUJpSbSDYk0k2">Alice (Clear, Engaging Educator)</option>
                                <option value="pFZP5JQG7iQjIQuC4Bku">Lily (Velvety Actress)</option>
                                <option value="FGY2WhTYpPnrIDTdsKH5">Laura (Quirky, Enthusiast)</option>
                                <option value="SAz9YHcvj6GT2YYXdXww">River (Relaxed, Neutral)</option>
                            </optgroup>
                            <optgroup label="ElevenLabs — Male (free tier)">
                                <option value="cjVigY5qzO86Huf0OWal">Eric (Smooth, Trustworthy)</option>
                                <option value="bIHbv24MWmeRgasZH58o">Will (Relaxed Optimist)</option>
                                <option value="iP95p4xoKVk53GoZ742B">Chris (Charming, Down-to-Earth)</option>
                                <option value="CwhRBWXzGAHq8TQ4Fs17">Roger (Laid-Back, Casual)</option>
                                <option value="onwK4e9ZLuTAKqWW03F9">Daniel (Steady Broadcaster)</option>
                                <option value="JBFqnCBsd6RMkjVDRZzb">George (Warm Storyteller)</option>
                                <option value="IKne3meq5aSn9XLyUdCD">Charlie (Deep, Confident)</option>
                                <option value="nPczCjzI2devNBz1zQrb">Brian (Deep, Resonant)</option>
                                <option value="pqHfZKP75CvOlQylNhV4">Bill (Wise, Mature)</option>
                                <option value="pNInz6obpgDQGcFmaJgB">Adam (Dominant, Firm)</option>
                                <option value="TX3LPaxmHKxFdv7VOQHJ">Liam (Energetic)</option>
                                <option value="N2lVS1w4EtoT3dr4eOWO">Callum (Husky)</option>
                            </optgroup>
                            <optgroup label="ElevenLabs — Hindi (paid plan only)">
                                <option value="jUjRbhZWoMK4aDciW36V">Anika (Insurance / Customer Care)</option>
                                <option value="ni6cdqyS9wBvic5LPA7M">Tara (Expressive Conversational)</option>
                                <option value="ALCIIw5qAlLDox8iBl0U">Alisha (Soft-Spoken Customer Care)</option>
                            </optgroup>
                            <optgroup label="Sarvam — Indian">
                                <option value="anushka">Anushka (Female)</option>
                                <option value="arya">Arya (Male)</option>
                                <option value="abhilash">Abhilash (Male)</option>
                            </optgroup>
                            <optgroup label="Deepgram — English">
                                <option value="aura-asteria-en">Asteria (Female)</option>
                                <option value="aura-luna-en">Luna (Female)</option>
                                <option value="aura-orion-en">Orion (Male)</option>
                                <option value="aura-arcas-en">Arcas (Male)</option>
                            </optgroup>
                            <optgroup label="OpenAI">
                                <option value="alloy">Alloy</option>
                                <option value="echo">Echo</option>
                                <option value="shimmer">Shimmer</option>
                            </optgroup>
                        </select>
                    </div>

                    <button
                        type="submit"
                        disabled={status === 'loading' || (leadMode === 'manual' && !health?.ready && !healthLoading)}
                        className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg hover:shadow-blue-500/25 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                        {status === 'loading' ? (
                            <><Loader2 className="w-5 h-5 animate-spin" /> {leadMode === 'sheets' ? 'Syncing Sheet…' : 'Dispatching…'}</>
                        ) : leadMode === 'manual' && !health?.ready && !healthLoading ? (
                            'Agent Offline — Cannot Dispatch'
                        ) : leadMode === 'sheets' ? (
                            <><RefreshCw className="w-4 h-4" /> Sync from Sheet</>
                        ) : (
                            'Initiate Call'
                        )}
                    </button>

                    {/* Manual call result */}
                    {message && leadMode === 'manual' && (
                        <div className={`p-4 rounded-xl text-sm text-center border animate-in fade-in slide-in-from-bottom-2 ${status === 'success' ? 'bg-green-500/10 text-green-200 border-green-500/20' : 'bg-red-500/10 text-red-200 border-red-500/20'}`}>
                            {message}
                        </div>
                    )}

                    {/* Sheet sync result */}
                    {syncResult && (
                        <div className={`p-4 rounded-xl text-sm border animate-in fade-in slide-in-from-bottom-2 space-y-1 ${
                            status === 'success' ? 'bg-green-500/10 text-green-200 border-green-500/20' : 'bg-red-500/10 text-red-200 border-red-500/20'
                        }`}>
                            {syncResult.message ? (
                                <p>{syncResult.message}</p>
                            ) : syncResult.error ? (
                                <p>{syncResult.error}</p>
                            ) : (
                                <>
                                    <p className="font-medium">{syncResult.dispatched} call{syncResult.dispatched !== 1 ? 's' : ''} dispatched</p>
                                    {syncResult.available_leads !== undefined && (
                                        <p className="text-xs opacity-70">{syncResult.available_leads} undialed leads · Tab: {syncResult.tab}</p>
                                    )}
                                    {syncResult.failed > 0 && <p className="text-red-400 text-xs">{syncResult.failed} failed</p>}
                                    {syncResult.errors?.map((err: string, i: number) => (
                                        <p key={i} className="text-red-400 text-xs font-mono">{err}</p>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}
