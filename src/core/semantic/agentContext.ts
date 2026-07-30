/**
 * @file agentContext.ts
 * @description Agent reasoning context — stateful perception, orientation, and decision state.
 * Persists across perception → orientation → decision → action cycles.
 */

import type {
  EntityType,
  EntityDomain,
  Disposition,
  Confidence,
} from '@maven-system/plugin-sdk';
import type { QueryResultEntity, ThreatAssessmentResult } from './queryTypes';

/**
 * Threat intelligence data point.
 */
export interface ThreatIntelligence {
  entityPluginId: string;
  entityId: string;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  confidenceScore: Confidence;
  threatFactors: {
    disposition?: Confidence;
    proximity?: Confidence;
    capability?: Confidence;
    velocity?: Confidence; // How fast is it approaching?
    llmReasoning?: Confidence; // LLM assessment weight (llmThreatInference)
  };
  relatedThreats: Array<{ entityId: string; relationshipType: string }>;
  assessedAt: number;
  expiresAt?: number;
}

/**
 * Decision rationale — explains why an action was taken.
 */
export interface DecisionRationale {
  goal: string;
  observation: string; // What was observed?
  inference: string; // What was inferred?
  decision: string; // What was decided?
  confidence: Confidence;
  factors: Array<{ factor: string; weight: number; contribution: Confidence }>;
  alternativesConsidered?: string[];
  timestamp: number;
}

/**
 * Agent action with rationale.
 */
export interface RationalizedAction {
  action: any; // AgentAction from bus
  rationale: DecisionRationale;
  executedAt?: number;
  result?: { success: boolean; message?: string };
}

/**
 * Goal state for agent reasoning.
 */
export interface AgentGoal {
  id: string;
  type: 'protect' | 'monitor' | 'respond' | 'investigate' | 'custom';
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  constraints?: {
    maxResponseTime?: number; // milliseconds
    maxRiskTolerance?: Confidence;
    allowedActions?: string[];
  };
  createdAt: number;
  completedAt?: number;
}

/**
 * Agent reasoning context — persistent state across decision cycles.
 */
export class AgentContext {
  /** User ID this context belongs to */
  private userId: string;

  /** Tenant ID for multi-tenancy */
  private tenantId: string | null;

  /** Current active goals */
  private goals = new Map<string, AgentGoal>();

  /** Known threats (entity threat assessments) */
  private threatIntel = new Map<string, ThreatIntelligence>();

  /** Recent observations (what was perceived) */
  private observations: Array<{
    entities: QueryResultEntity[];
    timestamp: number;
  }> = [];

  /** Hypotheses formed during orientation */
  private hypotheses: Array<{
    hypothesis: string;
    confidence: Confidence;
    evidence: string[];
    timestamp: number;
  }> = [];

  /** Decision history (with reasoning) */
  private decisions: RationalizedAction[] = [];

