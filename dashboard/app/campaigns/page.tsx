"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Copy, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';

interface Campaign {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'inactive';
    model_provider: string;
    voice_id: string;
    language: string;
    current_version: number;
    updated_at: string;
}

export default function CampaignsPage() {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchCampaigns = async () => {
        try {
            const res = await fetch('/api/campaigns');
            const data = await res.json();
            setCampaigns(data.campaigns || []);
        } catch (e) {
            console.error('Failed to fetch campaigns', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchCampaigns(); }, []);

    const toggleStatus = async (id: string, currentStatus: string) => {
        setActionLoading(id);
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        try {
            await fetch(`/api/campaigns/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            await fetchCampaigns();
        } catch (e) {
            console.error('Failed to toggle status', e);
        } finally {
            setActionLoading(null);
        }
    };

    const duplicateCampaign = async (id: string, name: string) => {
        setActionLoading(id);
        try {
            const res = await fetch(`/api/campaigns/${id}`);
            const { campaign } = await res.json();
            if (!campaign) return;

            await fetch('/api/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...campaign,
                    name: `${name} (Copy)`,
                }),
            });
            await fetchCampaigns();
        } catch (e) {
            console.error('Failed to duplicate', e);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-[#050505] text-white p-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                            Campaigns
                        </h1>
                        <p className="text-gray-500 mt-1">{campaigns.length} campaigns configured</p>
                    </div>
                    <Link
                        href="/campaigns/new"
                        className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all duration-300 transform hover:-translate-y-0.5"
                    >
                        <Plus className="w-4 h-4" /> New Campaign
                    </Link>
                </div>

                <div className="space-y-4">
                    {campaigns.map((c) => (
                        <div
                            key={c.id}
                            className={`p-6 bg-white/5 border rounded-xl transition-all duration-300 ${
                                c.status === 'active' ? 'border-white/10' : 'border-white/5 opacity-60'
                            }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h3 className="text-lg font-semibold text-white truncate">{c.name}</h3>
                                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                                            c.status === 'active'
                                                ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                                                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                        }`}>
                                            {c.status}
                                        </span>
                                        <span className="text-xs text-gray-600">v{c.current_version}</span>
                                    </div>
                                    <p className="text-sm text-gray-500 truncate">{c.description}</p>
                                    <div className="flex gap-3 mt-3">
                                        <span className="text-xs px-2 py-1 bg-white/5 rounded text-gray-400">{c.model_provider}</span>
                                        <span className="text-xs px-2 py-1 bg-white/5 rounded text-gray-400">{c.voice_id}</span>
                                        <span className="text-xs px-2 py-1 bg-white/5 rounded text-gray-400">{c.language}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 ml-4">
                                    <Link
                                        href={`/campaigns/${c.id}`}
                                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                                        title="Edit"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </Link>
                                    <button
                                        onClick={() => duplicateCampaign(c.id, c.name)}
                                        disabled={actionLoading === c.id}
                                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                                        title="Duplicate"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => toggleStatus(c.id, c.status)}
                                        disabled={actionLoading === c.id}
                                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                                        title={c.status === 'active' ? 'Deactivate' : 'Activate'}
                                    >
                                        {c.status === 'active' ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}

                    {campaigns.length === 0 && (
                        <div className="text-center py-16 text-gray-600">
                            <p className="text-lg">No campaigns yet</p>
                            <p className="text-sm mt-2">Create your first campaign to get started</p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
