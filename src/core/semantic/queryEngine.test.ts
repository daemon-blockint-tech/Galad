/**
 * @file queryEngine.test.ts
 * @description Tests for SemanticQueryEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticStore } from './semanticStore';
import { SemanticQueryEngine } from './queryEngine';
import type { EntityClassification } from '@maven-system/plugin-sdk';

describe('SemanticQueryEngine', () => {
  let store: SemanticStore;
  let engine: SemanticQueryEngine;

  beforeEach(() => {
    store = new SemanticStore();
    engine = new SemanticQueryEngine(store);

    // Populate test data
    const friendlyAircraft: EntityClassification = {
      type: 'aircraft',
      domain: 'air',
      disposition: 'friend',
      confidence: 0.95,
      classifiedAt: Date.now(),
    };

    const hostileAircraft: EntityClassification = {
      type: 'aircraft',
      domain: 'air',
      disposition: 'hostile',
      confidence: 0.88,
      classifiedAt: Date.now(),
    };

    const maritimeVessel: EntityClassification = {
      type: 'maritime_vessel',
      domain: 'maritime',
      disposition: 'neutral',
      confidence: 0.92,
      classifiedAt: Date.now(),
    };

    // Store classifications
    store.setClassification('aviation', 'aircraft-1', friendlyAircraft);
    store.setClassification('aviation', 'aircraft-2', hostileAircraft);
    store.setClassification('maritime', 'ship-1', maritimeVessel);

    // Add relationships
    store.addRelationship('military', 'unit-1', 'aviation', 'aircraft-1', 'controls', 0.9);
    store.addRelationship('military', 'unit-1', 'aviation', 'aircraft-2', 'controls', 0.85);
  });

  describe('find_by_type', () => {
    it('should find all entities of a type', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft'],
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.entities.every(e => e.classification?.type === 'aircraft')).toBe(true);
    });

    it('should filter by disposition', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft'],
        disposition: 'hostile',
      });

      expect(result.count).toBe(1);
      expect(result.entities[0].classification?.disposition).toBe('hostile');
    });

    it('should filter by domain', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft', 'maritime_vessel'],
        domains: ['air'],
      });

      expect(result.count).toBe(2);
      expect(result.entities.every(e => e.classification?.domain === 'air')).toBe(true);
    });

    it('should filter by confidence', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft'],
        minConfidence: 0.9,
      });

      expect(result.count).toBe(1);
      expect(result.entities[0].classification?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should respect limit', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft'],
        limit: 1,
      });

      expect(result.count).toBe(1);
    });

    it('should sort by confidence descending', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft'],
      });

      const confidences = result.entities.map(e => e.classification?.confidence ?? 0);
      for (let i = 1; i < confidences.length; i++) {
        expect(confidences[i - 1]).toBeGreaterThanOrEqual(confidences[i]);
      }
    });
  });

  describe('query_relationships', () => {
    it('should find related entities', async () => {
      const result = await engine.execute({
        type: 'query_relationships',
        sourcePluginId: 'military',
        sourceEntityId: 'unit-1',
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });

    it('should filter by relationship type', async () => {
      const result = await engine.execute({
        type: 'query_relationships',
        sourcePluginId: 'military',
        sourceEntityId: 'unit-1',
        relationshipTypes: ['controls'],
      });

      expect(result.count).toBe(2);
      expect(result.entities.every(e => e.relationshipType === 'controls')).toBe(true);
    });

    it('should include relationship confidence', async () => {
      const result = await engine.execute({
        type: 'query_relationships',
        sourcePluginId: 'military',
        sourceEntityId: 'unit-1',
      });

      expect(result.entities.every(e => e.relationshipConfidence !== undefined)).toBe(true);
    });

    it('should return empty for non-existent source', async () => {
      const result = await engine.execute({
        type: 'query_relationships',
        sourcePluginId: 'nonexistent',
        sourceEntityId: 'nonexistent',
      });

      expect(result.count).toBe(0);
    });
  });

  describe('threat_assessment', () => {
    it('should assess threat level based on disposition', () => {
      const hostile = engine.assessThreat({
        type: 'threat_assessment',
        entityPluginId: 'aviation',
        entityId: 'aircraft-2',
      });

      expect(hostile.threatLevel).toBe('high');
      expect(hostile.hostilityScore).toBeGreaterThan(0.5);
    });

    it('should rate friendly entities as low threat', () => {
      const friendly = engine.assessThreat({
        type: 'threat_assessment',
        entityPluginId: 'aviation',
        entityId: 'aircraft-1',
      });

      expect(friendly.threatLevel).toBe('low');
      expect(friendly.hostilityScore).toBe(0);
    });

    it('should include reasoning factors', () => {
      const result = engine.assessThreat({
        type: 'threat_assessment',
        entityPluginId: 'aviation',
        entityId: 'aircraft-2',
      });

      expect(result.reasoning.factors.length).toBeGreaterThan(0);
      expect(result.reasoning.confidence).toBeGreaterThan(0);
    });
  });

  describe('aggregate_context', () => {
    it('should aggregate context for an entity', () => {
      const result = engine.aggregateContext({
        type: 'aggregate_context',
        entityPluginId: 'military',
        entityId: 'unit-1',
      });

      expect(result.entityPluginId).toBe('military');
      expect(result.entityId).toBe('unit-1');
    });

    it('should group related entities by relationship type', () => {
      const result = engine.aggregateContext({
        type: 'aggregate_context',
        entityPluginId: 'military',
        entityId: 'unit-1',
      });

      expect(Object.keys(result.relatedByRelationship).length).toBeGreaterThan(0);
      expect(result.relatedByRelationship['controls']).toBeDefined();
    });

    it('should count threat types', () => {
      const result = engine.aggregateContext({
        type: 'aggregate_context',
        entityPluginId: 'military',
        entityId: 'unit-1',
      });

      expect(result.threatLandscape.hostileCount +
             result.threatLandscape.friendlyCount +
             result.threatLandscape.neutralCount).toBe(2);
    });
  });

  describe('spatial_semantic_query', () => {
    it('should execute spatial semantic search', async () => {
      const result = await engine.execute({
        type: 'spatial_semantic',
        latitude: 40.5,
        longitude: -74.2,
        radiusKm: 100,
      });

      expect(result.success).toBe(true);
    });

    it('should filter by entity types', async () => {
      const result = await engine.execute({
        type: 'spatial_semantic',
        latitude: 40.5,
        longitude: -74.2,
        radiusKm: 100,
        entityTypes: ['aircraft'],
      });

      expect(result.entities.every(e => e.classification?.type === 'aircraft')).toBe(true);
    });

    it('should filter by disposition', async () => {
      const result = await engine.execute({
        type: 'spatial_semantic',
        latitude: 40.5,
        longitude: -74.2,
        radiusKm: 100,
        disposition: 'friendly',
      });

      expect(result.entities.every(e => e.classification?.disposition === 'friend')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle unknown query types gracefully', async () => {
      const result = await engine.execute({
        type: 'unknown_query' as any,
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should catch execution errors', async () => {
      const invalidQuery = {
        type: 'find_by_type',
        entityTypes: [], // Invalid: empty array
      } as any;

      const result = await engine.execute(invalidQuery);
      // Should complete without throwing, though result may vary
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('performance', () => {
    it('should execute queries quickly', async () => {
      const result = await engine.execute({
        type: 'find_by_type',
        entityTypes: ['aircraft'],
      });

      expect(result.executionTimeMs).toBeLessThan(100);
    });
  });
});
