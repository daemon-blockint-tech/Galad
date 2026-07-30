/**
 * @file FusionEngine.ts
 * @description Main orchestrator for entity fusion and deduplication.
 * Detects, validates, and merges entities across multiple sources.
 */

import { prisma } from '@/lib/db';
import { SemanticStore, getGlobalSemanticStore } from '@/core/semantic/semanticStore';
import {
  DeduplicationStrategy,
  Entity,
  FusionCandidate,
  ScoringResult,
  SpatialProximityStrategy,
  SemanticNameStrategy,
  TemporalCoherenceStrategy,
} from './DeduplicationStrategy';
import { ConfidenceScorer, StrategyScore } from './ConfidenceScoring';

export interface FusionProposal extends FusionCandidate {
  strategyBreakdown: StrategyScore[];
}

export interface FusionDecision {
  fusionId: string;
  proposal: FusionProposal;
  decision: 'accepted' | 'rejected' | 'pending';
  validatedBy?: string;
  validatedAt?: Date;
  notes?: string;
}

export class FusionEngine {
  private strategies: DeduplicationStrategy[] = [];
  private scorer = new ConfidenceScorer();
  private store: SemanticStore;
  private tenantId?: string | null;
  private fusionThreshold = 0.75;

  constructor(store: SemanticStore, tenantId?: string | null) {
    this.store = store;
    this.tenantId = tenantId;

    // Initialize default strategies
    this.strategies.push(new SpatialProximityStrategy());
    this.strategies.push(new SemanticNameStrategy());
    this.strategies.push(new TemporalCoherenceStrategy());

    // Configure default source credibility
    this.scorer.registerSource('radar', 0.9);
    this.scorer.registerSource('adsb', 0.95);
    this.scorer.registerSource('osint', 0.6);
    this.scorer.registerSource('threat-intel', 0.7);
  }

