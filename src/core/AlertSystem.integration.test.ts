/**
 * @file AlertSystem.integration.test.ts
 * @description Integration tests for Phase 5a-5b alert system.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { AlertOrchestrator } from '@/core/alerts/AlertOrchestrator';
import { AnomalyDetectionEngine, EntityBehavior } from '@/core/ml/AnomalyDetectionEngine';
import { AlertRouter } from '@/core/alerts/AlertRouter';
import { SemanticStore } from '@/core/semantic/semanticStore';

/**
 * In-memory stand-in for the Prisma alert tables. Records are persisted across
 * calls so deduplication, suppression and stats queries see real state.
 */
function createMockDb() {
  const alerts = new Map<string, any>();

  return {
    alert: {
      create: vi.fn(async ({ data }: any) => {
        alerts.set(data.id, { ...data });
        return { ...alerts.get(data.id) };
      }),
      findMany: vi.fn(async ({ where = {} }: any = {}) =>
        Array.from(alerts.values())
          .filter((a) => {
            if (where.tenantId !== undefined && a.tenantId !== where.tenantId) return false;
            if (where.status !== undefined && a.status !== where.status) return false;
            if (where.severity !== undefined && a.severity !== where.severity) return false;
            if (where.lastSeen?.gte && a.lastSeen < where.lastSeen.gte) return false;
            return true;
          })
          .map((a) => ({ ...a })),
      ),
      findUnique: vi.fn(async ({ where }: any) => (alerts.has(where.id) ? { ...alerts.get(where.id) } : null)),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = alerts.get(where.id);
        if (!existing) throw new Error(`Alert not found: ${where.id}`);
        Object.assign(existing, data);
        return { ...existing };
      }),
      count: vi.fn(async () => alerts.size),
    },
    alertEvent: {
      create: vi.fn(async () => ({})),
    },
  };
}

