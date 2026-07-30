/**
 * @file CorrelationQueryEngine.ts
 * @description Correlation analysis engine for entity relationship discovery.
 * Identifies shared threat patterns, temporal alignment, and spatial proximity.
 */

import { PrismaClient } from '@/generated/prisma';
import { SemanticStore } from '@/core/semantic/semanticStore';
import { getEntityPosition } from '@/core/semantic/geo';

export interface CorrelationQuery {
  type: 'threat_correlation' | 'temporal_alignment' | 'spatial_proximity' | 'entity_fusion';
  entityIds: string[];
  timeWindow?: number; // Milliseconds for temporal alignment
  spatialRadius?: number; // Meters for spatial proximity
  threshold?: number; // Correlation strength threshold (0-1)
}

export interface CorrelationResult {
  type: string;
  entityPair: [string, string];
  correlationScore: number; // 0-1
  strength: 'weak' | 'moderate' | 'strong' | 'very_strong';
  evidence: Array<{
    type: string;
    score: number;
    details: any;
  }>;
  recommendation: string;
}

/**
 * Signals analyzeThreatCorrelation attempts per pair (threat level similarity,
 * alert type overlap, alert severity alignment). The score is averaged over all
 * three so a lone signal cannot carry a pair to 1.0.
 */
const THREAT_CORRELATION_SIGNALS = 3;

interface EntityContext {
  id: string;
  threatLevel: number;
  lastAlertTime?: number;
  alertCount: number;
  recentAlerts: Array<{ type: string; severity: string; timestamp: number }>;
  lastLocation?: { lat: number; lng: number; timestamp?: number };
  behaviors: Array<{ timestamp: number; type: string; value: number }>;
}

export class CorrelationQueryEngine {
  private db: PrismaClient;
  private tenantId?: string;
  private store?: SemanticStore;

  constructor(db: PrismaClient, tenantId?: string, store?: SemanticStore) {
    this.db = db;
    this.tenantId = tenantId;
    this.store = store;
  }

  /**
   * Execute correlation query.
   */
  async query(q: CorrelationQuery): Promise<CorrelationResult[]> {
    switch (q.type) {
      case 'threat_correlation':
        return this.analyzeThreatCorrelation(q);

      case 'temporal_alignment':
        return this.analyzeTemporalAlignment(q);

      case 'spatial_proximity':
        return this.analyzeSpatialProximity(q);

      case 'entity_fusion':
        return this.analyzeEntityFusion(q);

      default:
        throw new Error(`Unknown correlation type: ${q.type}`);
    }
  }

  /**
   * Analyze shared threat patterns between entities.
   */
  private async analyzeThreatCorrelation(q: CorrelationQuery): Promise<CorrelationResult[]> {
    const { entityIds, threshold = 0.5 } = q;
    const results: CorrelationResult[] = [];

    // Build entity context for all entities
    const contexts = await Promise.all(entityIds.map((id) => this.buildEntityContext(id)));

    // Compare all pairs
    for (let i = 0; i < contexts.length; i++) {
      for (let j = i + 1; j < contexts.length; j++) {
        const context1 = contexts[i];
        const context2 = contexts[j];

        // Every signal below derives from alerts. With none on either side
        // there is nothing to correlate — matching zeroes is not evidence.
        if (context1.alertCount === 0 || context2.alertCount === 0) {
          continue;
        }

        const evidence: CorrelationResult['evidence'] = [];

        // Check threat level similarity
        const threatDiff = Math.abs(context1.threatLevel - context2.threatLevel);
        const threatScore = 1 - Math.min(1, threatDiff * 1.5);
        if (threatScore > 0.3) {
          evidence.push({
            type: 'threat_level_similarity',
            score: threatScore,
            details: { entity1: context1.threatLevel, entity2: context2.threatLevel },
          });
        }

        // Check alert type overlap
        const typeOverlap = this.calculateSetOverlap(
          context1.recentAlerts.map((a) => a.type),
          context2.recentAlerts.map((a) => a.type),
        );
        if (typeOverlap > 0.3) {
          evidence.push({
            type: 'alert_type_overlap',
            score: typeOverlap,
            details: { alertTypes: Array.from(new Set([...context1.recentAlerts.map((a) => a.type), ...context2.recentAlerts.map((a) => a.type)])) },
          });
        }

        // Check alert severity correlation
        const severityAlign = this.calculateAlertSeverityAlignment(context1, context2);
        if (severityAlign > 0.3) {
          evidence.push({
            type: 'alert_severity_alignment',
            score: severityAlign,
            details: { context1AlertCount: context1.alertCount, context2AlertCount: context2.alertCount },
          });
        }

        // Averaged over the signals *attempted*, not the ones that happened to
        // fire: dividing by evidence.length let a single signal at 1.0 become a
        // 1.0 "very_strong" correlation.
        const correlationScore = evidence.reduce((sum, e) => sum + e.score, 0) / THREAT_CORRELATION_SIGNALS;

        if (correlationScore >= threshold) {
          results.push({
            type: 'threat_correlation',
            entityPair: [context1.id, context2.id],
            correlationScore,
            strength: this.scoreToStrength(correlationScore),
            evidence,
            recommendation: this.getCorrelationRecommendation(correlationScore, context1, context2),
          });
        }
      }
    }

    return results.sort((a, b) => b.correlationScore - a.correlationScore);
  }

