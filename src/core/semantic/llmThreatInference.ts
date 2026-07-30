/**
 * @file llmThreatInference.ts
 * @description LLM-enhanced threat inference using OpenRouter Deepseek V4 flash.
 * Combines rules-based scoring with LLM reasoning for sophisticated threat assessment.
 */

import { ThreatInferenceEngine } from './threatInference';
import { getOpenRouterClient } from '@/lib/openrouter/openrouterClient';
import type { ThreatIntelligence } from './agentContext';

/**
 * LLM-enhanced threat inference combining rules + LLM reasoning.
 */
export class LLMThreatInferenceEngine extends ThreatInferenceEngine {
  private llmClient = getOpenRouterClient();

  /**
   * Enhanced threat inference: rules + LLM reasoning.
   */
  async inferThreatWithLLM(
    pluginId: string,
    entityId: string,
    referenceLatitude?: number,
    referenceLongitude?: number,
  ): Promise<ThreatIntelligence> {
    // Step 1: Get rules-based threat (fast)
    const rulesThreat = this.inferThreat(
      pluginId,
      entityId,
      referenceLatitude,
      referenceLongitude,
    );

    // Step 2: Get LLM reasoning (async)
    const classification = this.store.getClassification(pluginId, entityId);
    if (!classification) {
      return rulesThreat;
    }

    try {
      const relatedEntities = this.store
        .getRelationshipsFrom(pluginId, entityId)
        .slice(0, 5)
        .map((r) => r.targetId);

      const llmAssessment = await this.llmClient.assessThreatWithLLM({
        entityId,
        entityType: classification.type,
        disposition: classification.disposition || 'unknown',
        proximity: rulesThreat.threatFactors.proximity,
        relatedEntities,
        recentActivity: classification.disposition ? 'Active' : 'Unknown',
      });

      // Step 3: Blend rules + LLM assessments
      // LLM confidence increases threat weight
      const llmWeightFactor = llmAssessment.confidence;

      // Convert LLM threat level to score
      const llmScores = {
        low: 0.2,
        medium: 0.5,
        high: 0.75,
        critical: 0.95,
      };
      const llmScore = llmScores[llmAssessment.threatLevel];

      // Blend: 60% rules + 40% LLM
      const combinedScore =
        rulesThreat.threatFactors.disposition! * 0.6 + llmScore * 0.4;

      // Determine final threat level
      let finalThreatLevel: 'low' | 'medium' | 'high' | 'critical';
      if (combinedScore >= 0.8) finalThreatLevel = 'critical';
      else if (combinedScore >= 0.6) finalThreatLevel = 'high';
      else if (combinedScore >= 0.4) finalThreatLevel = 'medium';
      else finalThreatLevel = 'low';

      // Return enhanced threat with LLM reasoning
      return {
        ...rulesThreat,
        threatLevel: finalThreatLevel,
        confidenceScore: Math.max(
          rulesThreat.confidenceScore,
          llmAssessment.confidence,
        ),
        threatFactors: {
          ...rulesThreat.threatFactors,
          // Add LLM reasoning as a factor
          llmReasoning: llmWeightFactor,
        },
      };
    } catch (error) {
      console.warn('LLM threat inference failed, using rules-based:', error);
      return rulesThreat;
    }
  }

  /**
   * Generate LLM-enhanced hypothesis.
   */
  async generateLLMHypothesis(context: {
    observations: string[];
    threats: ThreatIntelligence[];
    anomalies: Array<{ type: string; description: string }>;
  }): Promise<{
    hypothesis: string;
    evidence: string[];
    confidence: number;
    suggestedActions: string[];
  }> {
    const threatSummary = context.threats.map(
      (t) => `${t.entityId} (${t.threatLevel})`,
    );
    const anomalySummary = context.anomalies.map((a) => a.description);

    try {
      const result = await this.llmClient.generateHypothesis({
        observations: context.observations,
        threats: context.threats.map((t) => ({
          entityId: t.entityId,
          threatLevel: t.threatLevel,
        })),
        anomalies: anomalySummary,
      });

      return result;
    } catch (error) {
      console.warn('LLM hypothesis generation failed:', error);
      return {
        hypothesis: 'Multiple threats detected requiring investigation',
        evidence: threatSummary,
        confidence: 0.5,
        suggestedActions: ['increase_monitoring', 'prepare_response'],
      };
    }
  }

  /**
   * Get LLM usage statistics.
   */
  getLLMStats() {
    return this.llmClient.getStats();
  }
}
