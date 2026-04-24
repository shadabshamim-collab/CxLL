import { NextResponse } from 'next/server';
import { roomService } from '@/lib/server-utils';

const AGENT_HTTP_URL = process.env.AGENT_HTTP_URL || 'http://localhost:8081';

export async function GET() {
    const checks: Record<string, { ok: boolean; detail?: string; latency_ms?: number }> = {};

    // 1. Agent process alive (LiveKit agent SDK exposes HTTP on :8081)
    const agentStart = Date.now();
    try {
        const res = await fetch(AGENT_HTTP_URL, { signal: AbortSignal.timeout(3000) });
        checks.agent_process = {
            ok: res.ok,
            detail: res.ok ? 'running' : `status ${res.status}`,
            latency_ms: Date.now() - agentStart,
        };
    } catch (e: any) {
        checks.agent_process = {
            ok: false,
            detail: e.code === 'ECONNREFUSED' ? 'not running' : (e.message || 'unreachable'),
            latency_ms: Date.now() - agentStart,
        };
    }

    // 2. LiveKit Cloud reachable (listRooms is lightweight)
    const lkStart = Date.now();
    try {
        await roomService.listRooms();
        checks.livekit_cloud = {
            ok: true,
            detail: 'connected',
            latency_ms: Date.now() - lkStart,
        };
    } catch (e: any) {
        checks.livekit_cloud = {
            ok: false,
            detail: e.message || 'unreachable',
            latency_ms: Date.now() - lkStart,
        };
    }

    // 3. SIP trunk configured
    checks.sip_trunk = {
        ok: !!process.env.VOBIZ_SIP_TRUNK_ID,
        detail: process.env.VOBIZ_SIP_TRUNK_ID ? 'configured' : 'missing VOBIZ_SIP_TRUNK_ID',
    };

    const allOk = Object.values(checks).every(c => c.ok);

    return NextResponse.json({
        status: allOk ? 'ready' : 'degraded',
        ready: allOk,
        checks,
        timestamp: new Date().toISOString(),
    });
}
