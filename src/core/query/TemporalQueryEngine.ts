/**
 * @file TemporalQueryEngine.ts
 * @description Temporal query engine for time-based entity analysis.
 * Supports queries like "entities with behavior changes in last 24h".
 */

import { PrismaClient } from '@/generated/prisma';
import { AnomalyDetectionEngine } from '@/core/ml/AnomalyDetectionEngine';
import { SemanticStore } from '@/core/semantic/semanticStore';

export interface TemporalQuery {
  type: 'anomaly_timeline' | 'behavior_change' | 'threat_trend' | 'alert_timeline';
  entityIds?: string[];
  timeRange: [startTime: number, endTime: number];
  threshold?: number; // For anomaly scores
  aggregation?: 'raw' | 'hourly' | 'daily'; // Time bucketing
}

export interface TemporalQueryResult {
  type: string;
  entityId?: string;
  timeline: Array<{
    timestamp: number;
    value: number;
    count?: number;
    details?: any;
  }>;
  summary: {
    minValue: number;
    maxValue: number;
    averageValue: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
}

/**
 * Temporal query engine for time-based analysis.
 */
export class TemporalQueryEngine {
  private db: PrismaClient;
  private anomalyEngine: AnomalyDetectionEngine;
  private store: SemanticStore;
  private tenantId?: string;

  constructor(db: PrismaClient, anomalyEngine: AnomalyDetectionEngine, store: SemanticStore, tenantId?: string) {
    this.db = db;
    this.anomalyEngine = anomalyEngine;
    this.store = store;
    this.tenantId = tenantId;
  }

  /**
   * Execute temporal query.
   */
  async query(q: TemporalQuery): Promise<TemporalQueryResult[]> {
    switch (q.type) {
      case 'anomaly_timeline':
        return this.queryAnomalyTimeline(q);

      case 'behavior_change':
        return this.queryBehaviorChange(q);

      case 'threat_trend':
        return this.queryThreatTrend(q);

      case 'alert_timeline':
        return this.queryAlertTimeline(q);

      default:
        throw new Error(`Unknown query type: ${q.type}`);
    }
  }

  /**
   * Get anomaly scores over time.
   */
  private async queryAnomalyTimeline(q: TemporalQuery): Promise<TemporalQueryResult[]> {
    const [startTime, endTime] = q.timeRange;
    const threshold = q.threshold ?? 0.5;
    const bucketSize = this.getBucketSize(startTime, endTime, q.aggregation);

    const results: TemporalQueryResult[] = [];

    // For each entity, create anomaly timeline
    const entityIds = q.entityIds || [];
    if (entityIds.length === 0) {
      // Return empty result if no entities specified
      return [];
    }

    for (const entityId of entityIds) {
      const timeline: TemporalQueryResult['timeline'] = [];

      // Create time buckets
      for (let t = startTime; t < endTime; t += bucketSize) {
        const bucketEnd = Math.min(t + bucketSize, endTime);

        // In a real implementation, would fetch behaviors from store/database
        // and compute anomaly scores for this bucket
        timeline.push({
          timestamp: t,
          value: Math.random(), // Placeholder
          count: Math.floor(Math.random() * 50),
        });
      }

      const summary = this.calculateSummary(timeline);

      results.push({
        type: 'anomaly_timeline',
        entityId,
        timeline,
        summary,
      });
    }

    return results;
  }

  /**
   * Query behavior changes (deviation from baseline).
   */
  private async queryBehaviorChange(q: TemporalQuery): Promise<TemporalQueryResult[]> {
    const [startTime, endTime] = q.timeRange;
    const threshold = q.threshold ?? 2.0; // 2 sigma deviation
    const bucketSize = this.getBucketSize(startTime, endTime, q.aggregation);

    const results: TemporalQueryResult[] = [];

    // Query alerts that indicate behavior changes
    const alerts = await this.db.alert.findMany({
      where: {
        tenantId: this.tenantId,
        type: 'anomaly',
        createdAt: {
          gte: new Date(startTime),
          lte: new Date(endTime),
        },
      },
      select: {
        id: true,
        entityId: true,
        createdAt: true,
        enrichedContext: true,
      },
    });

    // Group by entity and aggregate
    const byEntity = new Map<string, TemporalQueryResult['timeline']>();

    for (const alert of alerts) {
      if (!byEntity.has(alert.entityId)) {
        byEntity.set(alert.entityId, []);
      }

      const timeline = byEntity.get(alert.entityId)!;
      const timestamp = alert.createdAt.getTime();
      const bucket = Math.floor((timestamp - startTime) / bucketSize) * bucketSize + startTime;

      // Find or create bucket entry
      let entry = timeline.find((e) => e.timestamp === bucket);
      if (!entry) {
        entry = { timestamp: bucket, value: 0, count: 0 };
        timeline.push(entry);
      }

      entry.count = (entry.count || 0) + 1;
      entry.value += 1;
    }

    // Sort and format results
    for (const [entityId, timeline] of byEntity) {
      timeline.sort((a, b) => a.timestamp - b.timestamp);
      const summary = this.calculateSummary(timeline);

      results.push({
        type: 'behavior_change',
        entityId,
        timeline,
        summary,
      });
    }

    return results;
  }

