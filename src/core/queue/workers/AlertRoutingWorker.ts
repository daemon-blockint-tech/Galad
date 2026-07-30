/**
 * @file AlertRoutingWorker.ts
 * @description BullMQ worker for async alert routing to external channels.
 */

import { Job } from 'bullmq';
import { AlertRouter } from '@/core/alerts/AlertRouter';
import { AlertChannelManager, getAlertChannelManager } from '@/core/alerts/AlertChannelManager';
import { PrismaClient } from '@/generated/prisma';

export interface AlertRoutingJobData {
  alertId: string;
  tenantId?: string;
  channels: string[];
  alert: {
    severity: string;
    title: string;
    description: string;
    entityId: string;
    enrichedContext: Record<string, any>;
  };
}

export interface AlertRoutingJobResult {
  success: boolean;
  alertId: string;
  duration: number;
  results: Array<{
    channel: string;
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

/**
 * Alert routing worker - handles delivery to multiple channels.
 */
export class AlertRoutingWorker {
  private alertRouter: AlertRouter;
  private channelManager: AlertChannelManager;
  private db: PrismaClient;

  constructor(db: PrismaClient, channelManager: AlertChannelManager) {
    this.db = db;
    this.channelManager = channelManager;
    this.alertRouter = new AlertRouter();
  }

  /**
   * Process alert routing jobs.
   */
  async process(job: Job<AlertRoutingJobData>): Promise<AlertRoutingJobResult> {
    const startTime = performance.now();
    const { alertId, tenantId, channels, alert } = job.data;

    try {
      const results: Array<{
        channel: string;
        success: boolean;
        messageId?: string;
        error?: string;
      }> = [];

      // Route to each channel
      for (const channel of channels) {
        try {
          const result = await this.channelManager.sendToChannel(channel, alertId, alert);

          results.push({
            channel,
            success: result.success,
            messageId: result.messageId,
            error: result.error,
          });

          // Record routing event
          if (tenantId) {
            await this.db.alertEvent.create({
              data: {
                tenantId,
                alertId,
                eventType: 'routed',
                eventData: JSON.stringify({
                  channel,
                  success: result.success,
                  messageId: result.messageId,
                  error: result.error,
                }),
              },
            });
          }
        } catch (error) {
          console.error(`AlertRoutingWorker: Failed to route to ${channel}:`, error);

          results.push({
            channel,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const duration = performance.now() - startTime;
      const allSuccessful = results.every((r) => r.success);

      return {
        success: allSuccessful,
        alertId,
        duration,
        results,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      console.error(`AlertRoutingWorker: Job ${job.id} failed:`, error);

      return {
        success: false,
        alertId,
        duration,
        results: [],
      };
    }
  }

  /**
   * Get channel manager for metrics.
   */
  getChannelManager(): AlertChannelManager {
    return this.channelManager;
  }

  /**
   * Get healthy channels.
   */
  getHealthyChannels(): string[] {
    return this.channelManager.getHealthyChannels();
  }

  /**
   * Get channel metrics.
   */
  getChannelMetrics() {
    return this.channelManager.getMetrics();
  }
}

/**
 * Create the processor function for BullMQ.
 */
export function createAlertRoutingProcessor(db: PrismaClient, channelManager: AlertChannelManager) {
  const worker = new AlertRoutingWorker(db, channelManager);

  return async (job: Job<AlertRoutingJobData>): Promise<AlertRoutingJobResult> => {
    return worker.process(job);
  };
}
