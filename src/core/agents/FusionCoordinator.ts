/**
 * @file FusionCoordinator.ts
 * @description Orchestrates multiple agents to validate and refine entity fusions.
 * Implements collaborative validation workflow.
 */

import { FusionEngine, type FusionProposal } from '@/core/fusion';
import { SemanticStore } from '@/core/semantic/semanticStore';
import { ConfidenceScorer } from '@/core/fusion/ConfidenceScoring';

export interface FusionScenario {
  candidateFusions: FusionProposal[];
  sourceCredibilities: Map<string, number>;
  correlationContext: any[];
  timestamp: number;
}

export interface ValidationResult {
  fusion: FusionProposal;
  isValid: boolean;
  confidence: number;
  rationale: string;
  risks: string[];
}

export interface SourceCredibilityAssessment {
  sourceId: string;
  trustScore: number;
  historicalAccuracy: number;
  rationale: string;
}

export interface AnomalyDetectionResult {
  fusionId: string;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  description: string;
  indicators: string[];
}

export class FusionCoordinator {
  private fusionEngine: FusionEngine;
  private store: SemanticStore;
  private scorer: ConfidenceScorer;
  private sourceCredibilityCache: Map<string, SourceCredibilityAssessment> = new Map();

  constructor(fusionEngine: FusionEngine, store: SemanticStore) {
    this.fusionEngine = fusionEngine;
    this.store = store;
    this.scorer = new ConfidenceScorer();
    this.initializeSourceCredibility();
  }

  private initializeSourceCredibility(): void {
    // Initialize credibility assessments for known sources
    const sources = ['radar', 'adsb', 'osint', 'threat-intel', 'satellite'];
    const credibilityMap: Record<string, number> = {
      radar: 0.9,
      adsb: 0.95,
      osint: 0.6,
      'threat-intel': 0.7,
      satellite: 0.85,
    };

    for (const source of sources) {
      this.sourceCredibilityCache.set(source, {
        sourceId: source,
        trustScore: credibilityMap[source] || 0.7,
        historicalAccuracy: Math.random() * 0.3 + 0.65, // Mock historical accuracy
        rationale: `Source credibility for ${source}`,
      });
    }
  }

  /**
   * Orchestrate fusion validation with multiple agents.
   */
  async orchestrateFusion(scenario: FusionScenario): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Step 1: Assess source credibility
    const credibilityAssessments = await this.assessSourceCredibility(
      scenario.candidateFusions,
    );

    // Step 2: Validate each fusion
    for (const fusion of scenario.candidateFusions) {
      const validation = await this.validateFusion(fusion, credibilityAssessments);
      results.push(validation);
    }

    // Step 3: Detect anomalies
    const anomalies = await this.detectAnomalies(results);

