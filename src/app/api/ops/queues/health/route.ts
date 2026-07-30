import { NextResponse } from 'next/server';
import { getQueueManager } from '@/core/queue/QueueManager';
import { getOpsUserId } from '@/lib/ops/session';

/**
 * GET /api/ops/queues/health — get queue system health status.
 */
export async function GET() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const queueManager = getQueueManager();

    // Get health status
    const health = await queueManager.getHealth();

    // Get queue statistics
    const stats = (await queueManager.getQueueStats()) as any[];

    return NextResponse.json({
      health: {
        status: health.status,
        redis: health.redis,
        queues: health.queues,
        workers: health.workers,
        jobs: {
          waiting: health.jobs.waiting,
          active: health.jobs.active,
          failed: health.jobs.failed,
        },
      },
      queues: stats.map((stat) => ({
        name: stat.name,
        waiting: stat.waiting,
        active: stat.active,
        completed: stat.completed,
        failed: stat.failed,
        delayed: stat.delayed,
        paused: stat.paused,
      })),
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('GET /api/ops/queues/health', error);
    return NextResponse.json(
      {
        health: {
          status: 'unhealthy',
          redis: false,
          queues: 0,
          workers: 0,
          jobs: { waiting: 0, active: 0, failed: 0 },
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
