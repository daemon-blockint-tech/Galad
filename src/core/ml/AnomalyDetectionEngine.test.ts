/**
 * @file AnomalyDetectionEngine.test.ts
 * @description Unit tests for AnomalyDetectionEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyDetectionEngine, EntityBehavior, IsolationForest } from './AnomalyDetectionEngine';
import { SemanticStore } from '@/core/semantic/semanticStore';

describe('AnomalyDetectionEngine', () => {
  let engine: AnomalyDetectionEngine;
  let mockStore: Partial<SemanticStore>;

  beforeEach(() => {
    mockStore = {};
    engine = new AnomalyDetectionEngine(mockStore as SemanticStore);
  });

  describe('behavior recording', () => {
    it('should record entity behavior', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 100,
          acceleration: 50,
          heading: 45,
          headingChange: 15,
          proximity: 0.8,
          activityLevel: 0.6,
          deviceAnomalyCount: 0,
        },
      };

      expect(() => engine.recordBehavior(behavior)).not.toThrow();
    });

    it('should validate required features', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 100,
          acceleration: 50,
          heading: 45,
          headingChange: 15,
          proximity: 0.8,
          activityLevel: 0.6,
          // Missing deviceAnomalyCount
        } as any,
      };

      expect(() => engine.recordBehavior(behavior)).toThrow('Missing required feature');
    });

    it('should validate feature types', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 100,
          acceleration: 50,
          heading: 45,
          headingChange: 15,
          proximity: 0.8,
          activityLevel: 0.6,
          deviceAnomalyCount: 'zero' as any,
        },
      };

      expect(() => engine.recordBehavior(behavior)).toThrow('must be a number');
    });

    it('should maintain history size limit', () => {
      for (let i = 0; i < 15000; i++) {
        const behavior: EntityBehavior = {
          entityId: `entity-${i % 100}`,
          pluginId: 'plugin-1',
          timestamp: Date.now() + i,
          features: {
            speed: Math.random() * 1000,
            acceleration: Math.random() * 500,
            heading: Math.random() * 360,
            headingChange: Math.random() * 180,
            proximity: Math.random(),
            activityLevel: Math.random(),
            deviceAnomalyCount: Math.floor(Math.random() * 10),
          },
        };

        engine.recordBehavior(behavior);
      }

      const stats = engine.getStats();
      expect(stats.trainingDataSize).toBeLessThanOrEqual(10000);
    });
  });

  describe('baseline tracking', () => {
    it('should initialize baseline on first behavior', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 100,
          acceleration: 50,
          heading: 45,
          headingChange: 15,
          proximity: 0.8,
          activityLevel: 0.6,
          deviceAnomalyCount: 0,
        },
      };

      engine.recordBehavior(behavior);

      const baseline = engine.getBaseline('plugin-1', 'entity-1');
      expect(baseline).toBeDefined();
      expect(baseline?.mean['speed']).toBe(100);
      expect(baseline?.sampleCount).toBe(1);
    });

    it('should update baseline with exponential moving average', () => {
      const behavior1: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 100,
          acceleration: 50,
          heading: 45,
          headingChange: 15,
          proximity: 0.8,
          activityLevel: 0.6,
          deviceAnomalyCount: 0,
        },
      };

      const behavior2: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now() + 1000,
        features: {
          speed: 200,
          acceleration: 100,
          heading: 90,
          headingChange: 30,
          proximity: 0.6,
          activityLevel: 0.8,
          deviceAnomalyCount: 1,
        },
      };

      engine.recordBehavior(behavior1);
      engine.recordBehavior(behavior2);

      const baseline = engine.getBaseline('plugin-1', 'entity-1');
      expect(baseline).toBeDefined();
      expect(baseline?.sampleCount).toBe(2);
      // EMA with alpha=0.1: new_mean = old_mean * 0.9 + new_value * 0.1
      // For speed: 100 * 0.9 + 200 * 0.1 = 90 + 20 = 110
      expect(baseline?.mean['speed']).toBeCloseTo(110, 5);
    });

    it('should track standard deviation changes', () => {
      const behaviors: EntityBehavior[] = [
        {
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now(),
          features: {
            speed: 100,
            acceleration: 50,
            heading: 45,
            headingChange: 15,
            proximity: 0.8,
            activityLevel: 0.6,
            deviceAnomalyCount: 0,
          },
        },
        {
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() + 1000,
          features: {
            speed: 105,
            acceleration: 52,
            heading: 47,
            headingChange: 16,
            proximity: 0.79,
            activityLevel: 0.61,
            deviceAnomalyCount: 0,
          },
        },
      ];

      behaviors.forEach((b) => engine.recordBehavior(b));

      const baseline = engine.getBaseline('plugin-1', 'entity-1');
      expect(baseline?.stdDev['speed']).toBeGreaterThan(0);
    });
  });

  describe('anomaly detection', () => {
    it('should detect anomalies in normal data', () => {
      const normalBehaviors: EntityBehavior[] = [];
      for (let i = 0; i < 100; i++) {
        normalBehaviors.push({
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() + i * 1000,
          features: {
            speed: 100 + Math.random() * 10,
            acceleration: 50 + Math.random() * 5,
            heading: 45 + Math.random() * 5,
            headingChange: 15 + Math.random() * 5,
            proximity: 0.8 + Math.random() * 0.1,
            activityLevel: 0.6 + Math.random() * 0.1,
            deviceAnomalyCount: 0,
          },
        });
      }

      normalBehaviors.forEach((b) => engine.recordBehavior(b));
      engine.trainModel();

      const scores = engine.detectAnomalies([normalBehaviors[0]]);
      expect(scores).toHaveLength(1);
      expect(scores[0].score).toBeDefined();
      expect(scores[0].severity).toBeDefined();
    });

    it('should score extreme values as more anomalous', () => {
      const normalBehaviors: EntityBehavior[] = [];
      for (let i = 0; i < 100; i++) {
        normalBehaviors.push({
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() + i * 1000,
          features: {
            speed: 100,
            acceleration: 50,
            heading: 45,
            headingChange: 15,
            proximity: 0.8,
            activityLevel: 0.6,
            deviceAnomalyCount: 0,
          },
        });
      }

      normalBehaviors.forEach((b) => engine.recordBehavior(b));
      engine.trainModel();

      const normalScore = engine.detectAnomalies([normalBehaviors[0]])[0].score;

      const anomalous: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now() + 100000,
        features: {
          speed: 5000,
          acceleration: 1000,
          heading: 45,
          headingChange: 180,
          proximity: 0.1,
          activityLevel: 0.9,
          deviceAnomalyCount: 10,
        },
      };

      const anomalousScore = engine.detectAnomalies([anomalous])[0].score;
      expect(anomalousScore).toBeGreaterThan(normalScore);
    });

    it('should map scores to severity levels', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 1000,
          acceleration: 500,
          heading: 45,
          headingChange: 180,
          proximity: 0.1,
          activityLevel: 0.9,
          deviceAnomalyCount: 10,
        },
      };

      // Need some baseline data first
      for (let i = 0; i < 100; i++) {
        engine.recordBehavior({
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() - (100 - i) * 1000,
          features: {
            speed: 100,
            acceleration: 50,
            heading: 45,
            headingChange: 15,
            proximity: 0.8,
            activityLevel: 0.6,
            deviceAnomalyCount: 0,
          },
        });
      }

      engine.trainModel();
      const scores = engine.detectAnomalies([behavior]);
      expect(['none', 'low', 'medium', 'high', 'critical']).toContain(scores[0].severity);
    });

    it('should extract anomaly indicators', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 2000,
          acceleration: 600,
          heading: 45,
          headingChange: 120,
          proximity: 0.3,
          activityLevel: 0.6,
          deviceAnomalyCount: 0,
        },
      };

      for (let i = 0; i < 100; i++) {
        engine.recordBehavior({ ...behavior, timestamp: behavior.timestamp + i });
      }
      engine.trainModel();

      const scores = engine.detectAnomalies([behavior]);
      expect(scores[0].indicators).toContain('excessive_speed');
      expect(scores[0].indicators).toContain('high_acceleration');
      expect(scores[0].indicators).toContain('sharp_turn');
      expect(scores[0].indicators).toContain('close_proximity');
    });
  });

  describe('model management', () => {
    it('should train model with sufficient data', () => {
      for (let i = 0; i < 150; i++) {
        engine.recordBehavior({
          entityId: `entity-${i % 10}`,
          pluginId: 'plugin-1',
          timestamp: Date.now() + i * 1000,
          features: {
            speed: Math.random() * 500,
            acceleration: Math.random() * 250,
            heading: Math.random() * 360,
            headingChange: Math.random() * 90,
            proximity: Math.random(),
            activityLevel: Math.random(),
            deviceAnomalyCount: 0,
          },
        });
      }

      expect(() => engine.trainModel()).not.toThrow();
      const stats = engine.getStats();
      expect(stats.modelsCount).toBe(1);
    });

    it('should refuse to train on insufficient data instead of silently no-oping', () => {
      for (let i = 0; i < 50; i++) {
        engine.recordBehavior({
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() + i * 1000,
          features: {
            speed: 100,
            acceleration: 50,
            heading: 45,
            headingChange: 15,
            proximity: 0.8,
            activityLevel: 0.6,
            deviceAnomalyCount: 0,
          },
        });
      }

      expect(() => engine.trainModel()).toThrow('Insufficient data');
      // ...and the untrained model must not report itself as a model.
      expect(engine.getStats().modelsCount).toBe(0);
    });

    it('should refuse to score against an untrained model', () => {
      const behavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 100,
          acceleration: 50,
          heading: 45,
          headingChange: 15,
          proximity: 0.8,
          activityLevel: 0.6,
          deviceAnomalyCount: 0,
        },
      };

      engine.recordBehavior(behavior);

      // Previously returned [{ severity: 'none' }] — a clean sweep from a
      // model with zero trees.
      expect(() => engine.detectAnomalies([behavior])).toThrow('not trained');
    });

    it('should track baseline and model statistics', () => {
      for (let i = 0; i < 100; i++) {
        engine.recordBehavior({
          entityId: `entity-${i % 5}`,
          pluginId: 'plugin-1',
          timestamp: Date.now() + i * 1000,
          features: {
            speed: Math.random() * 500,
            acceleration: Math.random() * 250,
            heading: Math.random() * 360,
            headingChange: Math.random() * 90,
            proximity: Math.random(),
            activityLevel: Math.random(),
            deviceAnomalyCount: 0,
          },
        });
      }

      const stats = engine.getStats();
      expect(stats.trainingDataSize).toBe(100);
      expect(stats.baselineCount).toBe(5); // 5 unique entities
      expect(stats.modelsCount).toBe(0); // nothing trained yet

      engine.trainModel();
      expect(engine.getStats().modelsCount).toBe(1);
    });
  });

  describe('isolation forest', () => {
    const behaviorAt = (i: number, scale = 1): EntityBehavior => ({
      entityId: 'entity-1',
      pluginId: 'plugin-1',
      timestamp: 1_700_000_000_000 + i * 1000,
      features: {
        speed: (100 + (i % 17)) * scale,
        acceleration: (50 + (i % 11)) * scale,
        heading: (45 + (i % 13)) * scale,
        headingChange: (15 + (i % 7)) * scale,
        proximity: (0.8 + (i % 5) / 100) * scale,
        activityLevel: (0.6 + (i % 3) / 100) * scale,
        deviceAnomalyCount: (i % 2) * scale,
      },
    });

    it('should normalise scores by subsample size, not by the constant 1', () => {
      const forest = new IsolationForest(100, 10);
      const training = Array.from({ length: 200 }, (_, i) => behaviorAt(i));
      forest.train(training);

      const score = forest.score(behaviorAt(3, 500));

      // score = 2^(-E[h(x)]/c(psi)). psi = ceil(sqrt(200)) = 15, so
      // c(15) = 2*(ln 14 + 0.5772) - 2*14/15 ~= 4.57. With normalizer() === 1
      // the same forest returns score^c(15) ~= 0.07 — every severity in
      // scoreToSeverity then collapses toward 'none'.
      expect(score).toBeGreaterThan(0.4);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should reject scoring before training', () => {
      expect(() => new IsolationForest().score(behaviorAt(0))).toThrow('not trained');
    });

    it('should score normal points lower than anomalies', () => {
      const normalBehaviors: EntityBehavior[] = [];
      for (let i = 0; i < 200; i++) {
        normalBehaviors.push({
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() + i * 100,
          features: {
            speed: 100 + Math.random() * 20,
            acceleration: 50 + Math.random() * 10,
            heading: 45 + Math.random() * 10,
            headingChange: 15 + Math.random() * 5,
            proximity: 0.8 + Math.random() * 0.1,
            activityLevel: 0.6 + Math.random() * 0.1,
            deviceAnomalyCount: 0,
          },
        });
      }

      normalBehaviors.forEach((b) => engine.recordBehavior(b));
      engine.trainModel();

      const normal = normalBehaviors[0];
      const anomalous: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now() + 100000,
        features: {
          speed: 5000,
          acceleration: 2000,
          heading: 45,
          headingChange: 180,
          proximity: 0.1,
          activityLevel: 0.9,
          deviceAnomalyCount: 10,
        },
      };

      const normalScores = engine.detectAnomalies([normal]);
      const anomalousScores = engine.detectAnomalies([anomalous]);

      expect(anomalousScores[0].score).toBeGreaterThan(normalScores[0].score);
    });
  });
});
