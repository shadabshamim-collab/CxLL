"use client";

import { useState, useEffect, useRef } from 'react';
import { Activity, Phone, CheckCircle, XCircle, Clock, Wifi, WifiOff } from 'lucide-react';

interface CallLog {
    id: string;
    phone_number: string;
    campaign_name: string;
    status: string;
    duration_seconds: number | null;
    outcome: string | null;
    dispatched_at: string;
}

interface Stats {
    total_calls: number;
    dispatched: number;
    connected: number;
    completed: number;
    failed: number;
    avg_duration_seconds: number | null;
}

interface StreamData {
    stats: Stats;
    recent: CallLog[];
    ts: number;
    error?: boolean;
}

const statusColors: Record<string, string> = {
    dispatched: 'text-yellow-400',
    dialing: 'text-yellow-400',
    ringing: 'text-blue-400',
    connected: 'text-blue-400 animate-pulse',
    completed: 'text-green-400',
    failed: 'text-red-400',
};

function maskPhone(phone: string): string {
    if (phone.length <= 6) return '******';
    return phone.slice(0, phone.length - 6) + '******';
}

function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

export default function LiveActivity() {
    const [data, setData] = useState<StreamData | null>(null);
    const [connected, setConnected] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let cancelled = false;

        const connectSSE = () => {
            try {
                const es = new EventSource('/api/calls/stream');
                eventSourceRef.current = es;

                es.onopen = () => {
                    if (!cancelled) setConnected(true);
                };

                es.onmessage = (event) => {
                    if (cancelled) return;
                    try {
                        const parsed = JSON.parse(event.data);
                        if (!parsed.error) {
                            setData(parsed);
                        }
                    } catch {}
                };

                es.onerror = () => {
                    if (cancelled) return;
                    setConnected(false);
                    es.close();
                    startPollingFallback();
                };
            } catch {
                startPollingFallback();
            }
        };

        const startPollingFallback = () => {
            if (fallbackRef.current || cancelled) return;
            const poll = async () => {
                try {
                    const [statsRes, logsRes] = await Promise.all([
                        fetch('/api/calls?view=stats'),
                        fetch('/api/calls?limit=10'),
                    ]);
                    const stats = await statsRes.json();
                    const logs = await logsRes.json();
                    if (!cancelled) {
                        setData({ stats, recent: logs.logs || [], ts: Date.now() });
                        setConnected(true);
                    }
                } catch {
                    if (!cancelled) setConnected(false);
                }
            };
            poll();
            fallbackRef.current = setInterval(poll, 5000);
        };

        connectSSE();

        return () => {
            cancelled = true;
            eventSourceRef.current?.close();
            if (fallbackRef.current) clearInterval(fallbackRef.current);
        };
    }, []);

    const activeCalls = data ? data.stats.dispatched + data.stats.connected : 0;

    return (
        <div className="w-full max-w-md">
            <div className="relative p-6 bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-semibold text-gray-300">Live Activity</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {connected ? (
                            <Wifi className="w-3 h-3 text-green-400" />
                        ) : (
                            <WifiOff className="w-3 h-3 text-red-400" />
                        )}
                        <span className={`text-[10px] ${connected ? 'text-green-400' : 'text-red-400'}`}>
                            {connected ? 'LIVE' : 'OFFLINE'}
                        </span>
                    </div>
                </div>

                {/* Quick Stats */}
                {data?.stats && (
                    <div className="grid grid-cols-4 gap-2 mb-4">
                        <div className="text-center p-2 rounded-lg bg-white/5">
                            <div className="text-lg font-bold text-white">{data.stats.total_calls}</div>
                            <div className="text-[9px] text-gray-500 uppercase">Total</div>
                        </div>
                        <div className="text-center p-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
                            <div className="text-lg font-bold text-blue-400">{activeCalls}</div>
                            <div className="text-[9px] text-gray-500 uppercase">Active</div>
                        </div>
                        <div className="text-center p-2 rounded-lg bg-green-500/5 border border-green-500/10">
                            <div className="text-lg font-bold text-green-400">{data.stats.completed}</div>
                            <div className="text-[9px] text-gray-500 uppercase">Done</div>
                        </div>
                        <div className="text-center p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                            <div className="text-lg font-bold text-red-400">{data.stats.failed}</div>
                            <div className="text-[9px] text-gray-500 uppercase">Failed</div>
                        </div>
                    </div>
                )}

                {/* Recent Calls */}
                <div className="space-y-1.5">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Recent Calls</div>
                    {data?.recent && data.recent.length > 0 ? (
                        data.recent.slice(0, 5).map((call) => (
                            <div key={call.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-2">
                                    <span className={`${statusColors[call.status] || 'text-gray-400'}`}>
                                        {call.status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                                         call.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                                         call.status === 'connected' ? <Phone className="w-3 h-3" /> :
                                         <Clock className="w-3 h-3" />}
                                    </span>
                                    <span className="text-xs font-mono text-gray-300">{maskPhone(call.phone_number)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-500 truncate max-w-[80px]">{call.campaign_name}</span>
                                    <span className="text-[10px] text-gray-600">{timeAgo(call.dispatched_at)}</span>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-xs text-gray-600 text-center py-3">No calls yet</div>
                    )}
                </div>

                {data?.stats && data.stats.avg_duration_seconds && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">Avg Duration</span>
                        <span className="text-xs text-purple-400 font-medium">
                            {Math.floor(data.stats.avg_duration_seconds / 60)}m {data.stats.avg_duration_seconds % 60}s
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
