import { NextResponse } from 'next/server';
import { isRedisHealthy } from '@/lib/redis';
import { isAirtableConfigured } from '@/lib/airtable';

export async function GET() {
    const checks: Record<string, { status: string; latency_ms?: number }> = {};

    // Redis health
    const redisStart = Date.now();
    const redisOk = await isRedisHealthy();
    checks.redis = {
        status: redisOk ? 'healthy' : 'unhealthy',
        latency_ms: Date.now() - redisStart,
    };

    // Airtable config
    checks.airtable = {
        status: isAirtableConfigured() ? 'configured' : 'not_configured',
    };

    // LiveKit config
    checks.livekit = {
        status: process.env.LIVEKIT_URL ? 'configured' : 'missing',
    };

    // SIP trunk
    checks.sip_trunk = {
        status: process.env.VOBIZ_SIP_TRUNK_ID ? 'configured' : 'missing',
    };

    const overall = redisOk ? 'healthy' : 'degraded';

    return NextResponse.json(
        { status: overall, checks, timestamp: new Date().toISOString() },
        { status: overall === 'healthy' ? 200 : 503 }
    );
}
