/**
 * @file llmAgent.ts
 * @description LLM-enhanced semantic agent using OpenRouter Deepseek V4 flash.
 * Extends SemanticAgent with LLM-powered reasoning for better decision-making.
 */

import { SemanticAgent } from './agentReasoning';
import { LLMThreatInferenceEngine } from './llmThreatInference';
import { getOpenRouterClient } from '@/lib/openrouter/openrouterClient';
import { AgentContext, type RationalizedAction } from './agentContext';
import { SemanticStore } from './semanticStore';
import { OntologyGraph } from './ontologyGraph';
import type { AgentAction } from '@/lib/agent/bus';

/**
 * LLM-Enhanced Semantic Agent: uses Deepseek V4 flash for reasoning.
 */
export class LLMSemanticAgent extends SemanticAgent {
  private llmThreatEngine: LLMThreatInferenceEngine;
  private llmClient = getOpenRouterClient();

  constructor(
    userId: string,
    context: AgentContext,
    store: SemanticStore,
    tenantId?: string | null,
  ) {
    super(userId, context, store, tenantId);
    this.llmThreatEngine = new LLMThreatInferenceEngine(store);
  }

  /**
   * Enhanced ORIENT phase: use LLM for threat inference and hypothesis generation.
   */
  async orientWithLLM(): Promise<void> {
    const observations = this.context.getLatestObservation();
    if (!observations || observations.length === 0) return;

    // Step 1: Get LLM-enhanced threat assessments
    for (const entity of observations) {
      if (!entity.classification) continue;

      const threat = await this.llmThreatEngine.inferThreatWithLLM(
        entity.pluginId,
        entity.entityId,
        entity.latitude,
        entity.longitude,
      );

      this.context.recordThreat(threat);
    }

    // Step 2: Generate LLM-enhanced hypothesis
    const threats = this.context.getActivethreats();
    const anomalies = this.context.getAnomalies();

    if (threats.length > 0 || anomalies.length > 0) {
      const llmHypothesis = await this.llmThreatEngine.generateLLMHypothesis({
        observations: observations.map((e) => e.label || e.entityId),
        threats,
        anomalies,
      });

      this.context.addHypothesis(
        llmHypothesis.hypothesis,
        llmHypothesis.confidence,
        llmHypothesis.evidence,
      );
    }
  }

  /**
   * Enhanced DECIDE phase: use LLM for decision rationale.
   */
  async decideWithLLM(): Promise<RationalizedAction[]> {
    const decisions: RationalizedAction[] = [];
    const threats = this.context.getActivethreats();

    if (threats.length === 0) {
      return decisions;
    }

    // Build options for LLM to evaluate
    const options = [
      {
        action: 'alert_operators',
        pros: ['Fast notification', 'Human oversight'],
        cons: ['May cause false alarm', 'Operational load'],
      },
      {
        action: 'increase_monitoring',
        pros: ['Gathers more data', 'Low risk'],
        cons: ['May miss escalation', 'Resource intensive'],
      },
      {
        action: 'prepare_response',
        pros: ['Ready for escalation', 'Faster reaction time'],
        cons: ['Assumes threat is real', 'Deploys resources'],
      },
    ];

    // Get LLM recommendation
    const situation = `
${threats.length} active threats detected.
Critical threats: ${threats.filter((t) => t.threatLevel === 'critical').length}
Hypothesis: ${this.context.getTopHypothesis()?.hypothesis || 'Unknown'}
    `.trim();

    try {
      const recommendation = await this.llmClient.generateRationale({
        situation,
        threats: threats.map((t) => `${t.entityId} (${t.threatLevel})`),
        goal: 'Protect critical assets and minimize false alarms',
        options,
      });

      // Build decision based on LLM recommendation
      const action = this.buildLLMAction(
        recommendation.recommendation,
        threats[0],
      );

      const decision: RationalizedAction = {
        action: action.action,
        rationale: {
          goal: 'protect',
          observation: `${threats.length} threats detected`,
          inference: recommendation.rationale,
          decision: recommendation.recommendation,
          confidence: recommendation.confidence,
          factors: [
            {
              factor: 'llm_reasoning',
              weight: 0.8,
              contribution: recommendation.confidence,
            },
            {
              factor: 'threat_count',
              weight: 0.2,
              contribution: Math.min(1.0, threats.length / 10),
            },
          ],
          alternativesConsidered: options.map((o) => o.action),
          timestamp: Date.now(),
        },
      };

      decisions.push(decision);
    } catch (error) {
      console.warn('LLM decision generation failed:', error);
      // Fallback to rules-based decision
      const action = this.buildAction(threats[0].entityId, threats[0].threatLevel);
      const decision: RationalizedAction = {
        action: action.action,
        rationale: {
          goal: 'protect',
          observation: `${threats.length} threats detected`,
          inference: 'LLM decision failed, using rules-based fallback',
          decision: 'Alert operators',
          confidence: 0.7,
          factors: [
            {
              factor: 'threat_level',
              weight: 1.0,
              contribution: 0.7,
            },
          ],
          timestamp: Date.now(),
        },
      };

      decisions.push(decision);
    }

    return decisions;
  }

  /**
   * Enhanced cycle: use LLM for reasoning.
   */
  async cycleLLM(): Promise<{
    cycleTimeMs: number;
    decisionsCount: number;
    threatsDetected: number;
    llmTokens: number;
  }> {
    const startTime = Date.now();

    // Perceive (same as base)
    await this.perceive();

    // Orient (with LLM)
    await this.orientWithLLM();

    // Decide (with LLM)
    const decisions = await this.decideWithLLM();

    // Act (same as base)
    await this.act(decisions);

    // Prune old data
    this.context.prune(3600);

    const cycleTimeMs = Date.now() - startTime;
    const threats = this.context.getActivethreats();
    const llmStats = this.llmThreatEngine.getLLMStats();

    return {
      cycleTimeMs,
      decisionsCount: decisions.length,
      threatsDetected: threats.length,
      llmTokens: llmStats.totalTokens,
    };
  }

  /**
   * Build action based on LLM recommendation.
   */
  private buildLLMAction(
    recommendation: string,
    threat: { entityId: string; threatLevel: string },
  ): { action: AgentAction } {
    const pluginId = 'radar'; // Would be looked up in real implementation

    if (
      recommendation.includes('alert') ||
      recommendation.includes('notify')
    ) {
      return {
        action: {
          action: 'alert_created',
          alert: {
            id: `alert-${Date.now()}`,
            severity:
              threat.threatLevel === 'critical'
                ? 'critical'
                : threat.threatLevel === 'high'
                  ? 'warn'
                  : 'info',
            title: `LLM Analysis: ${threat.entityId}`,
            body: `LLM recommended immediate notification`,
            source: 'llm-agent',
            entityPluginId: pluginId,
            entityId: threat.entityId,
            createdAt: new Date().toISOString(),
          },
        },
      };
    } else if (recommendation.includes('monitor')) {
      return {
        action: {
          action: 'highlight_layer',
          pluginId,
        },
      };
    } else {
      return {
        action: {
          action: 'ping',
          ts: Date.now(),
        },
      };
    }
  }

  /**
   * Get LLM statistics.
   */
  getLLMStats() {
    return this.llmThreatEngine.getLLMStats();
  }
}
