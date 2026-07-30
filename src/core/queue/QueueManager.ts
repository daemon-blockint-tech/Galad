/**
 * @file QueueManager.ts
 * @description Centralized queue management with Redis and BullMQ.
 * Manages all async job processing for the system.
 */

import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

export type QueueName = 'anomaly-detection' | 'entity-enrichment' | 'ml-training' | 'fusion-processing' | 'alert-routing' | 'custom';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface WorkerOptions {
  concurrency?: number;
  lockDuration?: number;
  lockRenewTime?: number;
}

/**
 * Centralized manager for all job queues.
 */
export class QueueManager {
  private redisClient: Redis;
  private queues: Map<QueueName | string, Queue> = new Map();
  private workers: Map<QueueName | string, Worker> = new Map();
  private queueEvents: Map<QueueName | string, QueueEvents> = new Map();
  private isInitialized = false;

  constructor(redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {
    this.redisClient = new Redis(redisUrl);
    console.log(`QueueManager: Connecting to Redis at ${redisUrl}`);
  }

  /**
   * Initialize queue manager and verify Redis connection.
   */
  async initialize(): Promise<void> {
    try {
      const pong = await this.redisClient.ping();
      if (pong !== 'PONG') {
        throw new Error('Redis ping failed');
      }
      console.log('✓ QueueManager: Connected to Redis');
      this.isInitialized = true;
    } catch (error) {
      console.error('✗ QueueManager: Failed to connect to Redis', error);
      throw error;
    }
  }

  /**
   * Get or create a queue.
   */
  getQueue(name: QueueName | string): Queue {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized. Call initialize() first.');
    }

    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: this.redisClient,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });

      this.queues.set(name, queue);

      // Set up queue events
      const queueEvents = new QueueEvents(name, { connection: this.redisClient });
      this.queueEvents.set(name, queueEvents);

      // Log queue events
      queueEvents.on('error', (error) => {
        console.error(`Queue ${name} error:`, error);
      });

      console.log(`✓ QueueManager: Created queue "${name}"`);
    }

    return this.queues.get(name)!;
  }

  /**
   * Register a worker processor for a queue.
   */
  registerWorker(
    queueName: QueueName | string,
    processor: (job: any) => Promise<any>,
    options: WorkerOptions = {},
  ): Worker {
    const queue = this.getQueue(queueName);

    if (this.workers.has(queueName)) {
      throw new Error(`Worker already registered for queue "${queueName}"`);
    }

    const worker = new Worker(queueName, processor, {
      connection: this.redisClient,
      concurrency: options.concurrency ?? 1,
      lockDuration: options.lockDuration ?? 30000,
      lockRenewTime: options.lockRenewTime ?? 15000,
    });

    // Error handling
    worker.on('error', (error) => {
      console.error(`Worker ${queueName} error:`, error);
    });

    worker.on('failed', (job, error) => {
      console.error(`Job ${job?.id} in queue ${queueName} failed:`, error);
    });

    this.workers.set(queueName, worker);
    console.log(`✓ QueueManager: Registered worker for queue "${queueName}"`);

    return worker;
  }

  /**
   * Get worker for a queue.
   */
  getWorker(queueName: QueueName | string): Worker | undefined {
    return this.workers.get(queueName);
  }

  /**
   * Enqueue a job.
   */
  async enqueueJob(queueName: QueueName | string, data: any, options?: any): Promise<string> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(queueName, data, options);
    return job.id!;
  }

  /**
   * Get job status.
   */
  async getJobStatus(queueName: QueueName | string, jobId: string): Promise<string | null> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    return await job.getState();
  }

  /**
   * Get queue statistics.
   */
  async getQueueStats(queueName?: QueueName | string): Promise<QueueStats | QueueStats[]> {
    if (queueName) {
      const queue = this.getQueue(queueName);
      const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ]);

      return {
        name: queueName,
        waiting,
        active,
        completed,
        failed,
        delayed,
        // BullMQ v5 has no separate paused list; waiting jobs are held while paused
        paused: isPaused ? waiting : 0,
      };
    }

    // Return stats for all queues
    const stats: QueueStats[] = [];
    for (const [name] of this.queues) {
      const queue = this.queues.get(name)!;
      const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ]);

      stats.push({
        name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused ? waiting : 0,
      });
    }

    return stats;
  }

  /**
   * Get health status.
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    redis: boolean;
    queues: number;
    workers: number;
    jobs: { waiting: number; active: number; failed: number };
  }> {
    try {
      const pong = await this.redisClient.ping();
      const isRedisHealthy = pong === 'PONG';

      // Count jobs
      let totalWaiting = 0;
      let totalActive = 0;
      let totalFailed = 0;

      for (const [name] of this.queues) {
        const queue = this.queues.get(name)!;
        totalWaiting += await queue.getWaitingCount();
        totalActive += await queue.getActiveCount();
        totalFailed += await queue.getFailedCount();
      }

      const status = isRedisHealthy && this.queues.size > 0 ? 'healthy' : this.queues.size > 0 ? 'degraded' : 'unhealthy';

      return {
        status,
        redis: isRedisHealthy,
        queues: this.queues.size,
        workers: this.workers.size,
        jobs: {
          waiting: totalWaiting,
          active: totalActive,
          failed: totalFailed,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        redis: false,
        queues: this.queues.size,
        workers: this.workers.size,
        jobs: { waiting: 0, active: 0, failed: 0 },
      };
    }
  }

  /**
   * Pause a queue.
   */
  async pauseQueue(queueName: QueueName | string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.pause();
    console.log(`Queue "${queueName}" paused`);
  }

  /**
   * Resume a paused queue.
   */
  async resumeQueue(queueName: QueueName | string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.resume();
    console.log(`Queue "${queueName}" resumed`);
  }

  /**
   * Clear all jobs from a queue.
   */
  async clearQueue(queueName: QueueName | string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.drain();
    console.log(`Queue "${queueName}" drained`);
  }

  /**
   * Clean up resources.
   */
  async shutdown(): Promise<void> {
    console.log('QueueManager: Shutting down...');

    // Close all workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      console.log(`✓ Closed worker for queue "${name}"`);
    }

    // Close all queue events
    for (const [name, events] of this.queueEvents) {
      await events.close();
    }

    // Close all queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      console.log(`✓ Closed queue "${name}"`);
    }

    // Close Redis connection
    await this.redisClient.quit();
    console.log('✓ QueueManager: Shutdown complete');
  }

  /**
   * Get all queue names.
   */
  getQueueNames(): (QueueName | string)[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Get Redis client for direct access if needed.
   */
  getRedisClient(): Redis {
    return this.redisClient;
  }
}

// Singleton instance
let instance: QueueManager | null = null;

/**
 * Get or create the QueueManager singleton.
 */
export function getQueueManager(redisUrl?: string): QueueManager {
  if (!instance) {
    instance = new QueueManager(redisUrl);
  }
  return instance;
}

/**
 * Initialize the QueueManager singleton.
 */
export async function initializeQueueManager(redisUrl?: string): Promise<QueueManager> {
  const manager = getQueueManager(redisUrl);
  await manager.initialize();
  return manager;
}