    // Step 4: Synthesize decisions with anomaly context
    return results.map((result) => {
      // Anomaly fusionIds are entity ids ("pluginId|entityId") — see detectAnomalies.
      const anomaly = anomalies.find(
        (a) => a.fusionId === result.fusion.id1 || a.fusionId === result.fusion.id2,
      );
      if (anomaly && anomaly.severity !== 'none') {
        result.isValid = false;
        result.risks.push(`Anomaly detected: ${anomaly.description}`);
        result.confidence = Math.max(0, result.confidence - 0.2);
      }
      return result;
    });
  }

  /**
   * Assess credibility of data sources.
   */
  private async assessSourceCredibility(
    fusions: FusionProposal[],
  ): Promise<Map<string, SourceCredibilityAssessment>> {
    const assessment = new Map<string, SourceCredibilityAssessment>();

    const sourceIds = new Set<string>();
    for (const fusion of fusions) {
      sourceIds.add(fusion.pluginId1);
      sourceIds.add(fusion.pluginId2);
    }

    for (const sourceId of sourceIds) {
      const cached = this.sourceCredibilityCache.get(sourceId);
      if (cached) {
        assessment.set(sourceId, cached);
      } else {
        // Default assessment for unknown sources
        assessment.set(sourceId, {
          sourceId,
          trustScore: 0.5,
          historicalAccuracy: 0.5,
          rationale: `Unknown source: ${sourceId}`,
        });
      }
    }

    return assessment;
  }

  /**
   * Validate a single fusion proposal.
   */
  private async validateFusion(
    fusion: FusionProposal,
    credibilityAssessments: Map<string, SourceCredibilityAssessment>,
  ): Promise<ValidationResult> {
    // Check basic properties
    const cred1 = credibilityAssessments.get(fusion.pluginId1);
    const cred2 = credibilityAssessments.get(fusion.pluginId2);

    if (!cred1 || !cred2) {
      return {
        fusion,
        isValid: false,
        confidence: 0,
        rationale: 'Unknown sources',
        risks: ['Source credibility unknown'],
      };
    }

    // Validate fusion score
    if (fusion.score < 0.7) {
      return {
        fusion,
        isValid: false,
        confidence: fusion.score,
        rationale: 'Score below minimum threshold',
        risks: ['Low confidence score'],
      };
    }

    // Validate source agreement
    const sourceAgreement = Math.min(cred1.trustScore, cred2.trustScore);
    const adjustedConfidence = fusion.score * sourceAgreement;

    // Check for contradictory data
    const hasContradictions = await this.checkContradictions(fusion);

    return {
      fusion,
      isValid: !hasContradictions && adjustedConfidence > 0.65,
      confidence: adjustedConfidence,
      rationale: `Fusion validated with ${(adjustedConfidence * 100).toFixed(0)}% confidence`,
      risks: hasContradictions ? ['Potential data contradictions'] : [],
    };
  }

  /**
   * Check for contradictions in proposed fusion.
   */
  private async checkContradictions(fusion: FusionProposal): Promise<boolean> {
    // Check if entities have conflicting properties
    const entity1 = this.store.getEntity?.(fusion.pluginId1, fusion.entityId1);
    const entity2 = this.store.getEntity?.(fusion.pluginId2, fusion.entityId2);

    if (!entity1 || !entity2) return false;

    // Check heading conflict (if both have heading, must be within 30°)
    if (entity1.heading !== undefined && entity2.heading !== undefined) {
      const headingDiff = Math.abs(entity1.heading - entity2.heading);
      if (headingDiff > 30 && headingDiff < 330) {
        return true; // Significant heading mismatch
      }
    }

    // Check type conflict
    const class1 = this.store.getClassification?.(fusion.pluginId1, fusion.entityId1);
    const class2 = this.store.getClassification?.(fusion.pluginId2, fusion.entityId2);

    if (class1?.type && class2?.type && class1.type !== class2.type) {
      return true; // Type mismatch
    }

    return false;
  }

  /**
   * Detect anomalies in proposed fusions.
   */
  private async detectAnomalies(
    validations: ValidationResult[],
  ): Promise<AnomalyDetectionResult[]> {
    const anomalies: AnomalyDetectionResult[] = [];

    // Check for clustering anomalies (multiple fusions involving same entity)
    const entityFusionCount = new Map<string, number>();
    for (const validation of validations) {
      const id1 = `${validation.fusion.pluginId1}|${validation.fusion.entityId1}`;
      const id2 = `${validation.fusion.pluginId2}|${validation.fusion.entityId2}`;

      entityFusionCount.set(id1, (entityFusionCount.get(id1) ?? 0) + 1);
      entityFusionCount.set(id2, (entityFusionCount.get(id2) ?? 0) + 1);
    }

    for (const [entityId, count] of entityFusionCount) {
      if (count > 5) {
        anomalies.push({
          fusionId: entityId,
          severity: 'high',
          description: `Entity involved in ${count} fusion proposals (unusual clustering)`,
          indicators: ['high_fusion_degree'],
        });
      }
    }

    // Check for source mismatches
    for (const validation of validations) {
      if (validation.fusion.score < 0.6) {
        anomalies.push({
          fusionId: `${validation.fusion.id1}-${validation.fusion.id2}`,
          severity: 'medium',
          description: 'Low confidence fusion proposal',
          indicators: ['low_score'],
        });
      }
    }

    return anomalies;
  }

  /**
   * Get source credibility assessment.
   */
  getSourceCredibility(sourceId: string): SourceCredibilityAssessment | null {
    return this.sourceCredibilityCache.get(sourceId) ?? null;
  }

  /**
   * Update source credibility based on feedback.
   */
  updateSourceCredibility(sourceId: string, feedback: { isCorrect: boolean; confidence: number }): void {
    const current = this.sourceCredibilityCache.get(sourceId);
    if (!current) return;

    // Adjust trust score based on feedback
    const adjustment = feedback.isCorrect ? 0.05 : -0.1;
    const newTrust = Math.max(0, Math.min(1, current.trustScore + adjustment));

    this.sourceCredibilityCache.set(sourceId, {
      ...current,
      trustScore: newTrust,
      historicalAccuracy: (current.historicalAccuracy + newTrust) / 2,
    });
  }
}
