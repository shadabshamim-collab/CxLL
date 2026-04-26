import fs from 'fs';
import path from 'path';
import { isAirtableConfigured, CallLogsTable } from './airtable';
import { getRedis } from './redis';
import { getRealtimeStats } from './call-state';

export interface LatencyData {
    dial_ms?: number;
    ttfr_ms?: number;
    avg_stt_ms?: number;
    avg_eou_delay_ms?: number;
    avg_llm_ttft_ms?: number;
    avg_tts_ttfb_ms?: number;
    avg_e2e_latency_ms?: number;
    min_stt_ms?: number; max_stt_ms?: number;
    min_eou_delay_ms?: number; max_eou_delay_ms?: number;
    min_llm_ttft_ms?: number; max_llm_ttft_ms?: number;
    min_tts_ttfb_ms?: number; max_tts_ttfb_ms?: number;
    min_e2e_latency_ms?: number; max_e2e_latency_ms?: number;
    turns?: Array<Record<string, number | string>>;
}

export interface CallLog {
    id: string;
    campaign_id: string;
    campaign_name: string;
    phone_number: string;
    room_name: string;
    status: 'dispatched' | 'dialing' | 'ringing' | 'connected' | 'completed' | 'failed' | 'dialer_reject';
    dispatched_at: string;
    connected_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    outcome: string | null;
    disposition: string | null;
    sentiment: string | null;
    transcript_preview: string | null;
    transcript: string | null;
    turn_count: number | null;
    model_provider: string;
    voice_id: string;
    error: string | null;
    latency: LatencyData | null;
}

// ── File-based fallback ──────────────────────────────────────────────
const LOGS_FILE = path.join(process.cwd(), 'data', 'call-logs.json');

function ensureFile() {
    const dir = path.dirname(LOGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(LOGS_FILE)) fs.writeFileSync(LOGS_FILE, '[]', 'utf-8');
}

