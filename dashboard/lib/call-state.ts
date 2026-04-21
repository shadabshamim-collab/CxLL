import { getRedis } from './redis';

export enum CallStatus {
    QUEUED = 'queued',
    SCHEDULED = 'scheduled',
    DIALING = 'dialing',
    RINGING = 'ringing',
    CONNECTED = 'connected',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

const VALID_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
    [CallStatus.QUEUED]: [CallStatus.DIALING, CallStatus.SCHEDULED, CallStatus.FAILED],
    [CallStatus.SCHEDULED]: [CallStatus.QUEUED, CallStatus.FAILED],
    [CallStatus.DIALING]: [CallStatus.RINGING, CallStatus.CONNECTED, CallStatus.FAILED],
    [CallStatus.RINGING]: [CallStatus.CONNECTED, CallStatus.FAILED],
    [CallStatus.CONNECTED]: [CallStatus.COMPLETED, CallStatus.FAILED],
    [CallStatus.COMPLETED]: [],
    [CallStatus.FAILED]: [CallStatus.QUEUED],
};

export interface CallState {
    call_id: string;
    room_name: string;
    phone_number: string;
    campaign_id: string;
    campaign_name: string;
    status: CallStatus;
    retry_count: number;
    max_retries: number;
    created_at: string;
    updated_at: string;
    scheduled_at?: string;
    duration_seconds?: number;
    error?: string;
    metadata?: Record<string, string>;
}

const KEY_PREFIX = 'call:';
const TTL = 86400; // 24h

function stateKey(room_name: string) {
    return `${KEY_PREFIX}${room_name}`;
}

export async function createCallState(params: {
    call_id: string;
    room_name: string;
    phone_number: string;
    campaign_id: string;
    campaign_name: string;
    metadata?: Record<string, string>;
    scheduled_at?: string;
    max_retries?: number;
}): Promise<CallState> {
    const redis = getRedis();
    const now = new Date().toISOString();
    const status = params.scheduled_at ? CallStatus.SCHEDULED : CallStatus.QUEUED;

    const state: CallState = {
        call_id: params.call_id,
        room_name: params.room_name,
        phone_number: params.phone_number,
        campaign_id: params.campaign_id,
        campaign_name: params.campaign_name,
        status,
        retry_count: 0,
        max_retries: params.max_retries ?? 3,
        created_at: now,
        updated_at: now,
        scheduled_at: params.scheduled_at,
        metadata: params.metadata,
    };

    const pipeline = redis.pipeline();
    pipeline.setex(stateKey(params.room_name), TTL, JSON.stringify(state));
    pipeline.sadd(`calls:active:${params.phone_number}`, params.room_name);
    pipeline.incr('stats:total_calls');
    pipeline.incr(`stats:status:${status}`);
    pipeline.incr(`stats:campaign:${params.campaign_id}:total`);
    pipeline.set(`stats:campaign:${params.campaign_id}:name`, params.campaign_name);
    await pipeline.exec();

    return state;
}

export async function transitionCallState(
    room_name: string,
    newStatus: CallStatus,
    extra?: { retry_count?: number; duration_seconds?: number; error?: string }
): Promise<CallState | null> {
    const redis = getRedis();
    const raw = await redis.get(stateKey(room_name));
    if (!raw) return null;

    const state: CallState = JSON.parse(raw);
    const oldStatus = state.status;

    if (!VALID_TRANSITIONS[oldStatus]?.includes(newStatus)) {
        console.warn(`[StateMachine] Invalid: ${oldStatus} -> ${newStatus} for ${room_name}`);
        return null;
    }

    state.status = newStatus;
    state.updated_at = new Date().toISOString();
    if (extra?.retry_count !== undefined) state.retry_count = extra.retry_count;
    if (extra?.duration_seconds !== undefined) state.duration_seconds = extra.duration_seconds;
    if (extra?.error !== undefined) state.error = extra.error;

    const pipeline = redis.pipeline();
    pipeline.setex(stateKey(room_name), TTL, JSON.stringify(state));

    // Update status counters
    pipeline.decr(`stats:status:${oldStatus}`);
    pipeline.incr(`stats:status:${newStatus}`);

    // Per-campaign counters for terminal states
    if (newStatus === CallStatus.COMPLETED) {
        pipeline.incr(`stats:campaign:${state.campaign_id}:completed`);
        if (state.duration_seconds) {
            pipeline.rpush(`stats:campaign:${state.campaign_id}:durations`, String(state.duration_seconds));
            pipeline.rpush('stats:all_durations', String(state.duration_seconds));
        }
    }
    if (newStatus === CallStatus.FAILED) {
        pipeline.incr(`stats:campaign:${state.campaign_id}:failed`);
    }

    // Clean up active index on terminal states
    if (newStatus === CallStatus.COMPLETED || newStatus === CallStatus.FAILED) {
        pipeline.srem(`calls:active:${state.phone_number}`, room_name);
    }

    await pipeline.exec();

    // Publish for real-time WebSocket updates
    await redis.publish('call:state-change', JSON.stringify({
        room_name,
        call_id: state.call_id,
        phone_number: state.phone_number,
        campaign_id: state.campaign_id,
        campaign_name: state.campaign_name,
        old_status: oldStatus,
        new_status: newStatus,
        updated_at: state.updated_at,
        duration_seconds: state.duration_seconds,
    }));

    return state;
}

export async function getCallState(room_name: string): Promise<CallState | null> {
    const redis = getRedis();
    const raw = await redis.get(stateKey(room_name));
    return raw ? JSON.parse(raw) : null;
}

export async function hasActiveCall(phone_number: string): Promise<boolean> {
    const redis = getRedis();
    const count = await redis.scard(`calls:active:${phone_number}`);
    return count > 0;
}

export async function getActiveCallCount(): Promise<number> {
    const redis = getRedis();
    const statuses = [CallStatus.QUEUED, CallStatus.SCHEDULED, CallStatus.DIALING, CallStatus.RINGING, CallStatus.CONNECTED];
    let total = 0;
    for (const s of statuses) {
        const count = await redis.get(`stats:status:${s}`);
        total += parseInt(count || '0', 10);
    }
    return total;
}

export async function getRealtimeStats(): Promise<{
    total_calls: number;
    active_calls: number;
    by_status: Record<string, number>;
    avg_duration_seconds: number | null;
}> {
    const redis = getRedis();

    const pipeline = redis.pipeline();
    pipeline.get('stats:total_calls');
    for (const s of Object.values(CallStatus)) {
        pipeline.get(`stats:status:${s}`);
    }
    pipeline.lrange('stats:all_durations', 0, -1);
    const results = await pipeline.exec();
    if (!results) return { total_calls: 0, active_calls: 0, by_status: {}, avg_duration_seconds: null };

    const total_calls = parseInt((results[0]?.[1] as string) || '0', 10);
    const statuses = Object.values(CallStatus);
    const by_status: Record<string, number> = {};
    let active = 0;

    for (let i = 0; i < statuses.length; i++) {
        const count = parseInt((results[i + 1]?.[1] as string) || '0', 10);
        by_status[statuses[i]] = count;
        if (![CallStatus.COMPLETED, CallStatus.FAILED].includes(statuses[i])) {
            active += count;
        }
    }

    const durations = (results[statuses.length + 1]?.[1] as string[] || []).map(Number).filter(d => d > 0);
    const avg_duration_seconds = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    return { total_calls, active_calls: active, by_status, avg_duration_seconds };
}