  /**
   * Analyze temporal alignment of anomalies and alerts.
   */
  private async analyzeTemporalAlignment(q: CorrelationQuery): Promise<CorrelationResult[]> {
    const { entityIds, timeWindow = 300000, threshold = 0.6 } = q; // 5 min default
    const results: CorrelationResult[] = [];

    const contexts = await Promise.all(entityIds.map((id) => this.buildEntityContext(id)));

    for (let i = 0; i < contexts.length; i++) {
      for (let j = i + 1; j < contexts.length; j++) {
        const context1 = contexts[i];
        const context2 = contexts[j];

        const evidence: CorrelationResult['evidence'] = [];

        // Check alert timing proximity
        if (context1.lastAlertTime && context2.lastAlertTime) {
          const timeDiff = Math.abs(context1.lastAlertTime - context2.lastAlertTime);
          const withinWindow = timeDiff <= timeWindow;

          if (withinWindow) {
            const proximityScore = 1 - Math.min(1, timeDiff / timeWindow);
            evidence.push({
              type: 'alert_timing_proximity',
              score: proximityScore,
              details: {
                entity1Time: context1.lastAlertTime,
                entity2Time: context2.lastAlertTime,
                timeDiffMs: timeDiff,
              },
            });
          }
        }

        // Check behavior pattern alignment over time
        const behaviorAlignment = this.calculateBehaviorAlignment(context1.behaviors, context2.behaviors, timeWindow);
        if (behaviorAlignment > 0.2) {
          evidence.push({
            type: 'behavior_pattern_alignment',
            score: behaviorAlignment,
            details: {
              entity1Behaviors: context1.behaviors.length,
              entity2Behaviors: context2.behaviors.length,
            },
          });
        }

        const correlationScore = evidence.length > 0 ? evidence.reduce((sum, e) => sum + e.score, 0) / evidence.length : 0;

        if (correlationScore >= threshold) {
          results.push({
            type: 'temporal_alignment',
            entityPair: [context1.id, context2.id],
            correlationScore,
            strength: this.scoreToStrength(correlationScore),
            evidence,
            recommendation: `Temporal alignment detected within ${timeWindow / 1000}s window. Consider investigating as coordinated activity.`,
          });
        }
      }
    }

    return results.sort((a, b) => b.correlationScore - a.correlationScore);
  }