function readFileLogs(): CallLog[] {
    ensureFile();
    try { return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8')); }
    catch { return []; }
}

function writeFileLogs(logs: CallLog[]) {
    ensureFile();
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

// Calls stuck in "dispatched"/"connected" past this window are treated as
// failed (the agent likely crashed before reporting completion).
const STALE_CALL_TIMEOUT_MS = 10 * 60 * 1000;

function reapStaleCalls(logs: CallLog[]): CallLog[] {
    const now = Date.now();
    let mutated = false;
    for (const log of logs) {
        if (log.status !== 'dispatched' && log.status !== 'connected') continue;
        const ts = new Date(log.dispatched_at).getTime();
        if (Number.isNaN(ts) || now - ts < STALE_CALL_TIMEOUT_MS) continue;
        log.status = 'failed';
        log.completed_at = log.completed_at || new Date(ts + STALE_CALL_TIMEOUT_MS).toISOString();
        log.error = log.error || 'Stale: agent never reported completion (timed out)';
        mutated = true;
    }
    if (mutated) writeFileLogs(logs);
    return logs;
}

// ── Airtable mapping ────────────────────────────────────────────────
function fieldsToCallLog(fields: Record<string, any>): CallLog {
    return {
        id: fields.call_id || '',
        campaign_id: fields.campaign_id || '',
        campaign_name: fields.campaign_name || '',
        phone_number: fields.phone_number || '',
        room_name: fields.room_name || '',
        status: fields.status || 'dispatched',
        dispatched_at: fields.dispatched_at || '',
        connected_at: fields.connected_at || null,
        completed_at: fields.completed_at || null,
        duration_seconds: fields.duration_seconds ?? null,
        outcome: fields.outcome || null,
        disposition: fields.disposition || null,
        sentiment: fields.sentiment || null,
        transcript_preview: fields.transcript_preview || null,
        transcript: fields.transcript || null,
        turn_count: fields.turn_count ?? null,
        model_provider: fields.model_provider || '',
        voice_id: fields.voice_id || '',
        error: fields.error || null,
        latency: fields.latency || null,
    };
}

const AT_ID_KEY = 'call:at_id:';

// ── Public API ───────────────────────────────────────────────────────

export async function logCallDispatched(params: {
    campaign_id: string;
    campaign_name: string;
    phone_number: string;
    room_name: string;
    model_provider: string;
    voice_id: string;
}): Promise<void> {
    const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    if (isAirtableConfigured()) {
        try {
            const record = await CallLogsTable.create({
                call_id: callId,
                campaign_id: params.campaign_id,
                campaign_name: params.campaign_name,
                phone_number: params.phone_number,
                room_name: params.room_name,
                status: 'dispatched',
                dispatched_at: now,
                model_provider: params.model_provider,
                voice_id: params.voice_id,
                retry_count: 0,
            } as any);
            try {
                const redis = getRedis();
                await redis.setex(`${AT_ID_KEY}${params.room_name}`, 86400, record.id);
            } catch { /* Redis cache miss is non-fatal */ }
            return;
        } catch (err) {
            console.error('[CallLogger] Airtable write failed, file fallback:', err);
        }
    }

    const logs = readFileLogs();
    logs.push({
        id: callId,
        campaign_id: params.campaign_id,
        campaign_name: params.campaign_name,
        phone_number: params.phone_number,
        room_name: params.room_name,
        status: 'dispatched',
        dispatched_at: now,
        connected_at: null, completed_at: null, duration_seconds: null,
        outcome: null, disposition: null, sentiment: null,
        transcript_preview: null, transcript: null, turn_count: null,
        model_provider: params.model_provider,
        voice_id: params.voice_id, error: null, latency: null,
    });
    writeFileLogs(logs);
}

export async function updateCallByRoom(
    room_name: string,
    update: Partial<Pick<CallLog, 'status' | 'connected_at' | 'completed_at' | 'duration_seconds' | 'outcome' | 'disposition' | 'sentiment' | 'transcript_preview' | 'transcript' | 'turn_count' | 'error' | 'latency'>>
): Promise<CallLog | null> {
    if (isAirtableConfigured()) {
        try {
            let recordId: string | null = null;
            try {
                const redis = getRedis();
                recordId = await redis.get(`${AT_ID_KEY}${room_name}`);
            } catch { /* Redis miss */ }

            if (!recordId) {
                const record = await CallLogsTable.findFirst(`{room_name} = '${room_name}'`);
                if (record) recordId = record.id;
            }

            if (recordId) {
                const updated = await CallLogsTable.update(recordId, update as any);
                return fieldsToCallLog(updated.fields);
            }
        } catch (err) {
            console.error('[CallLogger] Airtable update failed, file fallback:', err);
        }
    }

    const logs = readFileLogs();
    const idx = logs.findIndex(l => l.room_name === room_name);
    if (idx === -1) return null;
    const cleanUpdate = Object.fromEntries(
        Object.entries(update).filter(([, v]) => v !== undefined && v !== null)
    );
    Object.assign(logs[idx], cleanUpdate);
    writeFileLogs(logs);
    return logs[idx];
}

export async function getAllCallLogs(filters?: {
    campaign_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<{ logs: CallLog[]; total: number }> {
    if (isAirtableConfigured()) {
        try {
            const formulas: string[] = [];
            if (filters?.campaign_id) formulas.push(`{campaign_id} = '${filters.campaign_id}'`);
            if (filters?.status) formulas.push(`{status} = '${filters.status}'`);
            const filterByFormula = formulas.length > 1
                ? `AND(${formulas.join(', ')})` : formulas[0] || '';

            const records = await CallLogsTable.list({
                filterByFormula,
                sort: [{ field: 'dispatched_at', direction: 'desc' }],
            });
            const total = records.length;
            const offset = filters?.offset || 0;
            const limit = filters?.limit || 50;
            return {
                logs: records.slice(offset, offset + limit).map(r => fieldsToCallLog(r.fields)),
                total,
            };
        } catch (err) {
            console.error('[CallLogger] Airtable read failed, file fallback:', err);
        }
    }

    let logs = reapStaleCalls(readFileLogs());
    if (filters?.campaign_id) logs = logs.filter(l => l.campaign_id === filters.campaign_id);
    if (filters?.status) logs = logs.filter(l => l.status === filters.status);
    logs.sort((a, b) => new Date(b.dispatched_at).getTime() - new Date(a.dispatched_at).getTime());
    const total = logs.length;
    return { logs: logs.slice(filters?.offset || 0, (filters?.offset || 0) + (filters?.limit || 50)), total };
}

export async function getCallStats(campaign_id?: string): Promise<{
    total_calls: number;
    dispatched: number;
    connected: number;
    completed: number;
    failed: number;
    avg_duration_seconds: number | null;
    by_campaign: Record<string, { campaign_name: string; total: number; completed: number; failed: number; avg_duration: number | null }>;
}> {
    // Redis real-time stats (fast path)
    try {
        const stats = await getRealtimeStats();
        if (stats.total_calls > 0) {
            return {
                total_calls: stats.total_calls,
                dispatched: (stats.by_status.queued || 0) + (stats.by_status.dialing || 0) + (stats.by_status.ringing || 0),
                connected: stats.by_status.connected || 0,
                completed: stats.by_status.completed || 0,
                failed: stats.by_status.failed || 0,
                avg_duration_seconds: stats.avg_duration_seconds,
                by_campaign: {},
            };
        }
    } catch { /* Redis unavailable */ }

    // File fallback
    let logs = reapStaleCalls(readFileLogs());
    if (campaign_id) logs = logs.filter(l => l.campaign_id === campaign_id);

    const completed = logs.filter(l => l.status === 'completed');
    const durations = completed.map(l => l.duration_seconds).filter((d): d is number => d !== null && d > 0);

    const byCampaign: Record<string, { campaign_name: string; total: number; completed: number; failed: number; avg_duration: number | null }> = {};
    for (const log of logs) {
        const key = log.campaign_id || 'custom';
        if (!byCampaign[key]) {
            byCampaign[key] = { campaign_name: log.campaign_name || 'Custom', total: 0, completed: 0, failed: 0, avg_duration: null };
        }
        byCampaign[key].total++;
        if (log.status === 'completed') byCampaign[key].completed++;
        if (log.status === 'failed') byCampaign[key].failed++;
    }
    for (const key of Object.keys(byCampaign)) {
        const ds = logs.filter(l => (l.campaign_id || 'custom') === key && l.status === 'completed' && l.duration_seconds).map(l => l.duration_seconds!);
        if (ds.length > 0) byCampaign[key].avg_duration = Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
    }

    return {
        total_calls: logs.length,
        dispatched: logs.filter(l => l.status === 'dispatched').length,
        connected: logs.filter(l => l.status === 'connected').length,
        completed: completed.length,
        failed: logs.filter(l => l.status === 'failed').length,
        avg_duration_seconds: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        by_campaign: byCampaign,
    };
}
