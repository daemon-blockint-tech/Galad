/**
 * @file CorrelationQueryEngine.test.ts
 * @description Correlation scoring must not turn absent data into agreement:
 * two entities with no alerts were scored 1.0 "very_strong" (and 0.9 "strong
 * fusion candidate"), and spatial_proximity returned [] for every input
 * because no location was ever loaded.
 */

import { describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma';
import { SemanticStore } from '@/core/semantic/semanticStore';

import { CorrelationQueryEngine } from './CorrelationQueryEngine';

interface FakeAlert {
  entityId: string;
  type: string;
  severity: string;
  createdAt: Date;
  escalationLevel: number;
}

function makeDb(alerts: FakeAlert[]): PrismaClient {
  return {
    alert: {
      findMany: ({ where }: { where: { entityId: string; type?: string } }) =>
        Promise.resolve(
          alerts.filter(
            (a) => a.entityId === where.entityId && (!where.type || a.type === where.type),
          ),
        ),
    },
  } as unknown as PrismaClient;
}

const alert = (entityId: string, type: string, severity: string): FakeAlert => ({
  entityId,
  type,
  severity,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  escalationLevel: 1,
});

describe('CorrelationQueryEngine threat_correlation', () => {
  it('reports no correlation for two entities with no alerts', async () => {
    const engine = new CorrelationQueryEngine(makeDb([]));

    const results = await engine.query({
      type: 'threat_correlation',
      entityIds: ['radar|a', 'radar|b'],
    });

    expect(results).toEqual([]);
  });

  it('averages over attempted signals so one signal cannot reach 1.0', async () => {
    const engine = new CorrelationQueryEngine(
      makeDb([alert('radar|a', 'threat', 'medium'), alert('radar|b', 'fusion', 'medium')]),
    );

    const results = await engine.query({
      type: 'threat_correlation',
      entityIds: ['radar|a', 'radar|b'],
      threshold: 0.1,
    });

    expect(results).toHaveLength(1);
    // threat_level_similarity 1 + alert_type_overlap 0 + severity_alignment 1,
    // over the 3 signals attempted.
    expect(results[0].correlationScore).toBeCloseTo(2 / 3, 5);
    expect(results[0].strength).toBe('moderate');
    expect(results[0].recommendation).not.toMatch(/immediate investigation/i);
  });
});

describe('CorrelationQueryEngine entity_fusion', () => {
  it('does not propose two unobserved entities as fusion candidates', async () => {
    const engine = new CorrelationQueryEngine(makeDb([]));

    const results = await engine.query({
      type: 'entity_fusion',
      entityIds: ['radar|a', 'adsb|b'],
    });

    expect(results).toEqual([]);
  });
});

describe('CorrelationQueryEngine spatial_proximity', () => {
  const positioned = () => {
    const store = new SemanticStore();
    store.setEntity('radar', 'a', { latitude: 40.0, longitude: -74.0, timestamp: 1_700_000_000_000 });
    store.setEntity('adsb', 'b', {
      latitude: 40.001,
      longitude: -74.001, // ~141 m from radar|a
      timestamp: 1_700_000_000_000 + 60_000,
    });
    return store;
  };

  it('fails loudly instead of returning an empty result when no position is known', async () => {
    const engine = new CorrelationQueryEngine(makeDb([]));

    await expect(
      engine.query({ type: 'spatial_proximity', entityIds: ['radar|a', 'adsb|b'] }),
    ).rejects.toThrow(/requires a known position/i);
  });

  it('names the entities it could not locate', async () => {
    const store = new SemanticStore();
    store.setEntity('radar', 'a', { latitude: 40.0, longitude: -74.0 });
    const engine = new CorrelationQueryEngine(makeDb([]), undefined, store);

    await expect(
      engine.query({ type: 'spatial_proximity', entityIds: ['radar|a', 'adsb|b'] }),
    ).rejects.toThrow(/adsb\|b/);
  });

  it('computes real distance between co-located entities', async () => {
    const engine = new CorrelationQueryEngine(makeDb([]), undefined, positioned());

    const results = await engine.query({
      type: 'spatial_proximity',
      entityIds: ['radar|a', 'adsb|b'],
      spatialRadius: 1000,
    });

    expect(results).toHaveLength(1);
    const proximity = results[0].evidence.find((e) => e.type === 'spatial_proximity');
    expect(proximity?.details.distanceMeters).toBeGreaterThan(130);
    expect(proximity?.details.distanceMeters).toBeLessThan(150);
  });

  it('finds no correlation for entities outside the radius', async () => {
    const store = new SemanticStore();
    store.setEntity('radar', 'a', { latitude: 40.7128, longitude: -74.006 }); // New York
    store.setEntity('adsb', 'b', { latitude: 39.9526, longitude: -75.1652 }); // Philadelphia
    const engine = new CorrelationQueryEngine(makeDb([]), undefined, store);

    const results = await engine.query({
      type: 'spatial_proximity',
      entityIds: ['radar|a', 'adsb|b'],
      spatialRadius: 1000,
    });

    expect(results).toEqual([]);
  });

  it('does not score undated positions as simultaneous', async () => {
    const store = new SemanticStore();
    store.setEntity('radar', 'a', { latitude: 40.0, longitude: -74.0 });
    store.setEntity('adsb', 'b', { latitude: 40.001, longitude: -74.001 });
    const engine = new CorrelationQueryEngine(makeDb([]), undefined, store);

    const results = await engine.query({
      type: 'spatial_proximity',
      entityIds: ['radar|a', 'adsb|b'],
      spatialRadius: 1000,
    });

    expect(results[0].evidence.map((e) => e.type)).not.toContain('location_timing_proximity');
  });
});
