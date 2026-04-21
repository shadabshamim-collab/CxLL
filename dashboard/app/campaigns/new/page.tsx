"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function NewCampaignPage() {
    const router = useRouter();
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    const [form, setForm] = useState({
        name: '',
        description: '',
        system_prompt: '',
        initial_greeting: '',
        fallback_greeting: '',
        model_provider: 'groq',
        voice_id: 'aura-asteria-en',
        language: 'en',
        transfer_number: '',
    });

    const handleCreate = async () => {
        if (!form.name.trim() || !form.system_prompt.trim()) {
            setMessage('Name and System Prompt are required');
            return;
        }

        setSaving(true);
        setMessage('');

        try {
            const res = await fetch('/api/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    changed_by: 'dashboard',
                }),
            });

            if (res.ok) {
                const data = await res.json();
                router.push(`/campaigns/${data.campaign.id}`);
            } else {
                const data = await res.json();
                setMessage(data.error || 'Failed to create campaign');
            }
        } catch (e: any) {
            setMessage(e.message || 'Error creating campaign');
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="min-h-screen bg-[#050505] text-white p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <Link href="/campaigns" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-2xl font-bold">New Campaign</h1>
                </div>

                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Campaign Name *</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g. Insurance Renewal - English"
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-gray-400 font-medium">Description</label>
                            <input
                                type="text"
                                value={form.description}
                                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Brief description of this campaign"
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm text-gray-400 font-medium">System Prompt *</label>
                            <span className="text-xs text-gray-600">{form.system_prompt.length} chars</span>
                        </div>
                        <textarea
                            value={form.system_prompt}
                            onChange={e => setForm(prev => ({ ...prev, system_prompt: e.target.value }))}
                            placeholder="Define the agent's personality, behavior, conversation flow, and guardrails..."
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm leading-relaxed resize-y"
                            rows={20}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium">Initial Greeting</label>
                        <textarea
                            value={form.initial_greeting}
                            onChange={e => setForm(prev => ({ ...prev, initial_greeting: e.target.value }))}
                            placeholder="Instructions for the agent's first message when the call is answered..."
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm resize-y"
                            rows={4}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium">Fallback Greeting</label>
                        <textarea
                            value={form.fallback_greeting}
                            onChange={e => setForm(prev => ({ ...prev, fallback_greeting: e.target.value }))}
                            placeholder="Greeting for when user is already in the room..."
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm resize-y"
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

                    {message && (
                        <div className="p-4 rounded-xl text-sm text-center border bg-red-500/10 text-red-200 border-red-500/20">
                            {message}
                        </div>
                    )}

                    <button
                        onClick={handleCreate}
                        disabled={saving}
                        className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        Create Campaign
                    </button>
                </div>
            </div>
        </main>
    );
}
