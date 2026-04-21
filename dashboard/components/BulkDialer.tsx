"use client";

import { useState, useEffect, useRef } from 'react';
import { Users, FileText, Loader2, CheckCircle, AlertCircle, Megaphone, Upload } from 'lucide-react';

interface Campaign {
    id: string;
    name: string;
    description: string;
    status: string;
    model_provider: string;
    voice_id: string;
}

export default function BulkDialer() {
    const [input, setInput] = useState('');
    const [prompt, setPrompt] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [results, setResults] = useState<any[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState('');

    useEffect(() => {
        fetch('/api/campaigns?status=active')
            .then(res => res.json())
            .then(data => setCampaigns(data.campaigns || []))
            .catch(() => {});
    }, []);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const numbers: string[] = [];
            for (const line of text.split('\n')) {
                for (const col of line.split(',')) {
                    const cleaned = col.trim().replace(/["\s]/g, '');
                    if (cleaned.match(/^\+?\d{10,15}$/)) {
                        numbers.push(cleaned);
                    }
                }
            }
            if (numbers.length > 0) {
                setInput(prev => prev ? prev + '\n' + numbers.join('\n') : numbers.join('\n'));
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleBulkDispatch = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('loading');
        setResults([]);

        const numbers = input.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);

        if (numbers.length === 0) {
            setStatus('error');
            return;
        }

        try {
            const res = await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    numbers,
                    prompt,
                    campaignId: selectedCampaignId || undefined,
                    modelProvider: selectedCampaign?.model_provider,
                    voice: selectedCampaign?.voice_id,
                }),
            });

            const data = await res.json();
            setResults(data.results || []);

            if (res.ok) {
                setStatus('success');
            } else {
                setStatus('error');
            }
        } catch (err: any) {
            setStatus('error');
        }
    };

    return (
        <div className="relative group max-w-md w-full">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-green-500 to-teal-600 rounded-2xl opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 blur-lg animate-tilt"></div>

            <div className="relative p-8 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-teal-400">
                        Bulk Operations
                    </h2>
                    <Users className="w-5 h-5 text-teal-400" />
                </div>

                <form onSubmit={handleBulkDispatch} className="space-y-6">
                    {/* Campaign Selector */}
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
                            <Megaphone className="w-4 h-4" /> Campaign
                        </label>
                        <select
                            value={selectedCampaignId}
                            onChange={(e) => setSelectedCampaignId(e.target.value)}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-green-500"
                        >
                            <option value="">Custom (No Campaign)</option>
                            {campaigns.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        {selectedCampaign && (
                            <div className="flex gap-2 text-xs text-gray-500">
                                <span className="px-2 py-0.5 bg-white/5 rounded">{selectedCampaign.model_provider}</span>
                                <span className="px-2 py-0.5 bg-white/5 rounded">{selectedCampaign.voice_id}</span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
                            <Users className="w-4 h-4" /> Phone Numbers
                        </label>
                        <textarea
                            placeholder="+919876543210&#10;+919988776655&#10;+12125551234"
                            required
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent text-white placeholder-gray-600 outline-none transition-all duration-300 h-28 resize-none font-mono text-sm"
                        />
                        <div className="flex items-center justify-between">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors"
                            >
                                <Upload className="w-3 h-3" /> Upload CSV
                            </button>
                            <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCSVUpload} className="hidden" />
                            <p className="text-xs text-gray-500">
                                {input.split(/[\n,]+/).filter(s => s.trim()).length || 0} numbers
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
                            <FileText className="w-4 h-4" /> {selectedCampaignId ? 'Additional Instructions (Optional)' : 'Campaign Context'}
                        </label>
                        <input
                            type="text"
                            placeholder={selectedCampaignId ? "e.g. Focus on premium customers..." : "e.g. Survey about recent purchase..."}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent text-white placeholder-gray-600 outline-none transition-all duration-300"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={status === 'loading'}
                        className="w-full py-4 px-6 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg hover:shadow-green-500/25 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                        {status === 'loading' ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" /> Processing Queue...
                            </>
                        ) : (
                            'Launch Campaign'
                        )}
                    </button>

                    {status === 'success' && (
                        <div className="max-h-40 overflow-y-auto space-y-2 mt-4 custom-scrollbar">
                            {results.map((res, i) => (
                                <div key={i} className="flex items-center justify-between p-2 rounded bg-white/5 text-xs">
                                    <span className="font-mono text-gray-300">{res.phoneNumber}</span>
                                    {res.status === 'dispatched' ? (
                                        <span className="text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Sent</span>
                                    ) : (
                                        <span className="text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Failed</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}
