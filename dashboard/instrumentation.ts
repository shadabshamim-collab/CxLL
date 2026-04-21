export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.REDIS_URL) {
        try {
            const { startCallWorker } = await import('./lib/call-queue');
            startCallWorker();
            console.log('[Init] BullMQ call dispatch worker started');
        } catch {
            console.warn('[Init] BullMQ worker skipped (Redis unavailable). Using direct dispatch.');
        }
    }
}