describe('Alert System Integration (Phase 5a-5b)', () => {
  let orchestrator: AlertOrchestrator;
  let anomalyEngine: AnomalyDetectionEngine;
  let alertRouter: AlertRouter;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockStore: Partial<SemanticStore>;

  beforeEach(() => {
    mockDb = createMockDb();

    // Mock semantic store
    mockStore = {
      getEntity: vi.fn(() => ({
        id: 'plugin-1|entity-1',
        latitude: 40.7128,
        longitude: -74.006,
      })),
      getClassification: vi.fn(() => ({
        entityPluginId: 'plugin-1',
        entityId: 'entity-1',
        type: 'network_node' as const,
        domain: 'cyber' as const,
        disposition: 'hostile' as const,
        confidence: 0.9,
        classifiedAt: Date.now(),
      })),
      getThreatAssessment: vi.fn(() => ({
        threatLevel: 'high',
        hostilityScore: 0.8,
        proximityScore: 0.5,
      })),
      getRelationshipsFrom: vi.fn(() => []),
    };

    orchestrator = new AlertOrchestrator(mockStore as SemanticStore, mockDb as unknown as PrismaClient, 'tenant-1');
    anomalyEngine = new AnomalyDetectionEngine(mockStore as SemanticStore);
    alertRouter = new AlertRouter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('End-to-end alert flow', () => {
    it('should flow from anomaly detection to alert creation to routing', async () => {
      // Step 1: Record normal behavior
      const normalBehaviors: EntityBehavior[] = [];
      for (let i = 0; i < 100; i++) {
        normalBehaviors.push({
          entityId: 'entity-1',
          pluginId: 'plugin-1',
          timestamp: Date.now() - (100 - i) * 1000,
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

      normalBehaviors.forEach((b) => anomalyEngine.recordBehavior(b));
      anomalyEngine.trainModel();

      // Step 2: Detect anomaly
      const anomalousBehavior: EntityBehavior = {
        entityId: 'entity-1',
        pluginId: 'plugin-1',
        timestamp: Date.now(),
        features: {
          speed: 2000,
          acceleration: 600,
          heading: 45,
          headingChange: 120,
          proximity: 0.3,
          activityLevel: 0.9,
          deviceAnomalyCount: 5,
        },
      };

      const anomalyScores = anomalyEngine.detectAnomalies([anomalousBehavior]);
      const normalScores = anomalyEngine.detectAnomalies([normalBehaviors[normalBehaviors.length - 1]]);

      expect(anomalyScores).toHaveLength(1);
      // The engine combines ml 0.6 / baseline 0.4. With the isolation-forest
      // score normalised by c(psi) the ml term carries real weight, so a
      // saturated outlier lands in 'high' — under the old normalizer() === 1
      // the ml term was ~0.06 and the same outlier read 'medium'.
      expect(anomalyScores[0].baselineDeviation).toBeGreaterThan(0.8);
      expect(anomalyScores[0].score).toBeGreaterThan(normalScores[0].score);
      expect(anomalyScores[0].severity).toBe('high');

      // Step 3: Create alert from anomaly
      const alertInput = {
        id: `anomaly-${Date.now()}`,
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'anomaly',
        severity: 'high' as const,
        title: 'Extreme Speed & Acceleration',
        description: `Entity speed jumped to ${anomalousBehavior.features.speed} (normal: 100), acceleration ${anomalousBehavior.features.acceleration} (normal: 50)`,
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(alertInput);
      expect(alert).toBeDefined();
      expect(alert.severity).toBe('high');
      expect(alert.enrichedContext.threatLevel).toBe('high');

      // Step 4: Route alert. A freshly created 'high' alert has no immediate
      // targets - the 'high-escalate' rule only fires once the alert has aged
      // past 60s - so the router is asked for (and returns) zero deliveries.
      expect(alert.routes).toEqual([]);

      const routeResults = await alertRouter.routeAlert(alert.id, alert.routes, {
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        entityId: alert.entityId,
        enrichedContext: alert.enrichedContext,
      });

      expect(routeResults).toHaveLength(alert.routes.length);
      expect(routeResults.every((r) => r.success || Boolean(r.error))).toBe(true);
    });

    it('should handle deduplication in alert flow', async () => {
      const now = Date.now();

      // Create two similar anomalies within time window
      const input1 = {
        id: `anomaly-1`,
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'anomaly',
        severity: 'high' as const,
        title: 'Suspicious Speed',
        description: 'Entity speed abnormally high',
        timestamp: now,
      };

      const input2 = {
        id: `anomaly-2`,
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'anomaly',
        severity: 'high' as const,
        title: 'Suspicious Speed',
        description: 'Entity speed abnormally high',
        timestamp: now + 1000,
      };

      const alert1 = await orchestrator.ingestAlert(input1);
      const alert2 = await orchestrator.ingestAlert(input2);

      // Should be deduplicated
      expect(alert1.id).toBe(alert2.id);
      expect(alert2.aggregatedCount).toBe(2);
      expect(alert2.sourceAlertIds).toEqual([input1.id, input2.id]);
    });

    it('should track alert lifecycle with events', async () => {
      const alertInput = {
        id: `test-alert-${Date.now()}`,
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'critical' as const,
        title: 'Critical Threat',
        description: 'Immediate threat to infrastructure',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(alertInput);

      // Verify alert was created
      expect(alert.status).toBe('active');
      expect(alert.escalationLevel).toBe(2); // Critical initial escalation

      // Suppress alert
      await orchestrator.suppressAlert(alert.id, 3600000);

      // Get stats
      const stats = await orchestrator.getStats();
      expect(stats).toHaveProperty('activeCount');
      expect(stats).toHaveProperty('criticalCount');
      expect(stats).toHaveProperty('totalDeduplicatedFrom');
    });

    it('should integrate with threat assessment for routing decisions', async () => {
      // Create alert with different threat levels
      const threatyAlert = {
        id: `threat-${Date.now()}`,
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'critical' as const,
        title: 'Hostile Actor Detected',
        description: 'High-confidence hostile intent indicators',
        context: {
          threatLevel: 'critical',
          hostilityScore: 0.95,
          indicators: ['command_and_control', 'data_exfiltration'],
        },
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(threatyAlert);

      // Critical + high threat should route to PagerDuty + Slack
      expect(alert.routes).toContain('pagerduty');
      expect(alert.routes).toContain('slack');
    });

    it('should recover from enrichment failures gracefully', async () => {
      // Mock enrichment failure
      const mockStoreWithError: Partial<SemanticStore> = {
        getClassification: vi.fn(() => {
          throw new Error('Store unavailable');
        }),
        getThreatAssessment: vi.fn(() => null),
        getRelationshipsFrom: vi.fn(() => []),
      };

      const orchestratorWithError = new AlertOrchestrator(
        mockStoreWithError as SemanticStore,
        mockDb as unknown as PrismaClient,
        'tenant-1',
      );

      const alertInput = {
        id: `fallback-${Date.now()}`,
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'anomaly',
        severity: 'medium' as const,
        title: 'Moderate Anomaly',
        description: 'Baseline deviation detected',
        timestamp: Date.now(),
      };

      const alert = await orchestratorWithError.ingestAlert(alertInput);

      // Should still create alert despite enrichment failure
      expect(alert).toBeDefined();
      expect(alert.status).toBe('active');
      expect(alert.enrichedContext).toBeDefined();
    });
  });

  describe('Performance characteristics', () => {
    it('should ingest alerts under 50ms', async () => {
      const startTime = performance.now();

      for (let i = 0; i < 10; i++) {
        await orchestrator.ingestAlert({
          id: `perf-test-${i}`,
          sourcePluginId: 'plugin-1',
          entityId: 'plugin-1|entity-1',
          type: 'anomaly',
          severity: 'low',
          title: `Anomaly ${i}`,
          description: 'Test anomaly',
          timestamp: Date.now() + i * 1000,
        });
      }

      const duration = performance.now() - startTime;
      expect(duration / 10).toBeLessThan(50); // Average per alert
    });

    it('should detect anomalies efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        anomalyEngine.recordBehavior({
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

      anomalyEngine.trainModel();

      const behaviors = [];
      for (let i = 0; i < 50; i++) {
        behaviors.push({
          entityId: 'entity-0',
          pluginId: 'plugin-1',
          timestamp: Date.now() + 100000 + i * 100,
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

      const scores = anomalyEngine.detectAnomalies(behaviors);

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(500); // Full flow under 500ms
      expect(scores).toHaveLength(50);
    });
  });
});
