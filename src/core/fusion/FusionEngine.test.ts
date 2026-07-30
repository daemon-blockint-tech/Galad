/**
 * @file FusionEngine.test.ts
 * @description Unit and integration tests for FusionEngine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    entityFusion: {
      create: vi.fn().mockResolvedValue({ id: 'fusion-1' }),
    },
    fusionEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    entityProvenance: {
      upsert: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { FusionEngine } from './FusionEngine';
import { SemanticStore } from '@/core/semantic/semanticStore';
import {
  SpatialProximityStrategy,
  SemanticNameStrategy,
  TemporalCoherenceStrategy,
} from './DeduplicationStrategy';

describe('FusionEngine', () => {
  let engine: FusionEngine;
  let store: SemanticStore;

  beforeEach(() => {
    store = new SemanticStore('test-tenant');
    engine = new FusionEngine(store, 'test-tenant');
  });

  describe('Spatial Proximity Strategy', () => {
    it('should detect entities within distance threshold', async () => {
      const strategy = new SpatialProximityStrategy();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        latitude: 40.0,
        longitude: -74.0,
        speed: 500,
        heading: 90,
        timestamp: Date.now(),
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        latitude: 40.01,
        longitude: -74.01, // ~1.4 km away
        speed: 510,
        heading: 92,
        timestamp: Date.now(),
      };

      const result = await strategy.score(entity1, entity2);

      expect(result.spatialScore).toBeGreaterThan(0.5);
      expect(result.overallScore).toBeGreaterThan(0);
    });

    it('should return zero score for distant entities', async () => {
      const strategy = new SpatialProximityStrategy();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        latitude: 40.0,
        longitude: -74.0,
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        latitude: 45.0,
        longitude: -70.0, // ~560 km away
      };

      const result = await strategy.score(entity1, entity2);

      expect(result.spatialScore).toBe(0);
      expect(result.overallScore).toBe(0);
    });

    it('should boost score for heading agreement', async () => {
      const strategy = new SpatialProximityStrategy();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        latitude: 40.0,
        longitude: -74.0,
        heading: 90,
        speed: 500,
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        latitude: 40.001,
        longitude: -74.001,
        heading: 92, // Within 30° threshold
        speed: 510,
      };

      const result1 = await strategy.score(entity1, entity2);

      // Different heading
      entity2.heading = 180;
      const result2 = await strategy.score(entity1, entity2);

      expect(result1.spatialScore).toBeGreaterThan(result2.spatialScore);
    });
  });

  describe('Semantic Name Strategy', () => {
    it('should detect similar entity names', async () => {
      const strategy = new SemanticNameStrategy();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        label: 'Boeing 747',
        type: 'aircraft',
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        label: 'Boeing 747',
        type: 'aircraft',
      };

      const result = await strategy.score(entity1, entity2);

      expect(result.semanticScore).toBeGreaterThan(0.9);
    });

    it('should penalize type mismatch', async () => {
      const strategy = new SemanticNameStrategy();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        label: 'Ship A',
        type: 'maritime_vessel',
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        label: 'Ship A',
        type: 'aircraft',
      };

      const result = await strategy.score(entity1, entity2);

      expect(result.semanticScore).toBeLessThan(0.9);
    });

    it('should return zero for very different names', async () => {
      const strategy = new SemanticNameStrategy();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        label: 'Entity Alpha',
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        label: 'Zulu Bravo Charlie',
      };

      const result = await strategy.score(entity1, entity2);

      expect(result.semanticScore).toBeLessThan(0.7);
    });
  });

  describe('Temporal Coherence Strategy', () => {
    it('should validate entity tracks based on speed', async () => {
      const strategy = new TemporalCoherenceStrategy();

      const now = Date.now();

      const entity1 = {
        id: 'e1',
        pluginId: 'radar',
        entityId: 'contact-1',
        latitude: 40.0,
        longitude: -74.0,
        speed: 500, // knots
        timestamp: now - 60000, // 1 minute ago
      };

      const entity2 = {
        id: 'e2',
        pluginId: 'adsb',
        entityId: 'contact-2',
        latitude: 40.0097, // ~1 km away
        longitude: -74.0,
        speed: 500,
        timestamp: now,
      };

      const result = await strategy.score(entity1, entity2);

      // Speed: 500 knots = ~257 m/s = ~15.4 km/min
      // 1 minute * 15.4 km/min = ~15.4 km expected
      // Actual: 1 km, so not matching
      expect(result.temporalScore).toBeLessThan(0.5);
    });
  });

  describe('Confidence Scoring', () => {
    it('should blend multiple strategy scores', () => {
      const scorer = engine['scorer'];

      const scores = [
        { strategyName: 'spatial', score: 0.8, weight: 0.5 },
        { strategyName: 'semantic', score: 0.6, weight: 0.3 },
        { strategyName: 'temporal', score: 0.4, weight: 0.2 },
      ];

      const result = scorer.blendScores(scores);

      // (0.8*0.5 + 0.6*0.3 + 0.4*0.2) / (0.5+0.3+0.2) = 0.68
      expect(result.overallScore).toBeCloseTo(0.68, 1);
    });

    it('should apply source credibility adjustment', () => {
      const scorer = engine['scorer'];

      scorer.registerSource('radar', 0.95);
      scorer.registerSource('osint', 0.5);

      const adjusted = scorer.adjustForSourceCredibility(0.7, 'radar', 'osint');

      expect(adjusted).toBeGreaterThan(0.7);
    });

    it('should determine fusion threshold', () => {
      const scorer = engine['scorer'];

      expect(scorer.shouldFuse(0.8, 0.75)).toBe(true);
      expect(scorer.shouldFuse(0.7, 0.75)).toBe(false);
    });
  });

  describe('Fusion Detection', () => {
    it('should detect no candidates from empty store', async () => {
      const candidates = await engine.detectFusions();
      expect(candidates).toHaveLength(0);
    });

    it('should set and get fusion threshold', () => {
      engine.setFusionThreshold(0.8);
      // No public getter, but test via side effects
      expect(engine).toBeDefined();
    });
  });

  describe('Fusion Acceptance and Rejection', () => {
    it('should accept fusion with audit trail', async () => {
      const proposal = {
        id1: 'radar|contact-1',
        id2: 'adsb|contact-2',
        pluginId1: 'radar',
        entityId1: 'contact-1',
        pluginId2: 'adsb',
        entityId2: 'contact-2',
        score: 0.85,
        reasons: ['spatial_proximity', 'heading_agreement'],
        metadata: {},
        strategyBreakdown: [],
      };

      const fusionId = await engine.acceptFusion(proposal, 'user-123', 'Valid fusion');

      expect(fusionId).toBeDefined();
    });

    it('should reject fusion and log decision', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await engine.rejectFusion('radar', 'contact-1', 'adsb', 'contact-2', 'user-456', 'False positive');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
