/**
 * @file agentReasoning.ts
 * @description Semantic agent reasoning loop: Perceive → Orient → Decide → Act
 * Orchestrates the full agent intelligence cycle.
 */

import type { Confidence } from '@maven-system/plugin-sdk';
import type { AgentAction } from '@/lib/agent/bus';
import { SemanticStore } from './semanticStore';
import { SemanticQueryEngine } from './queryEngine';
import { OntologyGraph } from './ontologyGraph';
import { ThreatInferenceEngine } from './threatInference';
import {
  AgentContext,
  type AgentGoal,
  type ThreatIntelligence,
  type DecisionRationale,
  type RationalizedAction,
} from './agentContext';
import type { QueryResultEntity } from './queryTypes';

/**
 * Semantic Agent: Perceive → Orient → Decide → Act reasoning loop.
 */
export class SemanticAgent {
  private store: SemanticStore;
  private queryEngine: SemanticQueryEngine;
  private graph: OntologyGraph;
  private threatEngine: ThreatInferenceEngine;
  protected context: AgentContext;

  private userId: string;
  private tenantId: string | null;

  constructor(
    userId: string,
    context: AgentContext,
    store: SemanticStore,
    tenantId?: string | null,
  ) {
    this.userId = userId;
    this.tenantId = tenantId ?? null;
    this.context = context;
    this.store = store;
    this.queryEngine = new SemanticQueryEngine(store);
    this.graph = new OntologyGraph(store);
    this.threatEngine = new ThreatInferenceEngine(store);
  }

  // ─── PERCEIVE: Observe the environment ────────────────────

  /**
   * Perceive phase: query entities matching current goals.
   */
  async perceive(): Promise<void> {
    const goals = this.context.getGoals();

    // Query entities based on active goals
    for (const goal of goals) {
      if (goal.completedAt) continue;

      // Goal-specific perception
      if (goal.type === 'protect') {
        // Look for threats
        const threats = await this.queryEngine.execute({
          type: 'find_by_type',
          entityTypes: ['aircraft', 'maritime_vessel', 'weapon_system'],
          disposition: 'hostile',
          limit: 50,
        });

        this.context.recordObservation(threats.entities);
      } else if (goal.type === 'monitor') {
        // Look for interesting entities
        const monitored = await this.queryEngine.execute({
          type: 'find_by_type',
          entityTypes: ['organization', 'person', 'facility'],
          limit: 100,
        });

        this.context.recordObservation(monitored.entities);
      } else if (goal.type === 'respond') {
        // Look for anomalies
        const anomalies = await this.queryEngine.execute({
          type: 'find_by_type',
          entityTypes: ['event'],
          limit: 20,
        });

        this.context.recordObservation(anomalies.entities);
      }
    }
  }

  // ─── ORIENT: Make sense of observations ────────────────────

  /**
   * Orient phase: classify threats, discover relationships, form hypotheses.
   */
  async orient(): Promise<void> {
    const observations = this.context.getLatestObservation();
    if (!observations || observations.length === 0) return;

    // ─── Step 1: Record Threats ────────────────────────────

    for (const entity of observations) {
      if (!entity.classification) continue;

      const threat = this.threatEngine.inferThreat(
        entity.pluginId,
        entity.entityId,
        entity.latitude,
        entity.longitude,
      );

      this.context.recordThreat(threat);

      // Detect anomalies
      const anomalies = this.threatEngine.detectAnomalies(
        entity.pluginId,
        entity.entityId,
      );

      for (const anomaly of anomalies) {
        this.context.recordAnomaly(
          anomaly.type,
          anomaly.reason,
          anomaly.severity,
        );
      }
    }

    // ─── Step 2: Discover Relationships ────────────────────

    for (const entity of observations) {
      const relationships = this.store.getRelationshipsFrom(
        entity.pluginId,
        entity.entityId,
      );

      for (const rel of relationships) {
        const [targetPId, targetEId] = rel.targetId.split(':');
        this.context.recordRelationship(
          entity.entityId,
          targetEId,
          rel.relationshipType,
          rel.confidence,
        );
      }
    }

    // ─── Step 3: Form Hypotheses ───────────────────────────

    const threats = this.context.getActivethreats();
    if (threats.length > 0) {
      const criticalCount = threats.filter((t) => t.threatLevel === 'critical')
        .length;

      if (criticalCount > 0) {
        this.context.addHypothesis(
          `There are ${criticalCount} critical threats requiring immediate response`,
          0.8,
          threats.map((t) => `${t.entityId} (${t.threatLevel})`),
        );
      }

      const coordinatedCount = threats.filter(
        (t) => t.relatedThreats.length > 0,
      ).length;

      if (coordinatedCount > 1) {
        this.context.addHypothesis(
          `Multiple coordinated threats detected (${coordinatedCount} entities with relationships)`,
          0.7,
          ['Related threats detected in graph'],
        );
      }
    }
  }

  // ─── DECIDE: Choose actions based on goals and situation ────