  /** Anomalies detected */
  private anomalies: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    timestamp: number;
  }> = [];

  /** Entity relationships discovered */
  private discoveredRelationships: Array<{
    sourceId: string;
    targetId: string;
    relationshipType: string;
    confidence: Confidence;
    discovered: number;
  }> = [];

  /** When context was created */
  private createdAt: number;

  /** When context was last updated */
  private updatedAt: number;

  constructor(userId: string, tenantId?: string | null) {
    this.userId = userId;
    this.tenantId = tenantId ?? null;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  // ─── Goals ────────────────────────────────────────────────

  addGoal(goal: AgentGoal): void {
    this.goals.set(goal.id, goal);
    this.touch();
  }

  getGoals(priority?: AgentGoal['priority']): AgentGoal[] {
    const goals = Array.from(this.goals.values());
    if (priority) {
      return goals.filter((g) => g.priority === priority);
    }
    return goals;
  }

  completeGoal(goalId: string): void {
    const goal = this.goals.get(goalId);
    if (goal) {
      goal.completedAt = Date.now();
      this.touch();
    }
  }

  // ─── Threat Intelligence ──────────────────────────────────

  recordThreat(threat: ThreatIntelligence): void {
    const key = `${threat.entityPluginId}:${threat.entityId}`;
    this.threatIntel.set(key, threat);
    this.touch();
  }

  getThreat(pluginId: string, entityId: string): ThreatIntelligence | null {
    const key = `${pluginId}:${entityId}`;
    const threat = this.threatIntel.get(key);

    // Check if expired
    if (threat?.expiresAt && threat.expiresAt < Date.now()) {
      this.threatIntel.delete(key);
      return null;
    }

    return threat ?? null;
  }

  /**
   * Get all active threats sorted by threat level.
   */
  getActivethreats(): ThreatIntelligence[] {
    const threats: ThreatIntelligence[] = [];
    const now = Date.now();

    for (const threat of this.threatIntel.values()) {
      if (!threat.expiresAt || threat.expiresAt > now) {
        threats.push(threat);
      }
    }

    // Sort: critical → high → medium → low
    const threatOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    threats.sort((a, b) => threatOrder[a.threatLevel] - threatOrder[b.threatLevel]);

    return threats;
  }

  // ─── Observations ────────────────────────────────────────

  recordObservation(entities: QueryResultEntity[]): void {
    this.observations.push({
      entities,
      timestamp: Date.now(),
    });

    // Keep last 100 observations
    if (this.observations.length > 100) {
      this.observations.shift();
    }

    this.touch();
  }

  getLatestObservation(): QueryResultEntity[] | null {
    const latest = this.observations[this.observations.length - 1];
    return latest?.entities ?? null;
  }

  getObservationHistory(
    limitSeconds: number = 300,
  ): Array<{ entities: QueryResultEntity[]; timestamp: number }> {
    const cutoff = Date.now() - limitSeconds * 1000;
    return this.observations.filter((o) => o.timestamp > cutoff);
  }

  // ─── Hypotheses ───────────────────────────────────────────

  addHypothesis(
    hypothesis: string,
    confidence: Confidence,
    evidence: string[],
  ): void {
    this.hypotheses.push({
      hypothesis,
      confidence,
      evidence,
      timestamp: Date.now(),
    });

    // Keep last 50 hypotheses
    if (this.hypotheses.length > 50) {
      this.hypotheses.shift();
    }

    this.touch();
  }

  getHypotheses(): Array<{
    hypothesis: string;
    confidence: Confidence;
    evidence: string[];
    timestamp: number;
  }> {
    return this.hypotheses;
  }

  /**
   * Get most confident hypothesis.
   */
  getTopHypothesis():
    | {
      hypothesis: string;
      confidence: Confidence;
      evidence: string[];
      timestamp: number;
    }
    | null {
    if (this.hypotheses.length === 0) return null;
    return this.hypotheses.reduce((a, b) =>
      a.confidence > b.confidence ? a : b,
    );
  }

  // ─── Decisions ────────────────────────────────────────────

  recordDecision(action: RationalizedAction): void {
    this.decisions.push(action);

    // Keep last 200 decisions
    if (this.decisions.length > 200) {
      this.decisions.shift();
    }

    this.touch();
  }

  getDecisionHistory(limitCount: number = 20): RationalizedAction[] {
    return this.decisions.slice(-limitCount);
  }

  /**
   * Get decisions taken for a specific goal.
   */
  getDecisionsForGoal(goalId: string): RationalizedAction[] {
    return this.decisions.filter((d) => d.rationale.goal === goalId);
  }

  // ─── Anomalies ────────────────────────────────────────────

  recordAnomaly(
    type: string,
    description: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
  ): void {
    this.anomalies.push({
      type,
      description,
      severity,
      timestamp: Date.now(),
    });

    // Keep last 100 anomalies
    if (this.anomalies.length > 100) {
      this.anomalies.shift();
    }

    this.touch();
  }

  getAnomalies(severity?: string): typeof this.anomalies {
    if (severity) {
      return this.anomalies.filter((a) => a.severity === severity);
    }
    return this.anomalies;
  }

  // ─── Relationships ────────────────────────────────────────

  recordRelationship(
    sourceId: string,
    targetId: string,
    relationshipType: string,
    confidence: Confidence,
  ): void {
    // Check if already exists (update)
    const existing = this.discoveredRelationships.find(
      (r) =>
        r.sourceId === sourceId &&
        r.targetId === targetId &&
        r.relationshipType === relationshipType,
    );

    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.discovered = Date.now();
    } else {
      this.discoveredRelationships.push({
        sourceId,
        targetId,
        relationshipType,
        confidence,
        discovered: Date.now(),
      });
    }

    this.touch();
  }

  getRelationships(): typeof this.discoveredRelationships {
    return this.discoveredRelationships;
  }

  // ─── State Summary ────────────────────────────────────────

  /**
   * Get a summary of the current agent state.
   */
  getSummary(): {
    userId: string;
    tenantId: string | null;
    activeThreatCount: number;
    criticalThreats: number;
    activeGoals: number;
    recentDecisions: number;
    hypotheses: number;
    uptime: number;
  } {
    const threats = this.getActivethreats();
    const critical = threats.filter((t) => t.threatLevel === 'critical').length;

    return {
      userId: this.userId,
      tenantId: this.tenantId,
      activeThreatCount: threats.length,
      criticalThreats: critical,
      activeGoals: Array.from(this.goals.values()).filter((g) => !g.completedAt)
        .length,
      recentDecisions: this.decisions.length,
      hypotheses: this.hypotheses.length,
      uptime: Date.now() - this.createdAt,
    };
  }

  /**
   * Clear old data to prevent memory leaks.
   */
  prune(olderThanSeconds: number = 3600): void {
    const cutoff = Date.now() - olderThanSeconds * 1000;

    // Prune old observations
    this.observations = this.observations.filter((o) => o.timestamp > cutoff);

    // Prune expired threats
    for (const [key, threat] of this.threatIntel) {
      if (threat.expiresAt && threat.expiresAt < Date.now()) {
        this.threatIntel.delete(key);
      }
    }

    // Prune old hypotheses
    this.hypotheses = this.hypotheses.filter((h) => h.timestamp > cutoff);

    // Prune old decisions
    this.decisions = this.decisions.filter(
      (d) => d.executedAt && d.executedAt > cutoff,
    );

    this.touch();
  }

  // ─── Utilities ────────────────────────────────────────────

  private touch(): void {
    this.updatedAt = Date.now();
  }

  getCreatedAt(): number {
    return this.createdAt;
  }

  getUpdatedAt(): number {
    return this.updatedAt;
  }
}

/**
 * Global agent context store (per-user in multi-user deployments).
 * In production, use Redis or session store.
 */
const contextStore = new Map<string, AgentContext>();

export function getAgentContext(userId: string, tenantId?: string | null): AgentContext {
  const key = `${tenantId}:${userId}`;
  if (!contextStore.has(key)) {
    contextStore.set(key, new AgentContext(userId, tenantId));
  }
  return contextStore.get(key)!;
}

export function clearAgentContext(userId: string, tenantId?: string | null): void {
  const key = `${tenantId}:${userId}`;
  contextStore.delete(key);
}
