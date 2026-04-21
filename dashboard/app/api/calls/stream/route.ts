import { getCallStats, getAllCallLogs } from '@/lib/call-logger';

export const dynamic = 'force-dynamic';

export async function GET() {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let alive = true;

            const push = async () => {
                if (!alive) return;
                try {
                    const [stats, recent] = await Promise.all([
                        getCallStats(),
                        getAllCallLogs({ limit: 10 }),
                    ]);
                    const payload = JSON.stringify({ stats, recent: recent.logs, ts: Date.now() });
                    controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                } catch {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: true, ts: Date.now() })}\n\n`));
                }
            };

            await push();
            const interval = setInterval(push, 3000);

            // Keep-alive ping every 15s to prevent proxy timeouts
            const keepAlive = setInterval(() => {
                if (!alive) return;
                controller.enqueue(encoder.encode(`: keepalive\n\n`));
            }, 15000);

            // Cleanup when client disconnects
            void (async () => {
                try {
                    // Wait for the stream to be cancelled (client disconnect)
                    await new Promise<void>((resolve) => {
                        const check = setInterval(() => {
                            if (!alive) {
                                clearInterval(check);
                                resolve();
                            }
                        }, 1000);
                    });
                } catch {}
            })();

            // The cancel callback sets alive=false and cleans up
            return () => {
                alive = false;
                clearInterval(interval);
                clearInterval(keepAlive);
            };
        },
        cancel() {
            // Stream cancelled by client
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
