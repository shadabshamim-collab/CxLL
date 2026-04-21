import { NextResponse } from 'next/server';
import { getAllCallLogs, getCallStats } from '@/lib/call-logger';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const view = searchParams.get('view');

        if (view === 'stats') {
            const campaign_id = searchParams.get('campaign_id') || undefined;
            const stats = await getCallStats(campaign_id);
            return NextResponse.json(stats);
        }

        // Queue stats
        if (view === 'queue') {
            try {
                const { getQueueStats } = await import('@/lib/call-queue');
                const counts = await getQueueStats();
                return NextResponse.json(counts);
            } catch {
                return NextResponse.json({ error: 'Queue not available' }, { status: 503 });
            }
        }

        // Real-time active call stats
        if (view === 'realtime') {
            try {
                const { getRealtimeStats } = await import('@/lib/call-state');
                const stats = await getRealtimeStats();
                return NextResponse.json(stats);
            } catch {
                return NextResponse.json({ error: 'Redis not available' }, { status: 503 });
            }
        }

        const filters = {
            campaign_id: searchParams.get('campaign_id') || undefined,
            status: searchParams.get('status') || undefined,
            limit: parseInt(searchParams.get('limit') || '50'),
            offset: parseInt(searchParams.get('offset') || '0'),
        };

        const result = await getAllCallLogs(filters);
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
