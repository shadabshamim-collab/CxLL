"use client";

import { useState, useEffect } from 'react';
import { Phone, Loader2, X, Volume2 } from 'lucide-react';
import Link from 'next/link';

interface ActiveCall {
    id: string;
    room_name: string;
    campaign_id?: string;
    campaign_name?: string;
    phone_number: string;
    model_provider?: string;
    voice_id?: string;
    turn_count?: number;
    avg_turn_latency_ms?: number;
    transcript?: string;
    connected_at: string;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function formatDuration(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function maskPhone(phone: string): string {
    if (phone.length <= 6) return '******';
    return phone.slice(0, phone.length - 6) + '******';
}

export default function MonitorPage() {
    const [calls, setCalls] = useState<ActiveCall[]>([]);
    const [selectedCall, setSelectedCall] = useState<ActiveCall | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const eventSource = new EventSource('/api/calls/stream');

        eventSource.onopen = () => {
            setConnected(true);
            console.log('[Monitor] Connected to stream');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'initial') {
                    // Initial list of all calls
                    const activeCalls = (data.logs || []).filter((log: any) =>
                        log.status === 'connected' || log.status === 'ringing' || log.status === 'dialing'
                    );
                    setCalls(activeCalls);
                } else {
                    // Update to an existing call or new call
                    setCalls(prev => {
                        const idx = prev.findIndex(c => c.room_name === data.room_name);
                        if (idx === -1 && data.type !== 'call_ended') {
                            return [...prev, { id: data.room_name, ...data }];
                        } else if (idx !== -1) {
                            if (data.type === 'call_ended') {
                                return prev.filter((_, i) => i !== idx);
                            }
                            const updated = [...prev];
                            updated[idx] = { ...updated[idx], ...data };
                            return updated;
                        }
                        return prev;
                    });

                    // Update selected call if it's the one being updated
                    if (selectedCall && selectedCall.room_name === data.room_name) {
                        if (data.type === 'call_ended') {
                            setSelectedCall(null);
                        } else {
                            setSelectedCall(prev => prev ? { ...prev, ...data } : null);
                        }
                    }
                }
            } catch (e) {
                console.warn('[Monitor] Parse error:', e);
            }
        };

        eventSource.onerror = (e) => {
            setConnected(false);
            console.error('[Monitor] Stream error:', e);
            setTimeout(() => {
                eventSource.close();
            }, 3000);
        };

        return () => {
            eventSource.close();
        };
    }, [selectedCall]);

    return (
        <main className="min-h-screen bg-[#050505] text-white p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                                Live Monitor
                            </h1>
                        </div>
                        <p className="text-gray-500">{calls.length} active call{calls.length !== 1 ? 's' : ''}</p>
                    </div>
                    <Link
                        href="/analytics"
                        className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm hover:bg-white/10 transition-colors"
                    >
                        Analytics
                    </Link>
                </div>

                {!connected && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                        ⚠️ Streaming disconnected. Reconnecting...
                    </div>
                )}

                {/* Active Calls Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Active Calls</h2>
                        {calls.length === 0 ? (
                            <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-gray-500">
                                <Phone className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                <p>No active calls</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {calls.map(call => (
                                    <div
                                        key={call.room_name}
                                        onClick={() => setSelectedCall(call)}
                                        className={`p-4 rounded-lg border transition-all cursor-pointer ${
                                            selectedCall?.room_name === call.room_name
                                                ? 'bg-purple-500/10 border-purple-500/30'
                                                : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className="relative">
                                                    <Phone className="w-4 h-4 text-green-400" />
                                                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                                </div>
                                                <span className="font-mono text-white">{maskPhone(call.phone_number)}</span>
                                            </div>
                                            <span className="text-xs text-gray-500">{formatTime(call.connected_at)}</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mb-2">{call.campaign_name || 'No campaign'}</p>
                                        <div className="flex gap-2 text-xs text-gray-500">
                                            <span>Turns: {call.turn_count ?? 0}</span>
                                            {call.avg_turn_latency_ms && (
                                                <span>Latency: {call.avg_turn_latency_ms}ms</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Transcript Panel */}
                    {selectedCall ? (
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Live Transcript</h2>
                                <button
                                    onClick={() => setSelectedCall(null)}
                                    className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                                >
                                    <X className="w-4 h-4 text-gray-500" />
                                </button>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl h-[500px] flex flex-col">
                                {/* Header */}
                                <div className="border-b border-white/10 p-4">
                                    <p className="text-sm font-semibold text-white">{maskPhone(selectedCall.phone_number)}</p>
                                    <p className="text-xs text-gray-400 mt-1">{selectedCall.campaign_name || 'Unknown campaign'}</p>
                                    <div className="flex gap-4 mt-3 text-xs text-gray-500">
                                        <span>Turns: {selectedCall.turn_count ?? 0}</span>
                                        {selectedCall.avg_turn_latency_ms && (
                                            <span>Latency: {selectedCall.avg_turn_latency_ms}ms</span>
                                        )}
                                        {selectedCall.model_provider && (
                                            <span>Model: {selectedCall.model_provider}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Transcript Scroll Area */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {selectedCall.transcript ? (
                                        selectedCall.transcript.split('\n').map((line, i) => {
                                            const isAgent = line.startsWith('Agent:');
                                            return (
                                                <div key={i} className={`text-sm font-mono ${isAgent ? 'text-blue-300' : 'text-green-300'}`}>
                                                    <span className={`mr-2 ${isAgent ? '🤖' : '👤'}`}></span>
                                                    <span className="text-gray-400">{line}</span>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                            Waiting for transcript...
                                        </div>
                                    )}
                                </div>

                                {/* Status Bar */}
                                <div className="border-t border-white/10 px-4 py-3 bg-white/5">
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                        <span>Live • Call in progress</span>
                                        {selectedCall.voice_id && (
                                            <span className="ml-auto">Voice: {selectedCall.voice_id.substring(0, 8)}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-gray-500 flex items-center justify-center h-[500px]">
                            {calls.length > 0 ? (
                                <div>
                                    <Volume2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                    <p>Select a call to view transcript</p>
                                </div>
                            ) : (
                                <p>No calls to monitor</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
