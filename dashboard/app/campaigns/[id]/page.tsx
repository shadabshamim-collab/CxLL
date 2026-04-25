"use client";

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, History, RotateCcw } from 'lucide-react';
import Link from 'next/link';

interface CampaignVersion {
    version: number;
    system_prompt: string;
    initial_greeting: string;
    changed_by: string;
    changed_at: string;
    change_note: string;
}

interface Campaign {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'inactive';
    system_prompt: string;
    initial_greeting: string;
    fallback_greeting: string;
    model_provider: string;
    voice_id: string;
    language: string;
    transfer_number: string;
    vad_min_silence_duration?: number;
    llm_temperature?: number;
    max_completion_tokens?: number;
    stt_language?: string;
    current_version: number;
    versions: CampaignVersion[];
    created_at: string;
    updated_at: string;
}

export default function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [changeNote, setChangeNote] = useState('');
    const [showVersions, setShowVersions] = useState(false);

    const [form, setForm] = useState({
        name: '',
        description: '',
        status: 'active' as 'active' | 'inactive',
        system_prompt: '',
        initial_greeting: '',
        fallback_greeting: '',
        model_provider: 'groq',
        voice_id: 'aura-asteria-en',
        language: 'en',
        transfer_number: '',
        vad_min_silence_duration: 0.4,
        llm_temperature: 0.6,
        max_completion_tokens: 1200,
        stt_language: 'en',
    });

    useEffect(() => {
        fetch(`/api/campaigns/${id}`)
            .then(res => res.json())
            .then(data => {
                if (data.campaign) {
                    setCampaign(data.campaign);
                    setForm({
                        name: data.campaign.name,
                        description: data.campaign.description,
                        status: data.campaign.status,
                        system_prompt: data.campaign.system_prompt,
                        initial_greeting: data.campaign.initial_greeting,
                        fallback_greeting: data.campaign.fallback_greeting,
                        model_provider: data.campaign.model_provider,
                        voice_id: data.campaign.voice_id,
                        language: data.campaign.language,
                        transfer_number: data.campaign.transfer_number,
                        vad_min_silence_duration: data.campaign.vad_min_silence_duration ?? 0.4,
                        llm_temperature: data.campaign.llm_temperature ?? 0.6,
                        max_completion_tokens: data.campaign.max_completion_tokens ?? 1200,
                        stt_language: data.campaign.stt_language ?? 'en',
                    });
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [id]);

    const handleSave = async () => {
        const promptChanged =
            form.system_prompt !== campaign?.system_prompt ||
            form.initial_greeting !== campaign?.initial_greeting;

        if (promptChanged && !changeNote.trim()) {
            setMessage('Change note is required when updating prompts');
            return;
        }

        setSaving(true);
        setMessage('');

        try {
            const res = await fetch(`/api/campaigns/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    change_note: changeNote || undefined,
                    changed_by: 'dashboard',
                }),
            });

            if (res.ok) {
                const data = await res.json();
                setCampaign(data.campaign);
                setChangeNote('');
                setMessage('Campaign saved successfully');
            } else {
                const data = await res.json();
                setMessage(data.error || 'Failed to save');
            }
        } catch (e: any) {
            setMessage(e.message || 'Error saving campaign');
        } finally {
            setSaving(false);
        }
    };

    const restoreVersion = async (version: number) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/campaigns/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ restore_version: version }),
            });

            if (res.ok) {
                const data = await res.json();
                setCampaign(data.campaign);
                setForm(prev => ({
                    ...prev,
                    system_prompt: data.campaign.system_prompt,
                    initial_greeting: data.campaign.initial_greeting,
                }));
                setMessage(`Restored to version ${version}`);
            }
        } catch (e: any) {
            setMessage(e.message || 'Error restoring version');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
                <p className="text-gray-500">Campaign not found</p>
            </div>
        );
    }

    const promptChanged =
        form.system_prompt !== campaign.system_prompt ||
        form.initial_greeting !== campaign.initial_greeting;

    return (
        <main className="min-h-screen bg-[#050505] text-white p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <Link href="/campaigns" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div className="flex-1">
                        <h1 className="text-2xl font-bold">Edit Campaign</h1>
                        <p className="text-sm text-gray-500">v{campaign.current_version} &middot; Last updated {new Date(campaign.updated_at).toLocaleString()}</p>
                    </div>
                    <button
                        onClick={() => setShowVersions(!showVersions)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-gray-400 hover:text-white transition-colors"
                    >
                        <History className="w-4 h-4" /> Versions ({campaign.versions.length})
                    </button>
                </div>

                {showVersions && (
                    <div className="mb-8 p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                        <h3 className="text-sm font-semibold text-gray-400 mb-3">Version History</h3>
                        {[...campaign.versions].reverse().map((v) => (
                            <div key={v.version} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                                <div>
                                    <span className="text-sm text-white font-medium">v{v.version}</span>
                                    <span className="text-xs text-gray-500 ml-3">{v.change_note}</span>
                                    <span className="text-xs text-gray-600 ml-3">
                                        by {v.changed_by} &middot; {new Date(v.changed_at).toLocaleString()}
                                    </span>
                                </div>
                                {v.version !== campaign.current_version && (
                                    <button
                                        onClick={() => restoreVersion(v.version)}
                                        disabled={saving}
                                        className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                                    >
                                        <RotateCcw className="w-3 h-3" /> Restore
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Campaign Name</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Status</label>
                            <select
                                value={form.status}
                                onChange={e => setForm(prev => ({ ...prev, status: e.target.value as 'active' | 'inactive' }))}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium">Description</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm text-gray-400 font-medium">System Prompt</label>
                            <span className="text-xs text-gray-600">{form.system_prompt.length} chars &middot; ~{form.system_prompt.split('\n').length} lines</span>
                        </div>
                        <textarea
                            value={form.system_prompt}
                            onChange={e => setForm(prev => ({ ...prev, system_prompt: e.target.value }))}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm leading-relaxed resize-y"
                            rows={20}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium">Initial Greeting</label>
                        <textarea
                            value={form.initial_greeting}
                            onChange={e => setForm(prev => ({ ...prev, initial_greeting: e.target.value }))}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm resize-y"
                            rows={4}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium">Fallback Greeting</label>
                        <textarea
                            value={form.fallback_greeting}
                            onChange={e => setForm(prev => ({ ...prev, fallback_greeting: e.target.value }))}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm resize-y"
                            rows={3}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Model Provider</label>
                            <select
                                value={form.model_provider}
                                onChange={e => setForm(prev => ({ ...prev, model_provider: e.target.value }))}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="groq">Groq (Llama 3.3)</option>
                                <option value="openai">OpenAI (GPT-4o)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Voice</label>
                            <select
                                value={form.voice_id}
                                onChange={e => setForm(prev => ({ ...prev, voice_id: e.target.value }))}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <optgroup label="Deepgram">
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
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Language</label>
                            <select
                                value={form.language}
                                onChange={e => setForm(prev => ({ ...prev, language: e.target.value }))}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="en">English</option>
                                <option value="hi-IN">Hindi (India)</option>
                                <option value="en-IN">English (India)</option>
                            </select>
                        </div>
                    </div>

                    {/* Voice & Tuning */}
                    <div className="p-5 bg-white/3 border border-white/10 rounded-xl space-y-5">
                        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Voice & Tuning</h3>

                        <div className="grid grid-cols-2 gap-6">
                            {/* VAD Silence Duration */}
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <label className="text-sm text-gray-400 font-medium">Silence Threshold</label>
                                    <span className="text-sm text-purple-400 font-mono">{form.vad_min_silence_duration.toFixed(1)}s</span>
                                </div>
                                <input
                                    type="range" min="0.3" max="1.0" step="0.1"
                                    value={form.vad_min_silence_duration}
                                    onChange={e => setForm(prev => ({ ...prev, vad_min_silence_duration: parseFloat(e.target.value) }))}
                                    className="w-full accent-purple-500"
                                />
                                <p className="text-xs text-gray-600">How long agent waits after customer stops (0.3s = fast, 1.0s = patient)</p>
                            </div>

                            {/* LLM Temperature */}
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <label className="text-sm text-gray-400 font-medium">LLM Temperature</label>
                                    <span className="text-sm text-purple-400 font-mono">{form.llm_temperature.toFixed(1)}</span>
                                </div>
                                <input
                                    type="range" min="0.1" max="0.9" step="0.1"
                                    value={form.llm_temperature}
                                    onChange={e => setForm(prev => ({ ...prev, llm_temperature: parseFloat(e.target.value) }))}
                                    className="w-full accent-purple-500"
                                />
                                <p className="text-xs text-gray-600">Lower = scripted, higher = conversational</p>
                            </div>

                            {/* Max Completion Tokens */}
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <label className="text-sm text-gray-400 font-medium">Max Response Tokens</label>
                                    <span className="text-sm text-purple-400 font-mono">{form.max_completion_tokens}</span>
                                </div>
                                <input
                                    type="range" min="200" max="2000" step="100"
                                    value={form.max_completion_tokens}
                                    onChange={e => setForm(prev => ({ ...prev, max_completion_tokens: parseInt(e.target.value) }))}
                                    className="w-full accent-purple-500"
                                />
                                <p className="text-xs text-gray-600">Caps agent response length (~200 tokens ≈ 2 sentences)</p>
                            </div>

                            {/* STT Language */}
                            <div className="space-y-2">
                                <label className="text-sm text-gray-400 font-medium">STT Language Hint</label>
                                <select
                                    value={form.stt_language}
                                    onChange={e => setForm(prev => ({ ...prev, stt_language: e.target.value }))}
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="en">English (en)</option>
                                    <option value="hi">Hindi (hi)</option>
                                    <option value="hi-en">Hinglish — Hindi + English</option>
                                    <option value="multi">Multi-language (auto)</option>
                                </select>
                                <p className="text-xs text-gray-600">Helps STT model transcribe accurately</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium">Transfer Number</label>
                        <input
                            type="text"
                            value={form.transfer_number}
                            onChange={e => setForm(prev => ({ ...prev, transfer_number: e.target.value }))}
                            placeholder="+91XXXXXXXXXX"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>

                    {promptChanged && (
                        <div className="space-y-2 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                            <label className="text-sm text-yellow-300 font-medium">Change Note (required for prompt changes)</label>
                            <input
                                type="text"
                                value={changeNote}
                                onChange={e => setChangeNote(e.target.value)}
                                placeholder="e.g. Updated greeting to be more formal..."
                                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-yellow-500"
                            />
                        </div>
                    )}

                    {message && (
                        <div className={`p-4 rounded-xl text-sm text-center border ${
                            message.includes('success') || message.includes('Restored')
                                ? 'bg-green-500/10 text-green-200 border-green-500/20'
                                : 'bg-red-500/10 text-red-200 border-red-500/20'
                        }`}>
                            {message}
                        </div>
                    )}

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        Save Campaign
                    </button>
                </div>
            </div>
        </main>
    );
}
