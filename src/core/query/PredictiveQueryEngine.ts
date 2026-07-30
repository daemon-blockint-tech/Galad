/**
 * @file PredictiveQueryEngine.ts
 * @description Predictive query engine for anomaly forecasting and threat escalation.
 * Uses simple linear regression and trend extrapolation.
 */

import { PrismaClient } from '@/generated/prisma';
import { AnomalyDetectionEngine } from '@/core/ml/AnomalyDetectionEngine';

export interface PredictiveQuery {
  type: 'anomaly_forecast' | 'threat_escalation' | 'eta_resolution';
  entityIds?: string[];
  horizon: number; // Forecast horizon in milliseconds
  confidence?: number; // Target confidence level (0-1)
}

export interface PredictionResult {
  type: string;
  entityId?: string;
  forecast: Array<{
    timestamp: number;
    predictedValue: number;
    confidence: number;
    upper95: number;
    lower95: number;
  }>;
  trend: 'improving' | 'degrading' | 'stable';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

/**
 * Predictive query engine using linear regression and trend analysis.
 */
export class PredictiveQueryEngine {
  private db: PrismaClient;
  private anomalyEngine: AnomalyDetectionEngine;
  private tenantId?: string;

  constructor(db: PrismaClient, anomalyEngine: AnomalyDetectionEngine, tenantId?: string) {
    this.db = db;
    this.anomalyEngine = anomalyEngine;
    this.tenantId = tenantId;
  }

  /**
   * Execute predictive query.
   */
  async query(q: PredictiveQuery): Promise<PredictionResult[]> {
    switch (q.type) {
      case 'anomaly_forecast':
        return this.forecastAnomalies(q);

      case 'threat_escalation':
        return this.predictThreatEscalation(q);

      case 'eta_resolution':
        return this.estimateResolutionTime(q);

      default:
        throw new Error(`Unknown query type: ${q.type}`);
    }
  }

  /**
   * Forecast anomaly scores over time horizon.
   */
  private async forecastAnomalies(q: PredictiveQuery): Promise<PredictionResult[]> {
    const results: PredictionResult[] = [];
    const entityIds = q.entityIds || [];

    for (const entityId of entityIds) {
      // Get historical anomaly data from alerts
      const alerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          entityId,
          type: 'anomaly',
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      // Create time series
      const timeSeries = this.createTimeSeries(alerts.map((a) => a.createdAt.getTime()));

      // Fit linear regression
      const { slope, intercept, rSquared } = this.fitLinearRegression(timeSeries);

      // Generate forecast
      const forecast: PredictionResult['forecast'] = [];
      const now = Date.now();
      const stepSize = q.horizon / 10; // 10 points in forecast

      for (let i = 1; i <= 10; i++) {
        const forecastTime = now + stepSize * i;
        const timeIndex = (forecastTime - now) / (24 * 60 * 60 * 1000);

        // Linear prediction
        const predictedValue = slope * timeIndex + intercept;
        const confidenceScore = Math.max(0.1, Math.min(1, rSquared));
        const stdError = Math.sqrt(1 - rSquared) * 0.2;

        forecast.push({
          timestamp: Math.floor(forecastTime),
          predictedValue: Math.max(0, predictedValue),
          confidence: confidenceScore,
          upper95: Math.max(0, predictedValue + 1.96 * stdError),
          lower95: Math.max(0, predictedValue - 1.96 * stdError),
        });
      }

      // Determine trend
      const trend = this.determineTrend(slope);
      const riskLevel = this.assessRisk(forecast);
      const recommendations = this.getRecommendations(trend, riskLevel);

      results.push({
        type: 'anomaly_forecast',
        entityId,
        forecast,
        trend,
        riskLevel,
        recommendations,
      });
    }

    return results;
  }

  /**
   * Predict threat escalation probability.
   */
  private async predictThreatEscalation(q: PredictiveQuery): Promise<PredictionResult[]> {
    const results: PredictionResult[] = [];
    const entityIds = q.entityIds || [];

    for (const entityId of entityIds) {
      // Get recent threat alerts
      const recentAlerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          entityId,
          severity: { in: ['high', 'critical'] },
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        select: { createdAt: true, severity: true },
        orderBy: { createdAt: 'desc' },
      });

      // Calculate escalation velocity
      const escalationRate = this.calculateEscalationRate(recentAlerts);

      // Generate threat forecast
      const forecast: PredictionResult['forecast'] = [];
      const now = Date.now();
      const stepSize = q.horizon / 10;

      for (let i = 1; i <= 10; i++) {
        const forecastTime = now + stepSize * i;
        const daysAhead = (forecastTime - now) / (24 * 60 * 60 * 1000);

        // Exponential growth model for threat escalation
        const predictedValue = Math.min(1, escalationRate * Math.exp(daysAhead * 0.1));

        forecast.push({
          timestamp: Math.floor(forecastTime),
          predictedValue,
          confidence: 0.7,
          upper95: Math.min(1, predictedValue * 1.3),
          lower95: Math.max(0, predictedValue * 0.7),
        });
      }

      const trend = escalationRate > 0.05 ? 'degrading' : 'stable';
      const riskLevel = this.assessRisk(forecast);
      const recommendations = this.getRecommendations(trend, riskLevel);

      results.push({
        type: 'threat_escalation',
        entityId,
        forecast,
        trend,
        riskLevel,
        recommendations,
      });
    }