  /**
   * Decide phase: recommend actions based on threat assessment and goals.
   */
  async decide(): Promise<RationalizedAction[]> {
    const decisions: RationalizedAction[] = [];

    // Get priorities
    const threats = this.context.getActivethreats();
    const priorities = this.threatEngine.recommendPriority(threats);
    const hypothesis = this.context.getTopHypothesis();

    // Make decisions
    for (const priority of priorities) {
      const action = this.buildAction(priority.entityId, priority.priority);

      const rationale: DecisionRationale = {
        goal: 'protect',
        observation: `Threat detected: ${priority.entityId}`,
        inference: priority.reason,
        decision: action.action ? JSON.stringify(action.action) : 'UNKNOWN',
        confidence: 0.9,
        factors: [
          {
            factor: 'threat_level',
            weight: 0.6,
            contribution: this.threatLevelToScore(priority.priority),
          },
          {
            factor: 'recommended_actions',
            weight: 0.4,
            contribution: priority.recommendedActions.length > 0 ? 1.0 : 0.5,
          },
        ],
        alternativesConsidered: ['escalate_to_human', 'continue_monitoring'],
        timestamp: Date.now(),
      };

      decisions.push({
        action: action.action,
        rationale,
      });
    }

    // Add hypothesis-driven decisions
    if (hypothesis && hypothesis.confidence > 0.7) {
      decisions.push({
        action: {
          action: 'task_created',
          task: {
            id: `task-${Date.now()}`,
            title: hypothesis.hypothesis,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        rationale: {
          goal: hypothesis.hypothesis,
          observation: 'Multiple threat indicators',
          inference: hypothesis.hypothesis,
          decision: 'Create investigation task',
          confidence: hypothesis.confidence,
          factors: hypothesis.evidence.map((e, i) => ({
            factor: `evidence_${i}`,
            weight: 1 / hypothesis.evidence.length,
            contribution: hypothesis.confidence,
          })),
          timestamp: Date.now(),
        },
      });
    }

    return decisions;
  }

  // ─── ACT: Execute decisions ────────────────────────────────

  /**
   * Act phase: execute approved actions and record decisions.
   */
  async act(decisions: RationalizedAction[]): Promise<void> {
    for (const decision of decisions) {
      // Record decision (could integrate with agent bus here)
      decision.executedAt = Date.now();
      decision.result = { success: true, message: 'Decision recorded' };

      this.context.recordDecision(decision);
    }
  }

  // ─── FULL CYCLE ────────────────────────────────────────────

  /**
   * Execute one complete reasoning cycle.
   */
  async cycle(): Promise<{
    cycleTimeMs: number;
    decisionsCount: number;
    threatsDetected: number;
  }> {
    const startTime = performance.now();

    // Perceive
    await this.perceive();

    // Orient
    await this.orient();

    // Decide
    const decisions = await this.decide();

    // Act
    await this.act(decisions);

    // Prune old data
    this.context.prune(3600);

    const cycleTimeMs = performance.now() - startTime;
    const threats = this.context.getActivethreats();

    return {
      cycleTimeMs,
      decisionsCount: decisions.length,
      threatsDetected: threats.length,
    };
  }

  // ─── CONTINUOUS OPERATION ────────────────────────────────

  /**
   * Run reasoning loop continuously (for background agents).
   */
  async runContinuous(
    interval: number = 5000,
    maxCycles?: number,
  ): Promise<void> {
    let cycleCount = 0;

    while (!maxCycles || cycleCount < maxCycles) {
      try {
        const result = await this.cycle();
        console.log(
          `[Agent ${this.userId}] Cycle ${cycleCount}: ${result.decisionsCount} decisions, ${result.threatsDetected} threats`,
        );
        cycleCount++;
      } catch (error) {
        console.error(`[Agent ${this.userId}] Error in cycle:`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────

  /**
   * Build action for a threat entity.
   */
  protected buildAction(
    entityId: string,
    priority: 'low' | 'medium' | 'high' | 'critical',
  ): { action: AgentAction } {
    // Find which plugin owns this entity
    // In real implementation, would query entity store
    const pluginId = 'radar'; // Default, would be looked up

    if (priority === 'critical') {
      return {
        action: {
          action: 'alert_created',
          alert: {
            id: `alert-${Date.now()}`,
            severity: 'critical',
            title: `Critical threat: ${entityId}`,
            body: `Threat entity ${entityId} requires immediate attention`,
            source: 'semantic-agent',
            entityPluginId: pluginId,
            entityId,
            createdAt: new Date().toISOString(),
          },
        },
      };
    } else if (priority === 'high') {
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

  private threatLevelToScore(level: string): Confidence {
    switch (level) {
      case 'critical':
        return 1.0;
      case 'high':
        return 0.75;
      case 'medium':
        return 0.5;
      case 'low':
        return 0.25;
      default:
        return 0.5;
    }
  }

  // ─── STATUS & DIAGNOSTICS ────────────────────────────────

  getStatus(): {
    userId: string;
    context: ReturnType<AgentContext['getSummary']>;
    lastActivity: number;
  } {
    return {
      userId: this.userId,
      context: this.context.getSummary(),
      lastActivity: this.context.getUpdatedAt(),
    };
  }
}
