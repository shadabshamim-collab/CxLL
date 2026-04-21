import { Queue, Worker, Job } from 'bullmq';
import { createRedisConnection } from './redis';
import { agentDispatch } from './server-utils';
import { createCallState, transitionCallState, CallStatus, hasActiveCall } from './call-state';
import { isAirtableConfigured, CallLogsTable } from './airtable';

const QUEUE_NAME = 'call-dispatch';

// DND: 9 PM to 9 AM IST
const DND_START_HOUR = 21;
const DND_END_HOUR = 9;

export interface CallJobData {
    call_id: string;
    phone_number: string;
    room_name: string;
    campaign_id: string;
    campaign_name: string;
    metadata: Record<string, string>;
    model_provider: string;
    voice_id: string;
    retry_count?: number;
    scheduled_at?: string;
}

function getISTHour(): number {
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    return new Date(istMs).getUTCHours();
}

function isInDndWindow(): boolean {
    const hour = getISTHour();
    return hour >= DND_START_HOUR || hour < DND_END_HOUR;
}

function msUntilDndEnds(): number {
    const hour = getISTHour();
    let hoursUntilEnd: number;
    if (hour >= DND_START_HOUR) {
        hoursUntilEnd = (24 - hour) + DND_END_HOUR;
    } else {
        hoursUntilEnd = DND_END_HOUR - hour;
    }
    return hoursUntilEnd * 60 * 60 * 1000;
}

let queue: Queue | null = null;
let worker: Worker | null = null;

export function getCallQueue(): Queue {
    if (!queue) {
        queue = new Queue(QUEUE_NAME, {
            connection: createRedisConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { count: 1000 },
                removeOnFail: { count: 5000 },
            },
        });
    }
    return queue;
}

export async function enqueueCall(data: CallJobData): Promise<string> {
    const q = getCallQueue();

    let delay = 0;

    // DND enforcement
    if (isInDndWindow() && !data.scheduled_at) {
        delay = msUntilDndEnds();
        console.log(`[Queue] DND active — delaying ${data.phone_number} by ${Math.round(delay / 60000)}m`);
    }

    // Scheduled for future
    if (data.scheduled_at) {
        const scheduledMs = new Date(data.scheduled_at).getTime() - Date.now();
        if (scheduledMs > 0) delay = scheduledMs;
    }

    // Create state tracking in Redis
    await createCallState({
        call_id: data.call_id,
        room_name: data.room_name,
        phone_number: data.phone_number,
        campaign_id: data.campaign_id,
        campaign_name: data.campaign_name,
        metadata: data.metadata,
        scheduled_at: data.scheduled_at,
    });

    const job = await q.add('dispatch-call', data, {
        delay,
        jobId: data.call_id,
    });

    return job.id!;
}

export async function enqueueBulk(calls: CallJobData[], ratePerSecond = 10): Promise<string[]> {
    const q = getCallQueue();
    const jobIds: string[] = [];

    for (let i = 0; i < calls.length; i++) {
        const staggerDelay = Math.floor(i / ratePerSecond) * 1000;

        await createCallState({
            call_id: calls[i].call_id,
            room_name: calls[i].room_name,
            phone_number: calls[i].phone_number,
            campaign_id: calls[i].campaign_id,
            campaign_name: calls[i].campaign_name,
            metadata: calls[i].metadata,
        });

        const job = await q.add('dispatch-call', calls[i], {
            delay: staggerDelay,
            jobId: calls[i].call_id,
        });
        jobIds.push(job.id!);
    }

    return jobIds;
}

export function startCallWorker(): Worker {
    if (worker) return worker;

    worker = new Worker(
        QUEUE_NAME,
        async (job: Job<CallJobData>) => {
            const { data } = job;
            console.log(`[Worker] Processing ${data.call_id} → ${data.phone_number}`);

            // Dedup: skip if phone already has active call
            if (await hasActiveCall(data.phone_number)) {
                console.log(`[Worker] Skipped ${data.phone_number} — active call exists`);
                return { skipped: true, reason: 'active_call_exists' };
            }

            // Transition: QUEUED → DIALING
            await transitionCallState(data.room_name, CallStatus.DIALING);

            try {
                const dispatch = await agentDispatch.createDispatch(
                    data.room_name,
                    'outbound-caller',
                    { metadata: JSON.stringify(data.metadata) }
                );

                // Persist to Airtable (non-blocking)
                if (isAirtableConfigured()) {
                    CallLogsTable.create({
                        call_id: data.call_id,
                        campaign_id: data.campaign_id,
                        campaign_name: data.campaign_name,
                        phone_number: data.phone_number,
                        room_name: data.room_name,
                        status: 'dialing',
                        dispatched_at: new Date().toISOString(),
                        model_provider: data.model_provider,
                        voice_id: data.voice_id,
                        retry_count: data.retry_count || 0,
                    } as any).catch(err => console.error('[Worker] Airtable log failed:', err.message));
                }

                console.log(`[Worker] Dispatched ${data.call_id} → room ${data.room_name}`);
                return { dispatch_id: dispatch.id, room_name: data.room_name };

            } catch (error: any) {
                await transitionCallState(data.room_name, CallStatus.FAILED, { error: error.message });
                console.error(`[Worker] Failed ${data.phone_number}:`, error.message);
                throw error; // BullMQ handles retry
            }
        },
        {
            connection: createRedisConnection(),
            concurrency: 50,
            limiter: {
                max: 100,
                duration: 1000,
            },
        }
    );

    worker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} done`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
    });

    console.log('[Worker] Call dispatch worker started (concurrency=50, rate=100/s)');
    return worker;
}

export function getQueueStats() {
    const q = getCallQueue();
    return q.getJobCounts('active', 'completed', 'delayed', 'failed', 'waiting');
}