    return results;
  }

  /**
   * Estimate time-to-resolution for active alerts.
   */
  private async estimateResolutionTime(q: PredictiveQuery): Promise<PredictionResult[]> {
    const results: PredictionResult[] = [];
    const entityIds = q.entityIds || [];

    for (const entityId of entityIds) {
      // Get resolved alerts to establish baseline
      const resolvedAlerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          entityId,
          status: 'resolved',
          resolvedAt: { not: null },
        },
        select: { createdAt: true, resolvedAt: true },
      });

      // Calculate average resolution time
      const resolutionTimes = resolvedAlerts
        .map((a) => (a.resolvedAt!.getTime() - a.createdAt.getTime()) / (60 * 60 * 1000)) // In hours
        .filter((t) => t > 0 && t < 168); // Filter outliers (> 1 week)

      const avgResolutionTime = resolutionTimes.length > 0 ? resolutionTimes.reduce((a, b) => a + b) / resolutionTimes.length : 24;

      // Generate ETA forecast
      const forecast: PredictionResult['forecast'] = [];
      const now = Date.now();
      const stepSize = q.horizon / 10;

      for (let i = 0; i <= 10; i++) {
        const forecastTime = now + stepSize * i;
        const hoursElapsed = (forecastTime - now) / (60 * 60 * 1000);

        // Probability of resolution by this time
        const predictedValue = Math.min(1, hoursElapsed / avgResolutionTime);

        forecast.push({
          timestamp: Math.floor(forecastTime),
          predictedValue,
          confidence: resolutionTimes.length > 5 ? 0.8 : 0.5,
          upper95: Math.min(1, predictedValue * 1.2),
          lower95: Math.max(0, predictedValue * 0.8),
        });
      }

      results.push({
        type: 'eta_resolution',
        entityId,
        forecast,
        trend: 'improving',
        riskLevel: 'low',
        recommendations: [`Expected resolution in ~${Math.round(avgResolutionTime)} hours`],
      });
    }

    return results;
  }

  /**
   * Create time series from timestamps.
   */
  private createTimeSeries(timestamps: number[]): number[] {
    if (timestamps.length === 0) return [0];

    // Aggregate events into daily buckets
    const dayBuckets = new Map<number, number>();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const ts of timestamps) {
      const dayKey = Math.floor(ts / oneDay);
      dayBuckets.set(dayKey, (dayBuckets.get(dayKey) || 0) + 1);
    }

    // Sort and return values
    const sortedKeys = Array.from(dayBuckets.keys()).sort((a, b) => a - b);
    return sortedKeys.map((k) => dayBuckets.get(k)!);
  }

  /**
   * Fit linear regression to time series.
   */
  private fitLinearRegression(
    timeSeries: number[],
  ): { slope: number; intercept: number; rSquared: number } {
    const n = timeSeries.length;
    if (n < 2) {
      return { slope: 0, intercept: timeSeries[0] || 0, rSquared: 0 };
    }

    // X values are time indices
    const xValues = Array.from({ length: n }, (_, i) => i);
    const yValues = timeSeries;

    const xMean = xValues.reduce((a, b) => a + b) / n;
    const yMean = yValues.reduce((a, b) => a + b) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
      denominator += (xValues[i] - xMean) ** 2;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Calculate R-squared
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < n; i++) {
      const predicted = slope * xValues[i] + intercept;
      ssRes += (yValues[i] - predicted) ** 2;
      ssTot += (yValues[i] - yMean) ** 2;
    }

    const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

    return { slope, intercept, rSquared };
  }

  /**
   * Determine trend from slope.
   */
  private determineTrend(slope: number): 'improving' | 'degrading' | 'stable' {
    if (slope > 0.1) return 'degrading';
    if (slope < -0.1) return 'improving';
    return 'stable';
  }

  /**
   * Assess risk level from forecast.
   */
  private assessRisk(forecast: PredictionResult['forecast']): 'low' | 'medium' | 'high' | 'critical' {
    const avgValue = forecast.reduce((a, b) => a + b.predictedValue, 0) / forecast.length;
    const maxValue = Math.max(...forecast.map((f) => f.upper95));

    if (maxValue > 0.9) return 'critical';
    if (maxValue > 0.7 || avgValue > 0.6) return 'high';
    if (avgValue > 0.4) return 'medium';
    return 'low';
  }

  /**
   * Calculate escalation rate from recent alerts.
   */
  private calculateEscalationRate(alerts: Array<{ createdAt: Date; severity: string }>): number {
    if (alerts.length < 2) return 0;

    const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
    const totalCount = alerts.length;
    const ratio = criticalCount / totalCount;

    // Rate of change in criticality
    const recentRatio = alerts
      .slice(0, Math.ceil(alerts.length / 2))
      .filter((a) => a.severity === 'critical').length / Math.ceil(alerts.length / 2);

    return recentRatio - (1 - ratio);
  }

  /**
   * Get recommendations based on trend and risk.
   */
  private getRecommendations(trend: string, riskLevel: string): string[] {
    const recommendations: string[] = [];

    if (trend === 'degrading') {
      recommendations.push('Threat escalating - increase monitoring frequency');
      recommendations.push('Consider activating additional response procedures');
    }

    if (riskLevel === 'critical') {
      recommendations.push('URGENT: Escalate to incident response team');
      recommendations.push('Implement immediate containment measures');
    } else if (riskLevel === 'high') {
      recommendations.push('Notify security team for elevated threat response');
      recommendations.push('Review and update alert thresholds');
    }

    if (trend === 'improving') {
      recommendations.push('Positive trend - continue current response');
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue standard monitoring');
    }

    return recommendations;
  }
}