  /**
   * Analyze spatial proximity between entities.
   *
   * Requires a position for every requested entity. Skipping unlocated
   * entities silently returned `[]`, which an operator reads as "checked, not
   * co-located" when in fact no proximity test ran.
   */
  private async analyzeSpatialProximity(q: CorrelationQuery): Promise<CorrelationResult[]> {
    const { entityIds, spatialRadius = 1000, threshold = 0.5 } = q; // 1km default
    const results: CorrelationResult[] = [];

    const contexts = await Promise.all(entityIds.map((id) => this.buildEntityContext(id)));

    const unlocated = contexts.filter((c) => !c.lastLocation).map((c) => c.id);
    if (unlocated.length > 0) {
      throw new Error(
        `spatial_proximity requires a known position for every entity; none available for: ${unlocated.join(', ')}`,
      );
    }

    for (let i = 0; i < contexts.length; i++) {
      for (let j = i + 1; j < contexts.length; j++) {
        const context1 = contexts[i];
        const context2 = contexts[j];

        if (!context1.lastLocation || !context2.lastLocation) {
          continue;
        }

        const evidence: CorrelationResult['evidence'] = [];

        // Calculate haversine distance
        const distance = this.haversineDistance(context1.lastLocation, context2.lastLocation);
        const withinRadius = distance <= spatialRadius;

        if (withinRadius) {
          const proximityScore = 1 - Math.min(1, distance / spatialRadius);
          evidence.push({
            type: 'spatial_proximity',
            score: proximityScore,
            details: {
              distanceMeters: Math.round(distance),
              entity1Lat: context1.lastLocation.lat,
              entity1Lng: context1.lastLocation.lng,
              entity2Lat: context2.lastLocation.lat,
              entity2Lng: context2.lastLocation.lng,
            },
          });

          // Check if locations updated around same time. Only when both
          // sources actually timestamped the fix — otherwise this signal would
          // score two undated positions as perfectly simultaneous.
          const time1 = context1.lastLocation.timestamp;
          const time2 = context2.lastLocation.timestamp;
          if (time1 !== undefined && time2 !== undefined) {
            const locationTimeDiff = Math.abs(time1 - time2);
            if (locationTimeDiff < 300000) { // Within 5 minutes
              const timeProximityScore = 1 - Math.min(1, locationTimeDiff / 300000);
              evidence.push({
                type: 'location_timing_proximity',
                score: timeProximityScore,
                details: { timeDiffMs: locationTimeDiff },
              });
            }
          }
        }

        const correlationScore = evidence.length > 0 ? evidence.reduce((sum, e) => sum + e.score, 0) / evidence.length : 0;

        if (correlationScore >= threshold) {
          results.push({
            type: 'spatial_proximity',
            entityPair: [context1.id, context2.id],
            correlationScore,
            strength: this.scoreToStrength(correlationScore),
            evidence,
            recommendation: `Entities within ${spatialRadius}m. Investigate for coordinated movement or shared infrastructure.`,
          });
        }
      }
    }

    return results.sort((a, b) => b.correlationScore - a.correlationScore);
  }

