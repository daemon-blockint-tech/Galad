/**
 * @file integration.test.ts
 * @description Integration tests for Phase 4 fusion pipeline.
 * Tests end-to-end workflows from detection to validation to merge.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FusionEngine } from './FusionEngine';
import { GraphRenderer } from '@/core/graph/GraphRenderer';
import { SemanticStore } from '@/core/semantic/semanticStore';
import { FusionCoordinator } from '@/core/agents/FusionCoordinator';

describe('Phase 4: Integration Tests', () => {
  let store: SemanticStore;
  let engine: FusionEngine;
  let renderer: GraphRenderer;
  let coordinator: FusionCoordinator;

  beforeEach(() => {
    store = new SemanticStore('test-tenant');
    engine = new FusionEngine(store, 'test-tenant');
    renderer = new GraphRenderer(store);
    coordinator = new FusionCoordinator(engine, store);
  });

  describe('End-to-End Fusion Pipeline', () => {
    it('should detect and propose fusions for nearby entities', async () => {
      // Setup: Add nearby entities
      const now = Date.now();

      store.setEntity('radar', 'contact-1', {
        pluginId: 'radar',
        entityId: 'contact-1',
        latitude: 40.0,
        longitude: -74.0,
        speed: 500,
        heading: 90,
        timestamp: now,
        label: 'Aircraft A',
      });

      store.setEntity('adsb', 'contact-2', {
        pluginId: 'adsb',
        entityId: 'contact-2',
        latitude: 40.001,
        longitude: -74.001, // ~141 meters away
        speed: 510,
        heading: 92,
        timestamp: now,
        label: 'Aircraft A',
      });

      // Classify entities
      store.setClassification('radar', 'contact-1', {
        type: 'aircraft',
        domain: 'air',
        disposition: 'friend',
        confidence: 0.9,
        classifiedAt: now,
      });

      store.setClassification('adsb', 'contact-2', {
        type: 'aircraft',
        domain: 'air',
        disposition: 'friend',
        confidence: 0.95,
        classifiedAt: now,
      });

      // Detect fusions
      const proposals = await engine.detectFusions();

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].score).toBeGreaterThan(0.75);
    });

    it('should build and layout graph from relationships', async () => {
      // Setup: Create entities with relationships
      store.setEntity('radar', 'contact-1', {
        pluginId: 'radar',
        entityId: 'contact-1',
        label: 'Carrier Group',
      });

      store.setEntity('radar', 'contact-2', {
        pluginId: 'radar',
        entityId: 'contact-2',
        label: 'Escort Ship',
      });

      // Add relationship
      store.addRelationship(
        'radar',
        'contact-1',
        'radar',
        'contact-2',
        'escorts',
        0.95,
      );

      store.setClassification('radar', 'contact-1', {
        type: 'maritime_vessel',
        domain: 'maritime',
        disposition: 'unknown',
        confidence: 0.8,
        classifiedAt: Date.now(),
      });

      store.setClassification('radar', 'contact-2', {
        type: 'maritime_vessel',
        domain: 'maritime',
        disposition: 'unknown',
        confidence: 0.85,
        classifiedAt: Date.now(),
      });

      // Build graph
      const layout = renderer.buildGraph(500, undefined);

      expect(layout.nodes.length).toBe(2);
      expect(layout.edges.length).toBeGreaterThan(0);
      expect(layout.bounds.width).toBeGreaterThan(0);
    });

    it('should coordinate multi-agent fusion validation', async () => {
      // Setup: Create fusion proposal
      const proposal = {
        id1: 'radar|contact-1',
        id2: 'adsb|contact-2',
        pluginId1: 'radar',
        entityId1: 'contact-1',
        pluginId2: 'adsb',
        entityId2: 'contact-2',
        score: 0.85,
        reasons: ['spatial_proximity'],
        metadata: {},
        strategyBreakdown: [],
      };

      // Create scenario
      const scenario = {
        candidateFusions: [proposal],
        sourceCredibilities: new Map([
          ['radar', 0.9],
          ['adsb', 0.95],
        ]),
        correlationContext: [],
        timestamp: Date.now(),
      };

      // Orchestrate validation
      const results = await coordinator.orchestrateFusion(scenario);

      expect(results).toHaveLength(1);
      expect(results[0].fusion).toBeDefined();
      expect(results[0].confidence).toBeGreaterThan(0);
    });

    it('should track source credibility across validations', () => {
      // Check initial credibility
      const initialCred = coordinator.getSourceCredibility('radar');
      expect(initialCred?.trustScore).toBe(0.9);

      // Update based on correct assessment
      coordinator.updateSourceCredibility('radar', {
        isCorrect: true,
        confidence: 0.9,
      });

      const updatedCred = coordinator.getSourceCredibility('radar');
      expect(updatedCred?.trustScore).toBeGreaterThan(0.9);

      // Update based on incorrect assessment
      coordinator.updateSourceCredibility('radar', {
        isCorrect: false,
        confidence: 0.8,
      });

      const decreasedCred = coordinator.getSourceCredibility('radar');
      expect(decreasedCred?.trustScore).toBeLessThan(updatedCred!.trustScore);
    });
  });

  // Scale tests: these assert that the pipeline completes and stays correct at
  // size. They deliberately do not assert wall-clock time — 68 test files run in
  // parallel here, so timing assertions measure machine contention, not the code.
  describe('Scale Tests', () => {
    it('should detect fusions across a large entity set', async () => {
      // 300 entities => ~45k pairs. detectFusions is O(n²) by design, so this is
      // sized to exercise the full path in seconds rather than minutes.
      const entities = Array.from({ length: 300 }, (_, i) => ({
        pluginId: `source-${i % 5}`,
        entityId: `entity-${i}`,
        latitude: 40.0 + (i % 100) * 0.001,
        longitude: -74.0 + (i % 100) * 0.001,
        label: `Entity ${i}`,
      }));

      for (const entity of entities) {
        store.setEntity(entity.pluginId, entity.entityId, entity);
      }

      const proposals = await engine.detectFusions();

      // Entities cycle through 100 distinct positions, so co-located pairs from
      // different sources must be proposed, every proposal must clear the fusion
      // threshold, and results must come back sorted by descending score.
      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.every((p) => p.score >= 0.75)).toBe(true);
      expect(proposals).toEqual([...proposals].sort((a, b) => b.score - a.score));
    }, 30000);

    it('should layout graph with 500 nodes', () => {
      // Setup: Create 500 entities
      for (let i = 0; i < 500; i++) {
        store.setEntity('source', `entity-${i}`, {
          pluginId: 'source',
          entityId: `entity-${i}`,
          label: `Entity ${i}`,
        });

        if (i > 0 && i % 10 === 0) {
          store.addRelationship('source', `entity-${i - 1}`, 'source', `entity-${i}`, 'related', 0.8);
        }
      }

      const layout = renderer.buildGraph(500);

      expect(layout.nodes).toHaveLength(500);
      // 49 relationships were added (every 10th entity links to its predecessor).
      expect(layout.edges).toHaveLength(49);
      expect(layout.bounds.width).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing entities gracefully', async () => {
      const proposal = {
        id1: 'nonexistent|1',
        id2: 'nonexistent|2',
        pluginId1: 'nonexistent',
        entityId1: '1',
        pluginId2: 'nonexistent',
        entityId2: '2',
        score: 0.8,
        reasons: [],
        metadata: {},
        strategyBreakdown: [],
      };

      const scenario = {
        candidateFusions: [proposal],
        sourceCredibilities: new Map(),
        correlationContext: [],
        timestamp: Date.now(),
      };

      const results = await coordinator.orchestrateFusion(scenario);

      expect(results).toHaveLength(1);
      expect(results[0].isValid).toBe(false);
    });

    it('should handle graph building with no entities', () => {
      const layout = renderer.buildGraph(500);

      expect(layout.nodes).toHaveLength(0);
      expect(layout.edges).toHaveLength(0);
      expect(layout.bounds.width).toBeGreaterThan(0);
    });

    it('should handle contradictory fusion proposals', async () => {
      // Create entities with conflicting headings
      store.setEntity('radar', 'contact-1', {
        pluginId: 'radar',
        entityId: 'contact-1',
        heading: 90,
      });

      store.setEntity('adsb', 'contact-2', {
        pluginId: 'adsb',
        entityId: 'contact-2',
        heading: 180, // 90° mismatch
      });

      const proposal = {
        id1: 'radar|contact-1',
        id2: 'adsb|contact-2',
        pluginId1: 'radar',
        entityId1: 'contact-1',
        pluginId2: 'adsb',
        entityId2: 'contact-2',
        score: 0.8,
        reasons: ['spatial_proximity'],
        metadata: {},
        strategyBreakdown: [],
      };

      const scenario = {
        candidateFusions: [proposal],
        sourceCredibilities: new Map([
          ['radar', 0.9],
          ['adsb', 0.95],
        ]),
        correlationContext: [],
        timestamp: Date.now(),
      };

      const results = await coordinator.orchestrateFusion(scenario);

      expect(results[0].isValid).toBe(false);
      expect(results[0].risks.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should isolate data between tenants', async () => {
      const store2 = new SemanticStore('tenant-2');
      const engine2 = new FusionEngine(store2, 'tenant-2');

      // Add to store1
      store.setEntity('radar', 'contact-1', {
        pluginId: 'radar',
        entityId: 'contact-1',
      });

      // Check isolation
      expect(store.getAllEntities()).toHaveLength(1);
      expect(store2.getAllEntities()).toHaveLength(0);
    });
  });
});
