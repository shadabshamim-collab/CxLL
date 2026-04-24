"use client";

import { useState, useEffect, useCallback } from 'react';
import { Phone, MessageSquare, Loader2, Sparkles, Megaphone, Wifi, WifiOff, RefreshCw, Sheet, PhoneCall } from 'lucide-react';

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
        const form = e.target as HTMLFormElement;
        const modelProvider = (form.elements.namedItem('modelProvider') as HTMLSelectElement).value;
        const voice = (form.elements.namedItem('voice') as HTMLSelectElement).value;

        try {
            const res = await fetch('/api/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber,
                    prompt,
                    modelProvider,
                    voice,
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

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Model provider</label>
                            <select
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500"
                                name="modelProvider"
                                value={selectedCampaign ? selectedCampaign.model_provider : undefined}
                                defaultValue="groq"
                            >
                                <option value="groq">Groq (Llama 3.3 - Fast)</option>
                                <option value="openai">OpenAI (GPT-4o)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Voice</label>
                            <select
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                                name="voice"
                                value={selectedCampaign ? selectedCampaign.voice_id : undefined}
                                defaultValue="aura-asteria-en"
                            >
                                <optgroup label="Deepgram (Fastest)">
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
                                <optgroup label="Sarvam (Indian)">
                                    <option value="anushka">Anushka (Female)</option>
                                    <option value="arya">Arya (Male)</option>
                                    <option value="abhilash">Abhilash (Male)</option>
                                </optgroup>
                            </select>
                        </div>
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
