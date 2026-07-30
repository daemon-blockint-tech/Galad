/**
 * @file PredictiveQueryEngine.test.ts
 * @description estimateResolutionTime used to fall back to a hardcoded 24h
 * average when an entity had no resolved alerts, and presented it as a measured
 * ETA ("Expected resolution in ~24 hours") with a 0.5 confidence. An absence of
 * measurement has to look like one.
 */

import { describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma';
import { AnomalyDetectionEngine } from '@/core/ml/AnomalyDetectionEngine';
import { SemanticStore } from '@/core/semantic/semanticStore';

import { PredictiveQueryEngine } from './PredictiveQueryEngine';

interface FakeAlert {
  createdAt: Date;
  resolvedAt?: Date;
  severity: string;
}

function makeEngine(alerts: FakeAlert[]): PredictiveQueryEngine {
  const db = {
    alert: {
      findMany: () => Promise.resolve(alerts),
    },
  } as unknown as PrismaClient;

  return new PredictiveQueryEngine(db, new AnomalyDetectionEngine(new SemanticStore()));
}

const HOUR = 60 * 60 * 1000;

describe('PredictiveQueryEngine eta_resolution', () => {
  it('reports insufficient data instead of a 24-hour ETA when nothing has been resolved', async () => {
    const results = await makeEngine([]).query({
      type: 'eta_resolution',
      entityIds: ['radar|a'],
      horizon: 24 * HOUR,
    });

    expect(results).toHaveLength(1);
    expect(results[0].insufficientData).toBe(true);
    expect(results[0].forecast).toEqual([]);
    expect(results[0].riskLevel).toBe('unknown');
    expect(results[0].trend).toBe('unknown');
    expect(results[0].recommendations.join(' ')).not.toMatch(/~\d+ hours/);
    expect(results[0].recommendations.join(' ')).toMatch(/cannot be estimated/i);
  });

  it('forecasts from real resolution history when it exists', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const results = await makeEngine([
      { createdAt: created, resolvedAt: new Date(created.getTime() + 4 * HOUR), severity: 'high' },
      { createdAt: created, resolvedAt: new Date(created.getTime() + 6 * HOUR), severity: 'high' },
    ]).query({
      type: 'eta_resolution',
      entityIds: ['radar|a'],
      horizon: 24 * HOUR,
    });

    expect(results[0].insufficientData).toBeUndefined();
    // Mean of 4h and 6h.
    expect(results[0].recommendations[0]).toContain('~5 hours');
    expect(results[0].forecast.length).toBeGreaterThan(0);
  });
});

describe('PredictiveQueryEngine threat_escalation', () => {
  it('reports insufficient data rather than a 70%-confident flat forecast', async () => {
    const results = await makeEngine([
      { createdAt: new Date('2026-01-01T00:00:00Z'), severity: 'critical' },
    ]).query({
      type: 'threat_escalation',
      entityIds: ['radar|a'],
      horizon: 24 * HOUR,
    });

    expect(results[0].insufficientData).toBe(true);
    expect(results[0].forecast).toEqual([]);
    expect(results[0].riskLevel).toBe('unknown');
  });
});