  /**
   * Analyze entity fusion candidates (potential duplicates or aliases).
   */
  private async analyzeEntityFusion(q: CorrelationQuery): Promise<CorrelationResult[]> {
    const { entityIds, threshold = 0.75 } = q;
    const results: CorrelationResult[] = [];

    const contexts = await Promise.all(entityIds.map((id) => this.buildEntityContext(id)));

    for (let i = 0; i < contexts.length; i++) {
      for (let j = i + 1; j < contexts.length; j++) {
        const context1 = contexts[i];
        const context2 = contexts[j];

        // Nothing known about one side: two entities with no alerts and no
        // behaviours are not fusion candidates, they are unobserved.
        if (
          (context1.alertCount === 0 && context1.behaviors.length === 0) ||
          (context2.alertCount === 0 && context2.behaviors.length === 0)
        ) {
          continue;
        }

        const evidence: CorrelationResult['evidence'] = [];

        // Same threat level range — only meaningful when both threat levels
        // were derived from actual alerts.
        if (
          context1.alertCount > 0 &&
          context2.alertCount > 0 &&
          Math.abs(context1.threatLevel - context2.threatLevel) < 0.15
        ) {
          evidence.push({
            type: 'threat_level_match',
            score: 0.9,
            details: { threatLevel: context1.threatLevel },
          });
        }

        // High alert type overlap (identical threat signatures)
        const typeOverlap = this.calculateSetOverlap(
          context1.recentAlerts.map((a) => a.type),
          context2.recentAlerts.map((a) => a.type),
        );
        if (typeOverlap > 0.7) {
          evidence.push({
            type: 'threat_signature_match',
            score: typeOverlap,
            details: { commonAlertTypes: this.getCommonElements(
              context1.recentAlerts.map((a) => a.type),
              context2.recentAlerts.map((a) => a.type),
            ) },
          });
        }

        // Identical behavior patterns
        const behaviorSimilarity = this.calculateBehaviorSimilarity(context1.behaviors, context2.behaviors);
        if (behaviorSimilarity > 0.7) {
          evidence.push({
            type: 'behavior_pattern_match',
            score: behaviorSimilarity,
            details: { behaviorCorrelation: 'High similarity in temporal behavior' },
          });
        }

        // Close proximity (if locations available)
        if (context1.lastLocation && context2.lastLocation) {
          const distance = this.haversineDistance(context1.lastLocation, context2.lastLocation);
          if (distance < 100) { // Within 100m
            evidence.push({
              type: 'location_proximity',
              score: 0.95,
              details: { distanceMeters: Math.round(distance) },
            });
          }
        }

        const correlationScore = evidence.length > 0 ? evidence.reduce((sum, e) => sum + e.score, 0) / evidence.length : 0;

        if (correlationScore >= threshold) {
          results.push({
            type: 'entity_fusion',
            entityPair: [context1.id, context2.id],
            correlationScore,
            strength: this.scoreToStrength(correlationScore),
            evidence,
            recommendation: `Strong fusion candidate. These entities may be duplicates or aliases. Consider merging records to avoid analysis fragmentation.`,
          });
        }
      }
    }

    return results.sort((a, b) => b.correlationScore - a.correlationScore);
  }

