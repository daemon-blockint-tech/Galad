/**
 * @file threatInference.ts
 * @description Threat inference rules engine.
 * Computes threat scores based on entity classification, proximity, relationships, velocity.
 */

import type {
  EntityType,
  EntityDomain,
  Disposition,
  Confidence,
} from '@maven-system/plugin-sdk';
import type { ThreatIntelligence } from './agentContext';
import { SemanticStore } from './semanticStore';

/**
 * Threat scoring weights.
 */
const THREAT_WEIGHTS = {
  disposition: 0.4,
  proximity: 0.25,
  capability: 0.2,
  velocity: 0.15,
};

/**
 * Threat multipliers by entity type.
 */
const THREAT_MULTIPLIERS: Record<EntityType, number> = {
  'aircraft': 0.9,
  'maritime_vessel': 0.8,
  'person': 0.4,
  'organization': 1.0,
  'facility': 0.6,
  'event': 0.3,
  'network_node': 0.7,
  'geographic_region': 0.2,
  'weapon_system': 1.2,
  'sensor': 0.5,
  'communication_channel': 0.6,
  'satellite': 0.8,
  'vehicle': 0.7,
  'unknown': 0.5,
};

/**
 * Threat multipliers by domain.
 */
const DOMAIN_MULTIPLIERS: Record<EntityDomain, number> = {
  'air': 1.0,
  'maritime': 0.8,
  'land': 0.7,
  'cyber': 0.9,
  'space': 0.95,
  'subsurface': 0.85,
  'unknown': 0.6,
};

/**
 * Threat inference engine: rules-based threat scoring.
 */
export class ThreatInferenceEngine {
  protected store: SemanticStore;

  constructor(store: SemanticStore) {
    this.store = store;
  }

  /**
   * Infer threat level for an entity.
   */
  inferThreat(
    pluginId: string,
    entityId: string,
    referenceLatitude?: number,
    referenceLongitude?: number,
  ): ThreatIntelligence {
    const classification = this.store.getClassification(pluginId, entityId);

    if (!classification) {
      return {
        entityPluginId: pluginId,
        entityId,
        threatLevel: 'low',
        confidenceScore: 0.3,
        threatFactors: {},
        relatedThreats: [],
        assessedAt: Date.now(),
      };
    }

    // ─── Factor 1: Disposition Score ───────────────────────

    let dispositionScore = 0;
    if (classification.disposition === 'hostile') dispositionScore = 1.0;
    else if (classification.disposition === 'friend') dispositionScore = 0.0;
    else if (classification.disposition === 'neutral') dispositionScore = 0.3;
    else dispositionScore = 0.5; // unknown

    // ─── Factor 2: Capability Score ────────────────────────

    const typeMultiplier = THREAT_MULTIPLIERS[classification.type] || 0.5;
    const domainMultiplier = DOMAIN_MULTIPLIERS[classification.domain] || 0.6;
    const capabilityScore = Math.min(1.0, typeMultiplier * domainMultiplier);

    // ─── Factor 3: Proximity Score ─────────────────────────

    let proximityScore = 0.3; // default: unknown proximity
    if (referenceLatitude !== undefined && referenceLongitude !== undefined) {
      // Would need actual entity coordinates (not in current GeoEntity model)
      // For now, use heuristic based on related entities
      const relatedCount = this.store.getRelationshipsFrom(pluginId, entityId).length;
      proximityScore = Math.min(0.8, relatedCount * 0.1);
    }

    // ─── Factor 4: Velocity Score ──────────────────────────
    // Threat increases if moving toward reference point

    let velocityScore = 0;
    const speed = this.store.getProperty(pluginId, entityId, 'speed');
    if (speed?.value && typeof speed.value === 'number' && speed.value > 100) {
      // High speed = higher threat
      velocityScore = Math.min(1.0, (speed.value - 100) / 500);
    }

    // ─── Compute Combined Threat ────────────────────────────

    const combinedScore =
      dispositionScore * THREAT_WEIGHTS.disposition +
      capabilityScore * THREAT_WEIGHTS.capability +
      proximityScore * THREAT_WEIGHTS.proximity +
      velocityScore * THREAT_WEIGHTS.velocity;

    // ─── Determine Threat Level ────────────────────────────

    let threatLevel: 'low' | 'medium' | 'high' | 'critical';
    if (combinedScore >= 0.75) threatLevel = 'critical';
    else if (combinedScore >= 0.55) threatLevel = 'high';
    else if (combinedScore >= 0.35) threatLevel = 'medium';
    else threatLevel = 'low';

    // ─── Find Related Threats ──────────────────────────────

    const relatedThreats: Array<{ entityId: string; relationshipType: string }> = [];
    const relationships = this.store.getRelationshipsFrom(pluginId, entityId);

    for (const rel of relationships) {
      const [targetPId, targetEId] = rel.targetId.split(':');
      const targetCls = this.store.getClassification(targetPId, targetEId);

      if (targetCls?.disposition === 'hostile' || targetCls?.type === 'weapon_system') {
        relatedThreats.push({
          entityId: targetEId,
          relationshipType: rel.relationshipType,
        });
      }
    }

    // ─── Compute Confidence ────────────────────────────────

    const confidenceScore = classification.confidence;

    return {
      entityPluginId: pluginId,
      entityId,
      threatLevel,
      confidenceScore,
      threatFactors: {
        disposition: dispositionScore,
        proximity: proximityScore,
        capability: capabilityScore,
        velocity: velocityScore,
      },
      relatedThreats,
      assessedAt: Date.now(),
      expiresAt: Date.now() + 60000, // 1-minute TTL
    };
  }

