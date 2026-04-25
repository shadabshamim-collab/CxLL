"use client";

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Phone, Clock, CheckCircle, XCircle, ArrowUpRight, RefreshCw, TrendingUp, Percent, Activity, PhoneOff, Copy, Check } from 'lucide-react';

interface LatencyData {
    dial_ms?: number;
    ttfr_ms?: number;
    avg_stt_ms?: number;
    avg_eou_delay_ms?: number;
    avg_llm_ttft_ms?: number;
    avg_llm_duration_ms?: number;
    avg_tts_ttfb_ms?: number;
    min_llm_ttft_ms?: number; max_llm_ttft_ms?: number;
    min_tts_ttfb_ms?: number; max_tts_ttfb_ms?: number;
    turns?: Array<Record<string, number>>;
}

interface CallLog {
    id: string;
    campaign_id: string;
    campaign_name: string;
    phone_number: string;
    room_name: string;
    status: string;
    dispatched_at: string;
    connected_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    outcome: string | null;
    disposition: string | null;
    sentiment: string | null;
    turn_count: number | null;
    avg_turn_latency_ms: number | null;
    transcript: string | null;
    model_provider: string;
    voice_id: string;
    error: string | null;
    latency: LatencyData | null;
}

interface Stats {
    total_calls: number;
    dispatched: number;
    connected: number;
    completed: number;
    failed: number;
    avg_duration_seconds: number | null;
    by_campaign: Record<string, {
        campaign_name: string;
        total: number;
        completed: number;
        failed: number;
        avg_duration: number | null;
    }>;
}

function maskPhone(phone: string): string {
    if (phone.length <= 6) return '******';
    return phone.slice(0, phone.length - 6) + '******';
}

function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === 0) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

function pct(numerator: number, denominator: number): string {
    if (denominator === 0) return '0%';
    return Math.round((numerator / denominator) * 100) + '%';
}

const statusColors: Record<string, string> = {
    dispatched: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    dialing: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    ringing: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    connected: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    completed: 'text-green-400 bg-green-500/10 border-green-500/20',
    failed: 'text-red-400 bg-red-500/10 border-red-500/20',
};