  /**
   * Detect fusion candidates from all entities in the store.
   */
  async detectFusions(): Promise<FusionProposal[]> {
    const entities = this.getAllEntities();
    const candidates: FusionProposal[] = [];

    // O(n²) comparison - acceptable for < 10k entities
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const e1 = entities[i];
        const e2 = entities[j];

        // Skip same source
        if (e1.pluginId === e2.pluginId && e1.entityId === e2.entityId) {
          continue;
        }

        const proposal = await this.evaluateCandidate(e1, e2);
        if (proposal && this.scorer.shouldFuse(proposal.score, this.fusionThreshold)) {
          candidates.push(proposal);
        }
      }
    }

    // Sort by score descending
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Evaluate a pair of entities as fusion candidates.
   */
  private async evaluateCandidate(
    entity1: Entity,
    entity2: Entity,
  ): Promise<FusionProposal | null> {
    const strategyScores: StrategyScore[] = [];
    const reasons: string[] = [];

    // Score with each strategy
    for (const strategy of this.strategies) {
      try {
        const result = await strategy.score(entity1, entity2);

        // Use the highest score from this strategy's components
        const maxScore = Math.max(
          result.spatialScore,
          result.semanticScore,
          result.temporalScore,
        );

        if (maxScore > 0.1) {
          // Only include if meaningful
          strategyScores.push({
            strategyName: strategy.name,
            score: maxScore,
            weight: this.getStrategyWeight(strategy.name),
            reasoning: this.getStrategyReasoning(strategy.name, result),
          });

          if (maxScore > 0.5) {
            reasons.push(strategy.name);
          }
        }
      } catch (error) {
        console.error(`Error scoring with ${strategy.name}:`, error);
      }
    }

    if (strategyScores.length === 0) {
      return null;
    }

    // Blend scores
    const blended = this.scorer.blendScores(strategyScores);

    // Apply source credibility adjustment
    const adjustedScore = this.scorer.adjustForSourceCredibility(
      blended.overallScore,
      entity1.pluginId,
      entity2.pluginId,
    );

    return {
      id1: `${entity1.pluginId}|${entity1.entityId}`,
      id2: `${entity2.pluginId}|${entity2.entityId}`,
      pluginId1: entity1.pluginId,
      entityId1: entity1.entityId,
      pluginId2: entity2.pluginId,
      entityId2: entity2.entityId,
      score: adjustedScore,
      reasons:
        reasons.length > 0
          ? reasons
          : blended.reasoning.map((r) => r.split(':')[0]),
      metadata: {
        strategyBreakdown: blended.weightedBreakdown,
        confidenceInterval: this.scorer.confidenceInterval(adjustedScore, strategyScores.length),
      },
      strategyBreakdown: strategyScores,
    };
  }

  /**
   * Accept a fusion proposal and merge entities.
   */
  async acceptFusion(
    proposal: FusionProposal,
    validatedBy?: string,
    notes?: string,
  ): Promise<string> {
    // Determine canonical entity (higher confidence or newer timestamp)
    const [canonicalId, absorbedId] = await this.resolveCanonical(
      proposal.pluginId1,
      proposal.entityId1,
      proposal.pluginId2,
      proposal.entityId2,
    );

    const [canonicalPluginId, canonicalEntityId] = canonicalId.split('|');
    const [absorbedPluginId, absorbedEntityId] = absorbedId.split('|');

    // Create fusion record in DB
    const fusion = await prisma.entityFusion.create({
      data: {
        tenantId: this.tenantId,
        canonicalPluginId,
        canonicalEntityId,
        fusedPluginIds: JSON.stringify([absorbedPluginId]),
        fusedEntityIds: JSON.stringify([absorbedEntityId]),
        fusionScore: proposal.score,
        fusionReasons: JSON.stringify(proposal.reasons),
        fusionStrategy: this.strategies[0].name,
        validatedBy,
        validatedAt: validatedBy ? new Date() : null,
        validationNotes: notes,
      },
    });

    // Log fusion event
    await prisma.fusionEvent.create({
      data: {
        tenantId: this.tenantId,
        fusionId: fusion.id,
        eventType: 'merge_accepted',
        confidence: proposal.score,
        reasoning: JSON.stringify(proposal.metadata),
        actorUserId: validatedBy,
        actorAction: 'accepted',
        actorNotes: notes,
      },
    });

    // Update semantic store (merge relationships and properties)
    this.mergeEntities(canonicalPluginId, canonicalEntityId, absorbedPluginId, absorbedEntityId);

    // Update provenance
    await prisma.entityProvenance.upsert({
      where: {
        tenantId_entityPluginId_entityId: {
          tenantId: this.tenantId,
          entityPluginId: canonicalPluginId,
          entityId: canonicalEntityId,
        },
      },
      create: {
        tenantId: this.tenantId,
        entityPluginId: canonicalPluginId,
        entityId: canonicalEntityId,
        sourcePluginId: canonicalPluginId,
        sourceTimestamp: new Date(),
        fusedFromPluginIds: JSON.stringify([absorbedPluginId]),
        fusedFromEntityIds: JSON.stringify([absorbedEntityId]),
      },
      update: {
        fusedFromPluginIds: JSON.stringify([absorbedPluginId]),
        fusedFromEntityIds: JSON.stringify([absorbedEntityId]),
        updatedAt: new Date(),
      },
    });

    return fusion.id;
  }

  /**
   * Reject a fusion proposal.
   */
  async rejectFusion(
    pluginId1: string,
    entityId1: string,
    pluginId2: string,
    entityId2: string,
    rejectedBy?: string,
    notes?: string,
  ): Promise<void> {
    // Record rejection event for analytics
    // (no DB record created, just logging)
    console.log(
      `Fusion rejected: ${pluginId1}|${entityId1} <-> ${pluginId2}|${entityId2} by ${rejectedBy}: ${notes}`,
    );
  }

  /**
   * Get pending (unapproved) fusions.
   */
  async getPendingFusions(limit: number = 100): Promise<FusionDecision[]> {
    const fusions = await prisma.entityFusion.findMany({
      where: {
        tenantId: this.tenantId,
        validatedAt: null,
      },
      take: limit,
      orderBy: { fusionScore: 'desc' },
      include: { fusionEvents: true },
    });

    return fusions.map((f) => ({
      fusionId: f.id,
      proposal: {
        id1: `${f.canonicalPluginId}|${f.canonicalEntityId}`,
        id2: '', // Absorbed ID not in schema directly
        pluginId1: f.canonicalPluginId,
        entityId1: f.canonicalEntityId,
        pluginId2: '',
        entityId2: '',
        score: f.fusionScore,
        reasons: f.fusionReasons ? JSON.parse(f.fusionReasons) : [],
        metadata: {},
        strategyBreakdown: [],
      },
      decision: 'pending',
    }));
  }

  /**
   * Merge entities in semantic store.
   */
  private mergeEntities(
    canonicalPluginId: string,
    canonicalEntityId: string,
    absorbedPluginId: string,
    absorbedEntityId: string,
  ): void {
    // Copy relationships from absorbed to canonical
    const relationships = this.store.getRelationshipsFrom(absorbedPluginId, absorbedEntityId);
    for (const rel of relationships) {
      this.store.addRelationship(
        canonicalPluginId,
        canonicalEntityId,
        rel.targetPluginId,
        rel.targetEntityId,
        rel.relationshipType,
        Math.min(rel.confidence, 0.95), // Reduce confidence slightly for merged relationships
      );
    }

    // Create relationship between canonical and absorbed entities
    this.store.addRelationship(
      canonicalPluginId,
      canonicalEntityId,
      absorbedPluginId,
      absorbedEntityId,
      'fused_with',
      0.95,
    );
  }

  /**
   * Determine which entity is canonical (should survive the merge).
   */
  private async resolveCanonical(
    pluginId1: string,
    entityId1: string,
    pluginId2: string,
    entityId2: string,
  ): Promise<[string, string]> {
    // Prefer higher credibility source
    const cred1 = this.scorer.getSourceWeight(pluginId1);
    const cred2 = this.scorer.getSourceWeight(pluginId2);

    if (cred1 > cred2) {
      return [`${pluginId1}|${entityId1}`, `${pluginId2}|${entityId2}`];
    } else if (cred2 > cred1) {
      return [`${pluginId2}|${entityId2}`, `${pluginId1}|${entityId1}`];
    }

    // Tiebreaker: use entity with newer timestamp
    const e1 = this.store.getEntity(pluginId1, entityId1);
    const e2 = this.store.getEntity(pluginId2, entityId2);

    const ts1 = e1?.timestamp ?? 0;
    const ts2 = e2?.timestamp ?? 0;

    return ts1 >= ts2
      ? [`${pluginId1}|${entityId1}`, `${pluginId2}|${entityId2}`]
      : [`${pluginId2}|${entityId2}`, `${pluginId1}|${entityId1}`];
  }

  /**
   * Set fusion threshold (0-1).
   */
  setFusionThreshold(threshold: number): void {
    this.fusionThreshold = Math.max(0.5, Math.min(1, threshold));
  }

  private getStrategyWeight(strategyName: string): number {
    // Weights can be tuned per strategy
    switch (strategyName) {
      case 'spatial_proximity':
        return 0.5;
      case 'semantic_name':
        return 0.3;
      case 'temporal_coherence':
        return 0.2;
      default:
        return 0.33;
    }
  }

  private getStrategyReasoning(
    strategyName: string,
    result: ScoringResult,
  ): string {
    if (result.spatialScore > 0) {
      return `spatial distance score: ${result.spatialScore.toFixed(2)}`;
    }
    if (result.semanticScore > 0) {
      return `name similarity: ${result.semanticScore.toFixed(2)}`;
    }
    if (result.temporalScore > 0) {
      return `temporal coherence: ${result.temporalScore.toFixed(2)}`;
    }
    return '';
  }

  private getAllEntities(): Entity[] {
    // Entities live in the store's cache; classification (type/disposition)
    // is stored separately and the strategies need it.
    return this.store.getAllEntities().map((e) => {
      const cls = this.store.getClassification(e.pluginId, e.entityId);
      return {
        id: `${e.pluginId}|${e.entityId}`,
        ...e,
        type: e.type ?? cls?.type,
        disposition: e.disposition ?? cls?.disposition,
      };
    });
  }
}