  /**
   * Detect anomalies in entity behavior.
   */
  detectAnomalies(
    pluginId: string,
    entityId: string,
    historicalBehavior?: {
      avgSpeed?: number;
      avgProximity?: number;
      typicalRelationships?: string[];
    },
  ): Array<{ type: string; severity: 'low' | 'medium' | 'high'; reason: string }> {
    const anomalies: Array<{ type: string; severity: 'low' | 'medium' | 'high'; reason: string }> = [];

    const classification = this.store.getClassification(pluginId, entityId);
    if (!classification) return anomalies;

    // ─── Anomaly 1: Unexpected Disposition Change ──────────

    if (
      historicalBehavior &&
      classification.disposition !== 'unknown' &&
      classification.disposition !== 'neutral'
    ) {
      // If previously friendly, now hostile = anomaly
      anomalies.push({
        type: 'disposition_change',
        severity: 'high',
        reason: `Entity disposition changed to ${classification.disposition}`,
      });
    }

    // ─── Anomaly 2: Unusual Relationships ──────────────────

    const relationships = this.store.getRelationshipsFrom(pluginId, entityId);
    if (
      historicalBehavior?.typicalRelationships &&
      relationships.length > historicalBehavior.typicalRelationships.length * 2
    ) {
      anomalies.push({
        type: 'relationship_explosion',
        severity: 'medium',
        reason: `Unusual number of new relationships (${relationships.length})`,
      });
    }

    // ─── Anomaly 3: Speed Spike ────────────────────────────

    const speed = this.store.getProperty(pluginId, entityId, 'speed');
    if (
      speed?.value &&
      historicalBehavior?.avgSpeed &&
      (speed.value as number) > historicalBehavior.avgSpeed * 2
    ) {
      anomalies.push({
        type: 'speed_spike',
        severity: 'medium',
        reason: `Speed increased to ${speed.value} (avg: ${historicalBehavior.avgSpeed})`,
      });
    }

    return anomalies;
  }

  /**
   * Estimate threat escalation risk.
   */
  estimateEscalationRisk(threat: ThreatIntelligence): Confidence {
    // Risk increases with:
    // - hostile disposition
    // - proximity to friendly assets
    // - high velocity toward target
    // - related threats

    let risk = 0;

    if (threat.threatFactors.disposition === 1.0) risk += 0.3;
    if (threat.threatFactors.proximity && threat.threatFactors.proximity > 0.5) risk += 0.2;
    if (threat.threatFactors.velocity && threat.threatFactors.velocity > 0.5) risk += 0.2;
    if (threat.relatedThreats.length > 2) risk += 0.3;

    return Math.min(1.0, risk);
  }

  /**
   * Recommend response priority based on threats.
   */
  recommendPriority(threats: ThreatIntelligence[]): Array<{
    entityId: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    recommendedActions: string[];
  }> {
    const recommendations = threats
      .filter((t) => t.threatLevel !== 'low')
      .sort((a, b) => {
        const levelScore = { critical: 0, high: 1, medium: 2, low: 3 };
        return (levelScore[a.threatLevel] ?? 3) - (levelScore[b.threatLevel] ?? 3);
      })
      .map((threat) => {
        const escalationRisk = this.estimateEscalationRisk(threat);

        const recommendedActions: string[] = [];
        if (threat.threatLevel === 'critical') {
          recommendedActions.push('alert_operators');
          recommendedActions.push('highlight_entity');
          recommendedActions.push('track_continuously');
        } else if (threat.threatLevel === 'high') {
          recommendedActions.push('monitor_closely');
          recommendedActions.push('prepare_response');
        } else if (threat.threatLevel === 'medium') {
          recommendedActions.push('monitor_periodically');
        }

        if (escalationRisk > 0.7) {
          recommendedActions.push('request_backup');
        }

        return {
          entityId: threat.entityId,
          priority: threat.threatLevel,
          reason: `Threat level: ${threat.threatLevel}, Escalation risk: ${(escalationRisk * 100).toFixed(0)}%`,
          recommendedActions,
        };
      });

    return recommendations;
  }
}
