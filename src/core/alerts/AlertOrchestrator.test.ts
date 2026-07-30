/**
 * @file AlertOrchestrator.test.ts
 * @description Unit tests for AlertOrchestrator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { AlertOrchestrator, AlertInput } from './AlertOrchestrator';
import { SemanticStore } from '@/core/semantic/semanticStore';

/**
 * In-memory stand-in for the Prisma alert tables. Only the surface the
 * orchestrator touches is implemented: alert.create/findMany/findUnique/update
 * and alertEvent.create.
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
    },
    alertEvent: {
      create: vi.fn(async () => ({})),
    },
  };
}

describe('AlertOrchestrator', () => {
  let orchestrator: AlertOrchestrator;
  let mockStore: Partial<SemanticStore>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockStore = {
      getClassification: vi.fn(() => ({
        type: 'ip-address',
        disposition: 'suspicious',
      })),
      getThreatAssessment: vi.fn(() => ({
        threatLevel: 'high',
        hostilityScore: 0.8,
      })),
      getRelationshipsFrom: vi.fn(() => [
        { targetId: 'entity-2', type: 'communicates-with' },
      ]),
      getEntity: vi.fn((plugin: string, id: string) => ({
        id: `${plugin}|${id}`,
        latitude: 40.7128,
        longitude: -74.006,
      })),
    };

    mockDb = createMockDb();
    orchestrator = new AlertOrchestrator(mockStore as SemanticStore, mockDb as unknown as PrismaClient);
  });

  describe('ingestAlert', () => {
    it('should create new alert with valid input', async () => {
      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(input);

      expect(alert).toBeDefined();
      expect(alert.sourceAlertIds).toContain('alert-1');
      expect(alert.severity).toBe('high');
      expect(alert.status).toBe('active');
      expect(alert.aggregatedCount).toBe(1);
    });

    it('should reject invalid severity levels', async () => {
      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'extreme' as any,
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: Date.now(),
      };

      await expect(orchestrator.ingestAlert(input)).rejects.toThrow('Invalid severity level');
    });

    it('should deduplicate similar alerts within time window', async () => {
      const now = Date.now();
      const input1: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: now,
      };

      const input2: AlertInput = {
        id: 'alert-2',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: now + 1000,
      };

      const alert1 = await orchestrator.ingestAlert(input1);
      const alert2 = await orchestrator.ingestAlert(input2);

      expect(alert1.id).toBe(alert2.id);
      expect(alert2.aggregatedCount).toBe(2);
      expect(alert2.sourceAlertIds).toEqual(['alert-1', 'alert-2']);
    });

    it('should enrich alert with semantic context', async () => {
      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(input);

      expect(alert.enrichedContext.entityType).toBe('ip-address');
      expect(alert.enrichedContext.disposition).toBe('suspicious');
      expect(alert.enrichedContext.threatLevel).toBe('high');
      expect(alert.enrichedContext.relatedEntities).toContain('entity-2');
    });

    it('should determine routes based on severity and escalation', async () => {
      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'critical',
        title: 'Critical Threat',
        description: 'Critical threat detected',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(input);

      expect(alert.routes).toContain('pagerduty');
      expect(alert.routes).toContain('slack');
    });

    it('should handle enrichment failure gracefully', async () => {
      mockStore.getClassification = vi.fn(() => {
        throw new Error('Store unavailable');
      });

      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(input);
      expect(alert).toBeDefined();
      expect(alert.status).toBe('active');
    });
  });

  describe('deduplication', () => {
    it('should compute proximity using haversine distance', async () => {
      mockStore.getEntity = vi.fn((plugin: string, id: string) => {
        if (id === 'entity-1') {
          return {
            id: `${plugin}|${id}`,
            latitude: 40.7128,
            longitude: -74.006,
          };
        }
        return {
          id: `${plugin}|${id}`,
          latitude: 40.7489,
          longitude: -73.968,
        };
      });

      const input1: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Activity A',
        description: 'Activity description',
        timestamp: Date.now(),
      };

      const input2: AlertInput = {
        id: 'alert-2',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-2',
        type: 'threat',
        severity: 'high',
        title: 'Activity A',
        description: 'Activity description',
        timestamp: Date.now() + 1000,
      };

      const alert1 = await orchestrator.ingestAlert(input1);
      const alert2 = await orchestrator.ingestAlert(input2);

      // Should deduplicate if proximity < 10km and similarity > 0.75
      expect(alert1.id).toBe(alert2.id);
    });

    it('should return Infinity for missing coordinates', async () => {
      mockStore.getEntity = vi.fn(() => ({
        id: 'entity-1',
        latitude: 40.7128,
        // Missing longitude
      }));

      const input1: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Activity A',
        description: 'Activity description',
        timestamp: Date.now(),
      };

      const input2: AlertInput = {
        id: 'alert-2',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-2',
        type: 'threat',
        severity: 'high',
        title: 'Activity A',
        description: 'Activity description',
        timestamp: Date.now() + 1000,
      };

      const alert1 = await orchestrator.ingestAlert(input1);
      const alert2 = await orchestrator.ingestAlert(input2);

      // Should NOT deduplicate without valid coordinates
      expect(alert1.id).not.toBe(alert2.id);
    });
  });

  describe('alert management', () => {
    it('should resolve alerts', async () => {
      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(input);
      await orchestrator.resolveAlert(alert.id);

      const active = await orchestrator.getActiveAlerts();
      expect(active).not.toContainEqual(expect.objectContaining({ id: alert.id }));
    });

    it('should suppress alerts temporarily', async () => {
      const input: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'high',
        title: 'Suspicious Activity',
        description: 'Entity exhibited suspicious behavior',
        timestamp: Date.now(),
      };

      const alert = await orchestrator.ingestAlert(input);
      await orchestrator.suppressAlert(alert.id, 100);

      let active = await orchestrator.getActiveAlerts();
      expect(active).not.toContainEqual(expect.objectContaining({ id: alert.id }));

      await new Promise((resolve) => setTimeout(resolve, 150));

      active = await orchestrator.getActiveAlerts();
      expect(active).toContainEqual(expect.objectContaining({ id: alert.id }));
    });

    it('should retrieve active alerts filtered by severity', async () => {
      const input1: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'critical',
        title: 'Critical Alert',
        description: 'Critical activity',
        timestamp: Date.now(),
      };

      const input2: AlertInput = {
        id: 'alert-2',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-2',
        type: 'threat',
        severity: 'low',
        title: 'Low Alert',
        description: 'Low activity',
        timestamp: Date.now(),
      };

      await orchestrator.ingestAlert(input1);
      await orchestrator.ingestAlert(input2);

      const critical = await orchestrator.getActiveAlerts('critical');
      expect(critical).toHaveLength(1);
      expect(critical[0].severity).toBe('critical');
    });

    it('should compute statistics', async () => {
      const input1: AlertInput = {
        id: 'alert-1',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'critical',
        title: 'Critical Alert',
        description: 'Critical activity',
        timestamp: Date.now(),
      };

      const input2: AlertInput = {
        id: 'alert-2',
        sourcePluginId: 'plugin-1',
        entityId: 'plugin-1|entity-1',
        type: 'threat',
        severity: 'critical',
        title: 'Critical Alert',
        description: 'Critical activity',
        timestamp: Date.now() + 1000,
      };

      await orchestrator.ingestAlert(input1);
      await orchestrator.ingestAlert(input2);

      const stats = await orchestrator.getStats();
      expect(stats.activeCount).toBe(1);
      expect(stats.criticalCount).toBe(1);
      expect(stats.totalDeduplicatedFrom).toBe(1); // 2 alerts merged into 1
    });
  });
});