  /**
   * Query threat level trends.
   */
  private async queryThreatTrend(q: TemporalQuery): Promise<TemporalQueryResult[]> {
    const [startTime, endTime] = q.timeRange;
    const bucketSize = this.getBucketSize(startTime, endTime, q.aggregation);

    // Query critical/high alerts as threat indicators
    const alerts = await this.db.alert.findMany({
      where: {
        tenantId: this.tenantId,
        severity: { in: ['critical', 'high'] },
        createdAt: {
          gte: new Date(startTime),
          lte: new Date(endTime),
        },
      },
      select: {
        createdAt: true,
        severity: true,
      },
    });

    const timeline: TemporalQueryResult['timeline'] = [];

    // Aggregate threats by time bucket
    for (let t = startTime; t < endTime; t += bucketSize) {
      const count = alerts.filter((a) => {
        const aTime = a.createdAt.getTime();
        return aTime >= t && aTime < t + bucketSize;
      }).length;

      // Normalize to 0-1 scale
      const normalizedValue = Math.min(1, count / 10);

      timeline.push({
        timestamp: t,
        value: normalizedValue,
        count,
      });
    }

    const summary = this.calculateSummary(timeline);

    return [
      {
        type: 'threat_trend',
        timeline,
        summary,
      },
    ];
  }

  /**
   * Query alert timeline.
   */
  private async queryAlertTimeline(q: TemporalQuery): Promise<TemporalQueryResult[]> {
    const [startTime, endTime] = q.timeRange;
    const bucketSize = this.getBucketSize(startTime, endTime, q.aggregation);

    const alerts = await this.db.alert.findMany({
      where: {
        tenantId: this.tenantId,
        createdAt: {
          gte: new Date(startTime),
          lte: new Date(endTime),
        },
      },
      select: {
        id: true,
        severity: true,
        createdAt: true,
      },
    });

    const timeline: TemporalQueryResult['timeline'] = [];
    const severityScores = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25 };

    // Aggregate by bucket
    for (let t = startTime; t < endTime; t += bucketSize) {
      const bucketAlerts = alerts.filter((a) => {
        const aTime = a.createdAt.getTime();
        return aTime >= t && aTime < t + bucketSize;
      });

      let totalScore = 0;
      for (const alert of bucketAlerts) {
        totalScore += severityScores[alert.severity as keyof typeof severityScores] || 0;
      }

      const value = bucketAlerts.length > 0 ? totalScore / bucketAlerts.length : 0;

      timeline.push({
        timestamp: t,
        value,
        count: bucketAlerts.length,
      });
    }

    const summary = this.calculateSummary(timeline);

    return [
      {
        type: 'alert_timeline',
        timeline,
        summary,
      },
    ];
  }

  /**
   * Calculate summary statistics.
   */
  private calculateSummary(timeline: TemporalQueryResult['timeline']): TemporalQueryResult['summary'] {
    if (timeline.length === 0) {
      return {
        minValue: 0,
        maxValue: 0,
        averageValue: 0,
        trend: 'stable',
      };
    }

    const values = timeline.map((t) => t.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const averageValue = values.reduce((a, b) => a + b, 0) / values.length;

    // Determine trend
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (secondAvg > firstAvg * 1.1) trend = 'increasing';
    if (secondAvg < firstAvg * 0.9) trend = 'decreasing';

    return {
      minValue,
      maxValue,
      averageValue,
      trend,
    };
  }

  /**
   * Get bucket size based on time range and aggregation.
   */
  private getBucketSize(startTime: number, endTime: number, aggregation?: string): number {
    const totalTime = endTime - startTime;

    switch (aggregation) {
      case 'hourly':
        return 3600000; // 1 hour
      case 'daily':
        return 86400000; // 1 day
      case 'raw':
      default:
        // Auto-select bucket size: aim for 50-100 buckets
        const defaultBuckets = 100;
        return Math.max(60000, Math.floor(totalTime / defaultBuckets)); // Min 1 minute
    }
  }
}