  /**
   * Build entity context for correlation analysis.
   */
  private async buildEntityContext(entityId: string): Promise<EntityContext> {
    const [alerts, behaviors] = await Promise.all([
      this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          entityId,
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        select: {
          id: true,
          type: true,
          severity: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      // No dedicated behavior model exists; anomaly-type alerts are the
      // behavior signal (same source PredictiveQueryEngine forecasts from).
      this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          entityId,
          type: 'anomaly',
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        select: {
          createdAt: true,
          escalationLevel: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const maxThreatLevel = alerts.length > 0 ? (alerts[0].severity === 'critical' ? 0.95 : alerts[0].severity === 'high' ? 0.75 : 0.5) : 0;

    return {
      id: entityId,
      threatLevel: maxThreatLevel,
      lastAlertTime: alerts.length > 0 ? alerts[0].createdAt.getTime() : undefined,
      alertCount: alerts.length,
      recentAlerts: alerts.slice(0, 20).map((a) => ({
        type: a.type,
        severity: a.severity,
        timestamp: a.createdAt.getTime(),
      })),
      lastLocation: this.resolveLocation(entityId),
      behaviors: behaviors.map((b) => ({
        timestamp: b.createdAt.getTime(),
        type: 'anomaly',
        value: b.escalationLevel,
      })),
    };
  }

  /**
   * Resolve an entity's last known position from the semantic store.
   * Alert entity ids are `pluginId|entityId` (see AlertOrchestrator).
   * Returns undefined when no store is wired in or no position is known.
   */
  private resolveLocation(entityId: string): EntityContext['lastLocation'] {
    if (!this.store) return undefined;

    const [pluginId, id] = entityId.split('|');
    if (!pluginId || !id) return undefined;

    const position = getEntityPosition(this.store, pluginId, id);
    if (!position) return undefined;

    return { lat: position.latitude, lng: position.longitude, timestamp: position.timestamp };
  }

  /**
   * Calculate Jaccard similarity between two sets.
   */
  private calculateSetOverlap(set1: string[], set2: string[]): number {
    const s1 = new Set(set1);
    const s2 = new Set(set2);

    const intersection = new Set([...s1].filter((x) => s2.has(x)));
    const union = new Set([...s1, ...s2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Get common elements between two arrays.
   */
  private getCommonElements(arr1: string[], arr2: string[]): string[] {
    const set2 = new Set(arr2);
    return Array.from(new Set(arr1.filter((x) => set2.has(x))));
  }

  /**
   * Calculate alert severity alignment.
   */
  private calculateAlertSeverityAlignment(context1: EntityContext, context2: EntityContext): number {
    if (context1.recentAlerts.length === 0 || context2.recentAlerts.length === 0) {
      return 0;
    }

    const severityScore: Record<string, number> = { critical: 1, high: 0.75, medium: 0.5, low: 0.25 };
    const avg1 = context1.recentAlerts.reduce((sum, a) => sum + (severityScore[a.severity] || 0), 0) / context1.recentAlerts.length;
    const avg2 = context2.recentAlerts.reduce((sum, a) => sum + (severityScore[a.severity] || 0), 0) / context2.recentAlerts.length;

    return 1 - Math.min(1, Math.abs(avg1 - avg2) * 2);
  }

  /**
   * Calculate behavior pattern alignment.
   */
  private calculateBehaviorAlignment(behaviors1: any[], behaviors2: any[], timeWindow: number): number {
    if (behaviors1.length === 0 || behaviors2.length === 0) {
      return 0;
    }

    let alignmentCount = 0;

    for (const b1 of behaviors1) {
      for (const b2 of behaviors2) {
        if (Math.abs(b1.timestamp - b2.timestamp) <= timeWindow) {
          alignmentCount++;
        }
      }
    }

    return Math.min(1, (alignmentCount / Math.max(behaviors1.length, behaviors2.length)) * 0.5);
  }

  /**
   * Calculate behavior pattern similarity.
   */
  private calculateBehaviorSimilarity(behaviors1: any[], behaviors2: any[]): number {
    if (behaviors1.length === 0 || behaviors2.length === 0) {
      return 0;
    }

    const values1 = behaviors1.map((b) => b.value);
    const values2 = behaviors2.map((b) => b.value);

    const mean1 = values1.reduce((a, b) => a + b) / values1.length;
    const mean2 = values2.reduce((a, b) => a + b) / values2.length;

    const variance1 = values1.reduce((sum, v) => sum + Math.pow(v - mean1, 2), 0) / values1.length;
    const variance2 = values2.reduce((sum, v) => sum + Math.pow(v - mean2, 2), 0) / values2.length;

    const covariance = Math.min(values1.length, values2.length) > 0
      ? values1.slice(0, Math.min(values1.length, values2.length))
          .reduce((sum, v1, i) => sum + (v1 - mean1) * (values2[i] - mean2), 0) /
          Math.min(values1.length, values2.length)
      : 0;

    const correlation = Math.sqrt(variance1 * variance2) > 0 ? covariance / Math.sqrt(variance1 * variance2) : 0;

    return Math.max(0, (correlation + 1) / 2); // Normalize to 0-1
  }

  /**
   * Calculate haversine distance between two points.
   */
  private haversineDistance(loc1: { lat: number; lng: number }, loc2: { lat: number; lng: number }): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((loc2.lat - loc1.lat) * Math.PI) / 180;
    const dLng = ((loc2.lng - loc1.lng) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((loc1.lat * Math.PI) / 180) * Math.cos((loc2.lat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert correlation score to strength label.
   */
  private scoreToStrength(score: number): 'weak' | 'moderate' | 'strong' | 'very_strong' {
    if (score >= 0.85) return 'very_strong';
    if (score >= 0.7) return 'strong';
    if (score >= 0.55) return 'moderate';
    return 'weak';
  }

  /**
   * Get recommendation based on correlation analysis.
   */
  private getCorrelationRecommendation(score: number, context1: EntityContext, context2: EntityContext): string {
    if (score >= 0.85) {
      return `Critical correlation detected between ${context1.id} and ${context2.id}. Immediate investigation recommended.`;
    }
    if (score >= 0.7) {
      return `Strong correlation suggests coordinated activity. Monitor for escalation.`;
    }
    return `Moderate correlation detected. Consider in context of broader threat landscape.`;
  }
}