export default function AnalyticsPage() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [logs, setLogs] = useState<CallLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [filterCampaign, setFilterCampaign] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [searchPhone, setSearchPhone] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const sp = new URLSearchParams();
            if (filterCampaign) sp.set('campaign_id', filterCampaign);

            const statsUrl = `/api/calls?view=stats${filterCampaign ? `&campaign_id=${filterCampaign}` : ''}`;
            const logsUrl = `/api/calls?limit=100${filterCampaign ? `&campaign_id=${filterCampaign}` : ''}${filterStatus ? `&status=${filterStatus}` : ''}`;

            const [statsRes, logsRes] = await Promise.all([
                fetch(statsUrl),
                fetch(logsUrl),
            ]);

            const statsData = await statsRes.json();
            const logsData = await logsRes.json();

            setStats(statsData);
            setLogs(logsData.logs || []);
            setTotal(logsData.total || 0);
        } catch (e) {
            console.error('Failed to fetch analytics', e);
        } finally {
            setLoading(false);
        }
    }, [filterCampaign, filterStatus]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchData]);

    const filteredLogs = searchPhone
        ? logs.filter(l => l.phone_number.includes(searchPhone))
        : logs;

    if (loading && !stats) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
        );
    }

    const campaigns = stats ? Object.entries(stats.by_campaign) : [];
    const pickupRate = stats && stats.total_calls > 0 ? (stats.connected + stats.completed) / stats.total_calls : 0;
    const completionRate = stats && stats.total_calls > 0 ? stats.completed / stats.total_calls : 0;
    const failRate = stats && stats.total_calls > 0 ? stats.failed / stats.total_calls : 0;

    return (
        <main className="min-h-screen bg-[#050505] text-white p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                            Call Analytics
                        </h1>
                        <p className="text-gray-500 mt-1">{total} total calls logged</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoRefresh ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}
                        >
                            <Activity className="w-3 h-3 inline mr-1" />
                            {autoRefresh ? 'Live' : 'Auto-refresh'}
                        </button>
                        <select
                            value={filterCampaign}
                            onChange={(e) => setFilterCampaign(e.target.value)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="">All Campaigns</option>
                            {campaigns.map(([id, data]) => (
                                <option key={id} value={id}>{data.campaign_name}</option>
                            ))}
                        </select>
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="">All Statuses</option>
                            <option value="dispatched">Dispatched</option>
                            <option value="connected">Connected</option>
                            <option value="completed">Completed</option>
                            <option value="failed">Failed</option>
                        </select>
                        <button onClick={fetchData} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Primary Stats */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
                        <StatCard label="Total" value={stats.total_calls} icon={<Phone className="w-4 h-4" />} color="text-white" />
                        <StatCard label="Dispatched" value={stats.dispatched} icon={<ArrowUpRight className="w-4 h-4" />} color="text-yellow-400" />
                        <StatCard label="Connected" value={stats.connected} icon={<Phone className="w-4 h-4" />} color="text-blue-400" />
                        <StatCard label="Completed" value={stats.completed} icon={<CheckCircle className="w-4 h-4" />} color="text-green-400" />
                        <StatCard label="Failed" value={stats.failed} icon={<XCircle className="w-4 h-4" />} color="text-red-400" />
                        <StatCard label="Pickup Rate" value={pct(stats.connected + stats.completed, stats.total_calls)} icon={<TrendingUp className="w-4 h-4" />} color="text-cyan-400" isText />
                        <StatCard label="Complete Rate" value={pct(stats.completed, stats.total_calls)} icon={<Percent className="w-4 h-4" />} color="text-emerald-400" isText />
                        <StatCard label="Avg Duration" value={formatDuration(stats.avg_duration_seconds)} icon={<Clock className="w-4 h-4" />} color="text-purple-400" isText />
                    </div>
                )}

                {/* Campaign Performance Table */}
                {campaigns.length > 1 && !filterCampaign && (
                    <div className="mb-6">
                        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Campaign Performance</h2>
                        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-gray-500 text-left">
                                        <th className="px-4 py-3 font-medium">Campaign</th>
                                        <th className="px-4 py-3 font-medium text-right">Total</th>
                                        <th className="px-4 py-3 font-medium text-right">Completed</th>
                                        <th className="px-4 py-3 font-medium text-right">Failed</th>
                                        <th className="px-4 py-3 font-medium text-right">Success Rate</th>
                                        <th className="px-4 py-3 font-medium text-right">Avg Duration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {campaigns.sort((a, b) => b[1].total - a[1].total).map(([id, data]) => (
                                        <tr key={id} className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setFilterCampaign(id)}>
                                            <td className="px-4 py-3 text-white font-medium">{data.campaign_name}</td>
                                            <td className="px-4 py-3 text-gray-300 text-right">{data.total}</td>
                                            <td className="px-4 py-3 text-green-400 text-right">{data.completed}</td>
                                            <td className="px-4 py-3 text-red-400 text-right">{data.failed}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={data.total > 0 && data.completed / data.total > 0.7 ? 'text-green-400' : 'text-yellow-400'}>
                                                    {pct(data.completed, data.total)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 text-right">{formatDuration(data.avg_duration)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Call History */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Call History</h2>
                        <input
                            type="text"
                            placeholder="Search phone number..."
                            value={searchPhone}
                            onChange={(e) => setSearchPhone(e.target.value)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-purple-500 w-56 placeholder-gray-600"
                        />
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-gray-500 text-left">
                                        <th className="px-4 py-3 font-medium">Phone</th>
                                        <th className="px-4 py-3 font-medium">Campaign</th>
                                        <th className="px-4 py-3 font-medium">Status</th>
                                        <th className="px-4 py-3 font-medium">Duration</th>
                                        <th className="px-4 py-3 font-medium">Outcome</th>
                                        <th className="px-4 py-3 font-medium">Sentiment</th>
                                        <th className="px-4 py-3 font-medium">Turns</th>
                                        <th className="px-4 py-3 font-medium">Avg Latency</th>
                                        <th className="px-4 py-3 font-medium">Time</th>
                                        <th className="px-4 py-3 font-medium">Error</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLogs.map((log) => (
                                        <tr
                                            key={log.id}
                                            className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                                            onClick={() => setSelectedCall(log)}
                                        >
                                            <td className="px-4 py-3 font-mono text-white">{maskPhone(log.phone_number)}</td>
                                            <td className="px-4 py-3 text-gray-400 truncate max-w-[150px]">{log.campaign_name}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 text-xs rounded-full border ${statusColors[log.status] || 'text-gray-400'}`}>
                                                    {log.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-300">{formatDuration(log.duration_seconds)}</td>
                                            <td className="px-4 py-3">
                                                {log.outcome ? (
                                                    <span className={`px-2 py-0.5 text-xs rounded-full border ${
                                                        log.outcome === 'payment_committed' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                                                        log.outcome === 'callback_scheduled' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                                                        log.outcome === 'transferred' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
                                                        log.outcome === 'refused' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                                                        'text-gray-400 bg-white/5 border-white/10'
                                                    }`}>
                                                        {log.outcome.replace(/_/g, ' ')}
                                                    </span>
                                                ) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                {log.sentiment ? (
                                                    <span className={`text-xs ${
                                                        log.sentiment === 'positive' ? 'text-green-400' :
                                                        log.sentiment === 'neutral' ? 'text-gray-400' :
                                                        log.sentiment === 'negative' ? 'text-orange-400' :
                                                        'text-red-400'
                                                    }`}>
                                                        {log.sentiment}
                                                    </span>
                                                ) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500">{log.turn_count ?? '-'}</td>
                                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{log.avg_turn_latency_ms ? `${log.avg_turn_latency_ms}ms` : '-'}</td>
                                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatTime(log.dispatched_at)}</td>
                                            <td className="px-4 py-3 max-w-[250px]">
                                                {log.error ? (
                                                    <ErrorCell error={log.error} />
                                                ) : <span className="text-gray-600">-</span>}
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-8 text-center text-gray-600">
                                                {searchPhone ? 'No calls match your search.' : 'No calls logged yet. Dispatch a call to see data here.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Pipeline Latency Breakdown */}
                <LatencyBreakdown logs={filteredLogs} />

                {/* Transcript Modal */}
                {selectedCall && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => setSelectedCall(null)}>
                        <div
                            className="bg-[#1a1a1a] border border-white/20 rounded-xl max-w-2xl max-h-[80vh] overflow-auto w-full"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="sticky top-0 bg-[#1a1a1a] border-b border-white/10 p-6 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-bold text-white">Call Transcript</h3>
                                    <p className="text-sm text-gray-400 mt-1">{maskPhone(selectedCall.phone_number)} • {selectedCall.campaign_name}</p>
                                </div>
                                <button
                                    onClick={() => setSelectedCall(null)}
                                    className="text-gray-400 hover:text-white text-2xl"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                {selectedCall.transcript ? (
                                    <div className="space-y-3">
                                        {selectedCall.transcript.split('\n').map((line, i) => {
                                            const isAgent = line.startsWith('Agent:');
                                            return (
                                                <div key={i} className={`text-sm ${isAgent ? 'text-blue-300' : 'text-green-300'}`}>
                                                    <span className="font-semibold">{isAgent ? '🤖' : '👤'}</span> {line}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-gray-400 text-center py-8">No transcript available for this call.</p>
                                )}
                                <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-white/10 text-sm">
                                    <div>
                                        <p className="text-gray-500">Duration</p>
                                        <p className="text-white font-semibold">{formatDuration(selectedCall.duration_seconds)}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">Turns</p>
                                        <p className="text-white font-semibold">{selectedCall.turn_count ?? '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">Avg Latency</p>
                                        <p className="text-white font-semibold">{selectedCall.avg_turn_latency_ms ? `${selectedCall.avg_turn_latency_ms}ms` : '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">Outcome</p>
                                        <p className="text-white font-semibold capitalize">{selectedCall.outcome?.replace(/_/g, ' ') ?? '-'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}

function ErrorCell({ error }: { error: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(error);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div className="flex items-center gap-1.5 group">
            <span className="text-red-400/70 text-xs truncate max-w-[180px]" title={error}>{error}</span>
            <button
                onClick={handleCopy}
                className="shrink-0 p-1 rounded hover:bg-white/10 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            >
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            </button>
        </div>
    );
}

function StatCard({ label, value, icon, color, isText }: { label: string; value: number | string; icon: React.ReactNode; color: string; isText?: boolean }) {
    return (
        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-1.5 mb-1">
                <span className={color}>{icon}</span>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span>
            </div>
            <span className={`text-xl font-bold ${color}`}>{isText ? value : value}</span>
        </div>
    );
}

// ── Latency segment colors ──────────────────────────────────────────────────
const SEG = {
    dial:    { label: 'Dial',      color: 'bg-amber-500',   text: 'text-amber-400'  },
    eou:     { label: 'EOU Wait',  color: 'bg-yellow-500',  text: 'text-yellow-400' },
    stt:     { label: 'STT',       color: 'bg-cyan-500',    text: 'text-cyan-400'   },
    llm:     { label: 'LLM TTFT',  color: 'bg-violet-500',  text: 'text-violet-400' },
    tts:     { label: 'TTS TTFB',  color: 'bg-blue-500',    text: 'text-blue-400'   },
} as const;

function LatencyBar({ lat }: { lat: LatencyData }) {
    const dial  = lat.dial_ms  || 0;
    const eou   = lat.avg_eou_delay_ms  || 0;
    const stt   = lat.avg_stt_ms        || 0;
    const llm   = lat.avg_llm_ttft_ms   || 0;
    const tts   = lat.avg_tts_ttfb_ms   || 0;
    const total = dial + eou + stt + llm + tts;
    if (total === 0) return <span className="text-gray-600 text-xs">no data</span>;
    const segs = [
        { key: 'dial', val: dial },
        { key: 'eou',  val: eou  },
        { key: 'stt',  val: stt  },
        { key: 'llm',  val: llm  },
        { key: 'tts',  val: tts  },
    ].filter(s => s.val > 0) as { key: keyof typeof SEG; val: number }[];

    return (
        <div className="flex items-center gap-2 w-full min-w-[160px]">
            <div className="flex h-2 rounded-full overflow-hidden flex-1">
                {segs.map(s => (
                    <div
                        key={s.key}
                        className={SEG[s.key].color}
                        style={{ width: `${(s.val / total) * 100}%` }}
                        title={`${SEG[s.key].label}: ${s.val}ms`}
                    />
                ))}
            </div>
            <span className="text-xs text-gray-400 shrink-0">{total}ms</span>
        </div>
    );
}

function LatencyBreakdown({ logs }: { logs: CallLog[] }) {
    const withLatency = logs.filter(l => l.latency && (
        l.latency.dial_ms || l.latency.avg_llm_ttft_ms || l.latency.avg_tts_ttfb_ms
    ));
    if (withLatency.length === 0) return null;

    // Campaign-level aggregates
    const bycamp: Record<string, { name: string; dial: number[]; eou: number[]; stt: number[]; llm: number[]; tts: number[]; }> = {};
    for (const log of withLatency) {
        const lat = log.latency!;
        const k = log.campaign_id || 'custom';
        if (!bycamp[k]) bycamp[k] = { name: log.campaign_name || 'Custom', dial: [], eou: [], stt: [], llm: [], tts: [] };
        if (lat.dial_ms) bycamp[k].dial.push(lat.dial_ms);
        if (lat.avg_eou_delay_ms) bycamp[k].eou.push(lat.avg_eou_delay_ms);
        if (lat.avg_stt_ms) bycamp[k].stt.push(lat.avg_stt_ms);
        if (lat.avg_llm_ttft_ms) bycamp[k].llm.push(lat.avg_llm_ttft_ms);
        if (lat.avg_tts_ttfb_ms) bycamp[k].tts.push(lat.avg_tts_ttfb_ms);
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    return (
        <div className="mt-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Pipeline Latency Breakdown</h2>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mb-4">
                {(Object.keys(SEG) as (keyof typeof SEG)[]).map(k => (
                    <div key={k} className="flex items-center gap-1.5">
                        <div className={`w-3 h-3 rounded-sm ${SEG[k].color}`} />
                        <span className={`text-xs ${SEG[k].text}`}>{SEG[k].label}</span>
                    </div>
                ))}
            </div>

            {/* Campaign averages */}
            {Object.keys(bycamp).length > 1 && (
                <div className="mb-4 bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/10 text-gray-500 text-left">
                                <th className="px-4 py-2 font-medium">Campaign</th>
                                <th className="px-4 py-2 font-medium text-right">Avg Dial</th>
                                <th className="px-4 py-2 font-medium text-right">Avg EOU</th>
                                <th className="px-4 py-2 font-medium text-right">Avg STT</th>
                                <th className="px-4 py-2 font-medium text-right">Avg LLM TTFT</th>
                                <th className="px-4 py-2 font-medium text-right">Avg TTS TTFB</th>
                                <th className="px-4 py-2 font-medium">Pipeline</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(bycamp).map(([id, d]) => {
                                const lat: LatencyData = {
                                    dial_ms: avg(d.dial),
                                    avg_eou_delay_ms: avg(d.eou),
                                    avg_stt_ms: avg(d.stt),
                                    avg_llm_ttft_ms: avg(d.llm),
                                    avg_tts_ttfb_ms: avg(d.tts),
                                };
                                return (
                                    <tr key={id} className="border-b border-white/5">
                                        <td className="px-4 py-2 text-white">{d.name}</td>
                                        <td className="px-4 py-2 text-amber-400 text-right">{avg(d.dial) || '-'}{avg(d.dial) ? 'ms' : ''}</td>
                                        <td className="px-4 py-2 text-yellow-400 text-right">{avg(d.eou) || '-'}{avg(d.eou) ? 'ms' : ''}</td>
                                        <td className="px-4 py-2 text-cyan-400 text-right">{avg(d.stt) || '-'}{avg(d.stt) ? 'ms' : ''}</td>
                                        <td className="px-4 py-2 text-violet-400 text-right">{avg(d.llm) || '-'}{avg(d.llm) ? 'ms' : ''}</td>
                                        <td className="px-4 py-2 text-blue-400 text-right">{avg(d.tts) || '-'}{avg(d.tts) ? 'ms' : ''}</td>
                                        <td className="px-4 py-2 w-48"><LatencyBar lat={lat} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Per-call breakdown */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/10 text-gray-500 text-left">
                                <th className="px-4 py-2 font-medium">Phone</th>
                                <th className="px-4 py-2 font-medium">Campaign</th>
                                <th className="px-4 py-2 font-medium text-right">Dial</th>
                                <th className="px-4 py-2 font-medium text-right">TTFR</th>
                                <th className="px-4 py-2 font-medium text-right">EOU</th>
                                <th className="px-4 py-2 font-medium text-right">STT</th>
                                <th className="px-4 py-2 font-medium text-right">LLM TTFT</th>
                                <th className="px-4 py-2 font-medium text-right">TTS TTFB</th>
                                <th className="px-4 py-2 font-medium">Pipeline</th>
                                <th className="px-4 py-2 font-medium">Turns</th>
                            </tr>
                        </thead>
                        <tbody>
                            {withLatency.slice(0, 50).map(log => {
                                const lat = log.latency!;
                                return (
                                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-2 font-mono text-white">{maskPhone(log.phone_number)}</td>
                                        <td className="px-4 py-2 text-gray-400 truncate max-w-[140px]">{log.campaign_name}</td>
                                        <td className="px-4 py-2 text-amber-400 text-right">{lat.dial_ms ? `${lat.dial_ms}ms` : '-'}</td>
                                        <td className="px-4 py-2 text-gray-300 text-right">{lat.ttfr_ms ? `${lat.ttfr_ms}ms` : '-'}</td>
                                        <td className="px-4 py-2 text-yellow-400 text-right">{lat.avg_eou_delay_ms ? `${lat.avg_eou_delay_ms}ms` : '-'}</td>
                                        <td className="px-4 py-2 text-cyan-400 text-right">{lat.avg_stt_ms ? `${lat.avg_stt_ms}ms` : '-'}</td>
                                        <td className="px-4 py-2 text-violet-400 text-right">
                                            {lat.avg_llm_ttft_ms ? (
                                                <span title={`min ${lat.min_llm_ttft_ms}ms / max ${lat.max_llm_ttft_ms}ms`}>
                                                    {lat.avg_llm_ttft_ms}ms
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-4 py-2 text-blue-400 text-right">
                                            {lat.avg_tts_ttfb_ms ? (
                                                <span title={`min ${lat.min_tts_ttfb_ms}ms / max ${lat.max_tts_ttfb_ms}ms`}>
                                                    {lat.avg_tts_ttfb_ms}ms
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-4 py-2 w-52"><LatencyBar lat={lat} /></td>
                                        <td className="px-4 py-2 text-gray-500 text-center">{lat.turns?.length ?? '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
