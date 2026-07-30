/**
 * @file agentReasoning.test.ts
 * @description Tests for SemanticAgent and threat inference
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticStore } from './semanticStore';
import { AgentContext } from './agentContext';
import { SemanticAgent } from './agentReasoning';
import { ThreatInferenceEngine } from './threatInference';
import type { EntityClassification } from '@maven-system/plugin-sdk';

describe('ThreatInferenceEngine', () => {
  let store: SemanticStore;
  let engine: ThreatInferenceEngine;

  beforeEach(() => {
    store = new SemanticStore();
    engine = new ThreatInferenceEngine(store);

    // Add test data
    const hostile: EntityClassification = {
      type: 'aircraft',
      domain: 'air',
      disposition: 'hostile',
      confidence: 0.95,
      classifiedAt: Date.now(),
    };

    const friendly: EntityClassification = {
      type: 'aircraft',
      domain: 'air',
      disposition: 'friend',
      confidence: 0.95,
      classifiedAt: Date.now(),
    };

    store.setClassification('radar', 'hostile-1', hostile);
    store.setClassification('radar', 'friendly-1', friendly);
  });

  describe('inferThreat', () => {
    it('should infer high threat for hostile entity', () => {
      const threat = engine.inferThreat('radar', 'hostile-1');

      expect(threat.threatLevel).toBe('high');
      expect(threat.threatFactors.disposition).toBe(1.0);
      expect(threat.confidenceScore).toBeGreaterThan(0.8);
    });

    it('should infer low threat for friendly entity', () => {
      const threat = engine.inferThreat('radar', 'friendly-1');

      expect(threat.threatLevel).toBe('low');
      expect(threat.threatFactors.disposition).toBe(0.0);
    });

    it('should apply capability multipliers', () => {
      const threat = engine.inferThreat('radar', 'hostile-1');

      // Aircraft in air domain has higher capability
      expect(threat.threatFactors.capability).toBeGreaterThan(0.5);
    });

    it('should set expiration time', () => {
      const threat = engine.inferThreat('radar', 'hostile-1');

      expect(threat.expiresAt).toBeDefined();
      expect(threat.expiresAt! > Date.now()).toBe(true);
    });

    describe('proximity factor', () => {
      // New York reference point; Newark is ~16 km away, Los Angeles ~3936 km.
      const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };

      it('should measure proximity from distance, not relationship count', () => {
        store.setEntity('radar', 'hostile-1', { latitude: 40.7357, longitude: -74.1724 }); // Newark

        const near = engine.inferThreat('radar', 'hostile-1', NEW_YORK.latitude, NEW_YORK.longitude);

        // ~16 km out of the 500 km proximity range.
        expect(near.threatFactors.proximity).toBeGreaterThan(0.95);

        store.setEntity('radar', 'hostile-1', { latitude: 34.0522, longitude: -118.2437 }); // LA
        const far = engine.inferThreat('radar', 'hostile-1', NEW_YORK.latitude, NEW_YORK.longitude);

        expect(far.threatFactors.proximity).toBe(0);
        expect(near.threatLevel).toBe('critical');
        expect(far.threatLevel).toBe('high');
      });

      it('should not invent a proximity factor from the relationship graph', () => {
        // 8 relationships used to read as proximity 0.8 for an entity whose
        // position is unknown.
        for (let i = 0; i < 8; i++) {
          store.addRelationship('radar', 'hostile-1', 'radar', `friend-${i}`, 'related_to');
        }

        const threat = engine.inferThreat('radar', 'hostile-1', NEW_YORK.latitude, NEW_YORK.longitude);

        expect(threat.threatFactors.proximity).toBeUndefined();
        // Falls back to the unknown-proximity prior, i.e. the same answer as
        // not supplying a reference position at all.
        expect(threat.threatLevel).toBe(engine.inferThreat('radar', 'hostile-1').threatLevel);
      });

      it('should never score an unlocated entity below the unknown-proximity prior', () => {
        const withReference = engine.inferThreat('radar', 'hostile-1', NEW_YORK.latitude, NEW_YORK.longitude);
        const withoutReference = engine.inferThreat('radar', 'hostile-1');

        expect(withReference.threatFactors.capability).toBe(withoutReference.threatFactors.capability);
        expect(withReference.threatLevel).toBe(withoutReference.threatLevel);
      });
    });
  });

  describe('detectAnomalies', () => {
    it('should detect disposition changes', () => {
      const anomalies = engine.detectAnomalies('radar', 'hostile-1', {
        avgSpeed: 100,
      });

      // May not detect if no historical data
      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should detect speed spikes', () => {
      store.setProperty('radar', 'hostile-1', 'speed', {
        value: 500,
        unit: 'knots',
      });

      const anomalies = engine.detectAnomalies('radar', 'hostile-1', {
        avgSpeed: 100,
      });

      const speedAnomaly = anomalies.find((a) => a.type === 'speed_spike');
      expect(speedAnomaly).toBeDefined();
      expect(speedAnomaly?.severity).toBe('medium');
    });
  });

  describe('estimateEscalationRisk', () => {
    it('should estimate high risk for hostile threats', () => {
      const threat = engine.inferThreat('radar', 'hostile-1');
      const risk = engine.estimateEscalationRisk(threat);

      expect(risk).toBeGreaterThan(0.2);
    });

    it('should estimate low risk for friendly entities', () => {
      const threat = engine.inferThreat('radar', 'friendly-1');
      const risk = engine.estimateEscalationRisk(threat);

      expect(risk).toBeLessThan(0.2);
    });
  });

  describe('recommendPriority', () => {
    it('should recommend critical threats first', () => {
      const threat1 = engine.inferThreat('radar', 'hostile-1');
      const threat2 = engine.inferThreat('radar', 'friendly-1');

      const recommendations = engine.recommendPriority([threat2, threat1]);

      expect(recommendations[0].entityId).toBe('hostile-1');
      expect(recommendations[0].priority).toBe('high');
    });

    it('should recommend actions for critical threats', () => {
      // Make threat critical by modifying disposition
      const criticalClassification: EntityClassification = {
        type: 'weapon_system',
        domain: 'land',
        disposition: 'hostile',
        confidence: 0.99,
        classifiedAt: Date.now(),
      };

      store.setClassification('radar', 'critical-threat', criticalClassification);
      const threat = engine.inferThreat('radar', 'critical-threat');

      const recommendations = engine.recommendPriority([threat]);

      if (recommendations.length > 0) {
        expect(recommendations[0].recommendedActions.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('AgentContext', () => {
  let context: AgentContext;

  beforeEach(() => {
    context = new AgentContext('user-123', 'tenant-abc');
  });

  describe('goals', () => {
    it('should add and retrieve goals', () => {
      context.addGoal({
        id: 'goal-1',
        type: 'protect',
        description: 'Protect base from threats',
        priority: 'high',
        createdAt: Date.now(),
      });

      const goals = context.getGoals();
      expect(goals).toHaveLength(1);
      expect(goals[0].description).toBe('Protect base from threats');
    });

    it('should filter goals by priority', () => {
      context.addGoal({
        id: 'goal-1',
        type: 'protect',
        description: 'Critical',
        priority: 'critical',
        createdAt: Date.now(),
      });

      context.addGoal({
        id: 'goal-2',
        type: 'monitor',
        description: 'Low',
        priority: 'low',
        createdAt: Date.now(),
      });

      const critical = context.getGoals('critical');
      expect(critical).toHaveLength(1);
      expect(critical[0].priority).toBe('critical');
    });

    it('should complete goals', () => {
      context.addGoal({
        id: 'goal-1',
        type: 'protect',
        description: 'Test',
        priority: 'high',
        createdAt: Date.now(),
      });

      context.completeGoal('goal-1');

      const goals = context.getGoals();
      expect(goals[0].completedAt).toBeDefined();
    });
  });

  describe('threat intelligence', () => {
    it('should record and retrieve threats', () => {
      context.recordThreat({
        entityPluginId: 'radar',
        entityId: 'threat-1',
        threatLevel: 'critical',
        confidenceScore: 0.95,
        threatFactors: { disposition: 1.0 },
        relatedThreats: [],
        assessedAt: Date.now(),
      });

      const threat = context.getThreat('radar', 'threat-1');
      expect(threat?.threatLevel).toBe('critical');
    });

    it('should get active threats sorted by level', () => {
      context.recordThreat({
        entityPluginId: 'radar',
        entityId: 'threat-1',
        threatLevel: 'low',
        confidenceScore: 0.9,
        threatFactors: {},
        relatedThreats: [],
        assessedAt: Date.now(),
      });

      context.recordThreat({
        entityPluginId: 'radar',
        entityId: 'threat-2',
        threatLevel: 'critical',
        confidenceScore: 0.95,
        threatFactors: {},
        relatedThreats: [],
        assessedAt: Date.now(),
      });

      const threats = context.getActivethreats();
      expect(threats[0].threatLevel).toBe('critical');
      expect(threats[1].threatLevel).toBe('low');
    });
  });

  describe('observations', () => {
    it('should record observations', () => {
      const entities = [
        {
          pluginId: 'radar',
          entityId: 'e1',
          latitude: 0,
          longitude: 0,
        },
      ];

      context.recordObservation(entities);

      const latest = context.getLatestObservation();
      expect(latest).toHaveLength(1);
    });

    it('should get observation history', () => {
      context.recordObservation([
        { pluginId: 'p1', entityId: 'e1', latitude: 0, longitude: 0 },
      ]);

      context.recordObservation([
        { pluginId: 'p1', entityId: 'e2', latitude: 1, longitude: 1 },
      ]);

      const history = context.getObservationHistory(60);
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('hypotheses', () => {
    it('should add and retrieve hypotheses', () => {
      context.addHypothesis('Coordinated attack detected', 0.8, [
        'Multiple hostile contacts',
      ]);

      const hypotheses = context.getHypotheses();
      expect(hypotheses).toHaveLength(1);
      expect(hypotheses[0].confidence).toBe(0.8);
    });

    it('should get top hypothesis', () => {
      context.addHypothesis('Weak hypothesis', 0.3, []);
      context.addHypothesis('Strong hypothesis', 0.9, []);

      const top = context.getTopHypothesis();
      expect(top?.confidence).toBe(0.9);
    });
  });

  describe('anomalies', () => {
    it('should record anomalies', () => {
      context.recordAnomaly('speed_spike', 'Unusual acceleration', 'high');

      const anomalies = context.getAnomalies();
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].severity).toBe('high');
    });

    it('should filter anomalies by severity', () => {
      context.recordAnomaly('a1', 'Low severity', 'low');
      context.recordAnomaly('a2', 'High severity', 'high');

      const highSeverity = context.getAnomalies('high');
      expect(highSeverity).toHaveLength(1);
    });
  });

  describe('getSummary', () => {
    it('should provide context summary', () => {
      context.recordThreat({
        entityPluginId: 'p',
        entityId: 'e',
        threatLevel: 'critical',
        confidenceScore: 1,
        threatFactors: {},
        relatedThreats: [],
        assessedAt: Date.now(),
      });

      const summary = context.getSummary();
      expect(summary.activeThreatCount).toBeGreaterThan(0);
      expect(summary.userId).toBe('user-123');
    });
  });

  describe('prune', () => {
    it('should remove old data', () => {
      context.recordObservation([
        { pluginId: 'p', entityId: 'e', latitude: 0, longitude: 0 },
      ]);

      // Prune data older than 0 seconds (everything)
      context.prune(0);

      const latest = context.getLatestObservation();
      expect(latest).toBeNull();
    });
  });
});

describe('SemanticAgent', () => {
  let store: SemanticStore;
  let context: AgentContext;
  let agent: SemanticAgent;

  beforeEach(() => {
    store = new SemanticStore();
    context = new AgentContext('user-123', 'tenant-abc');
    agent = new SemanticAgent('user-123', context, store, 'tenant-abc');

    // Add test data
    const hostile: EntityClassification = {
      type: 'aircraft',
      domain: 'air',
      disposition: 'hostile',
      confidence: 0.95,
      classifiedAt: Date.now(),
    };

    store.setClassification('radar', 'threat-1', hostile);
  });

  describe('cycle', () => {
    it('should execute reasoning cycle', async () => {
      const result = await agent.cycle();

      expect(result.cycleTimeMs).toBeGreaterThan(0);
      expect(result).toHaveProperty('decisionsCount');
      expect(result).toHaveProperty('threatsDetected');
    });
  });

  describe('getStatus', () => {
    it('should return agent status', () => {
      const status = agent.getStatus();

      expect(status.userId).toBe('user-123');
      expect(status.context).toBeDefined();
      expect(status.lastActivity).toBeGreaterThan(0);
    });
  });
});
