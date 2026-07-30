/**
 * @file AlertOrchestrator.ts
 * @description Advanced multi-source alert correlation and deduplication.
 * Intelligently routes, enriches, and aggregates alerts across the system.
 */

import { PrismaClient } from '@/generated/prisma';
import { SemanticStore } from '@/core/semantic/semanticStore';
import { levenshteinDistance } from '@/lib/utils/stringDistance';

export interface AlertInput {
  id: string;
  sourcePluginId: string;
  entityId: string;
  type: string; // 'threat', 'anomaly', 'fusion', 'threshold'
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface Alert {
  id: string;
  sourceAlertIds: string[]; // Deduplicated source IDs
  aggregatedCount: number; // How many alerts were merged
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  entityId: string;
  enrichedContext: Record<string, unknown>;
  createdAt: number;
  lastSeen: number;
  status: 'active' | 'escalated' | 'suppressed' | 'resolved';
  escalationLevel: number;
  routes: string[];
}

export interface AlertDeduplicationConfig {
  timeWindow: number; // ms to look back for similar alerts
  entityProximity: number; // km threshold
  similarityThreshold: number; // 0-1
}

export interface AlertRoute {
  name: string;
  condition: (alert: Alert) => boolean;
  targets: string[]; // 'slack', 'pagerduty', 'email', 'webhook'
  delayMs: number;
}

/**
 * Advanced alert orchestrator with deduplication and enrichment.
 */
export class AlertOrchestrator {
  private store: SemanticStore;
  private db: PrismaClient;
  private deduplicationConfig: AlertDeduplicationConfig = {
    timeWindow: 300000, // 5 minutes
    entityProximity: 10, // km
    similarityThreshold: 0.75,
  };
  private routes: AlertRoute[] = [];
  private tenantId?: string;

  constructor(store: SemanticStore, db: PrismaClient, tenantId?: string) {
    this.store = store;
    this.db = db;
    this.tenantId = tenantId;
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.routes = [
      {
        name: 'critical-immediate',
        condition: (alert) => alert.severity === 'critical' && alert.escalationLevel <= 2,
        targets: ['pagerduty', 'slack'],
        delayMs: 0,
      },
      {
        name: 'high-escalate',
        condition: (alert) => alert.severity === 'high' && alert.lastSeen - alert.createdAt > 60000,
        targets: ['slack', 'email'],
        delayMs: 30000,
      },
      {
        name: 'medium-batch',
        condition: (alert) => alert.severity === 'medium' && alert.aggregatedCount > 3,
        targets: ['slack'],
        delayMs: 60000,
      },
      {
        name: 'low-dashboard',
        condition: (alert) => alert.severity === 'low',
        targets: ['webhook'],
        delayMs: 300000,
      },
    ];
  }

  /**
   * Process incoming alert (with deduplication).
   */
  async ingestAlert(input: AlertInput): Promise<Alert> {
    // Validate severity enum
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(input.severity)) {
      throw new Error(`Invalid severity level: ${input.severity}. Must be one of: ${validSeverities.join(', ')}`);
    }

    // Check for duplicate/similar alerts
    const duplicate = await this.findDuplicate(input);

    if (duplicate) {
      // Merge with existing alert
      const sourceIds = JSON.parse(duplicate.sourceAlertIds);
      sourceIds.push(input.id);

      const updated = await this.db.alert.update({
        where: { id: duplicate.id },
        data: {
          sourceAlertIds: JSON.stringify(sourceIds),
          aggregatedCount: duplicate.aggregatedCount + 1,
          lastSeen: new Date(input.timestamp),
          escalationLevel: Math.min(3, duplicate.escalationLevel + 0.1),
        },
      });

      return this.dbAlertToModel(updated);
    }

    // Create new alert
    const alertModel: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sourceAlertIds: [input.id],
      aggregatedCount: 1,
      type: input.type,
      severity: input.severity,
      title: input.title,
      description: input.description,
      entityId: input.entityId,
      enrichedContext: input.context ?? {},
      createdAt: input.timestamp,
      lastSeen: input.timestamp,
      status: 'active',
      escalationLevel: this.getInitialEscalation(input.severity),
      routes: [],
    };

    // Enrich alert with semantic context
    try {
      await this.enrichAlert(alertModel);
    } catch (error) {
      console.error(`Failed to enrich alert ${alertModel.id}:`, error);
      // Continue without enrichment rather than failing the entire alert ingestion
    }

    // Determine routing
    alertModel.routes = this.determineRoutes(alertModel);

    // Store alert in database
    const dbAlert = await this.db.alert.create({
      data: {
        id: alertModel.id,
        tenantId: this.tenantId,
        sourceAlertIds: JSON.stringify(alertModel.sourceAlertIds),
        aggregatedCount: alertModel.aggregatedCount,
        type: alertModel.type,
        severity: alertModel.severity,
        title: alertModel.title,
        description: alertModel.description,
        sourcePluginId: input.sourcePluginId,
        entityId: alertModel.entityId,
        enrichedContext: JSON.stringify(alertModel.enrichedContext),
        status: alertModel.status,
        escalationLevel: alertModel.escalationLevel,
        routes: JSON.stringify(alertModel.routes),
        createdAt: new Date(alertModel.createdAt),
        lastSeen: new Date(alertModel.lastSeen),
      },
    });

    // Record creation event
    await this.db.alertEvent.create({
      data: {
        tenantId: this.tenantId,
        alertId: dbAlert.id,
        eventType: 'created',
      },
    });

    return this.dbAlertToModel(dbAlert);
  }

  /**
   * Convert database alert to model.
   */
  private dbAlertToModel(dbAlert: any): Alert {
    return {
      id: dbAlert.id,
      sourceAlertIds: JSON.parse(dbAlert.sourceAlertIds),
      aggregatedCount: dbAlert.aggregatedCount,
      type: dbAlert.type,
      severity: dbAlert.severity,
      title: dbAlert.title,
      description: dbAlert.description,
      entityId: dbAlert.entityId,
      enrichedContext: JSON.parse(dbAlert.enrichedContext),
      createdAt: dbAlert.createdAt.getTime(),
      lastSeen: dbAlert.lastSeen.getTime(),
      status: dbAlert.status as 'active' | 'escalated' | 'suppressed' | 'resolved',
      escalationLevel: dbAlert.escalationLevel,
      routes: JSON.parse(dbAlert.routes),
    };
  }

  /**
   * Find duplicate or similar alert within time window.
   */
  private async findDuplicate(input: AlertInput): Promise<any | null> {
    const timeWindowStart = new Date(input.timestamp - this.deduplicationConfig.timeWindow);

    // Query active alerts within time window
    const candidates = await this.db.alert.findMany({
      where: {
        tenantId: this.tenantId,
        status: 'active',
        lastSeen: {
          gte: timeWindowStart,
        },
      },
    });

    for (const dbAlert of candidates) {
      const alert = this.dbAlertToModel(dbAlert);

      // Same entity and type
      if (alert.entityId === input.entityId && alert.type === input.type) {
        // Check similarity
        const similarity = this.computeSimilarity(alert, input);
        if (similarity > this.deduplicationConfig.similarityThreshold) {
          return dbAlert;
        }
      }

      // Related entities nearby
      const proximity = this.computeProximity(alert.entityId, input.entityId);
      if (
        proximity < this.deduplicationConfig.entityProximity &&
        alert.type === input.type &&
        alert.severity === input.severity
      ) {
        const similarity = this.computeSimilarity(alert, input);
        if (similarity > this.deduplicationConfig.similarityThreshold) {
          return dbAlert;
        }
      }
    }

    return null;
  }

  /**
   * Compute string similarity (Levenshtein ratio).
   */
  private computeSimilarity(alert: Alert, input: AlertInput): number {
    const titleDist = levenshteinDistance(alert.title, input.title);
    const maxLen = Math.max(alert.title.length, input.title.length);
    return 1 - titleDist / (maxLen || 1);
  }

  /**
   * Compute distance between two entities.
   */
  private computeProximity(entityId1: string, entityId2: string): number {
    // Simplified - in production, query entity positions from store
    const [plugin1, id1] = entityId1.split('|');
    const [plugin2, id2] = entityId2.split('|');

    const entity1 = this.store.getEntity?.(plugin1, id1);
    const entity2 = this.store.getEntity?.(plugin2, id2);

    if (!entity1 || !entity2 || !entity1.latitude || !entity2.latitude || !entity1.longitude || !entity2.longitude) {
      return Infinity;
    }

    // Haversine distance
    const R = 6371; // km
    const dLat = ((entity2.latitude - entity1.latitude) * Math.PI) / 180;
    const dLon = ((entity2.longitude - entity1.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((entity1.latitude * Math.PI) / 180) *
        Math.cos((entity2.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Enrich alert with semantic context.
   */
  private async enrichAlert(alert: Alert): Promise<void> {
    const [pluginId, entityId] = alert.entityId.split('|');

    // Fetch all enrichment data in parallel
    const [classification, threat, relationships] = await Promise.all([
      Promise.resolve(this.store.getClassification?.(pluginId, entityId)),
      Promise.resolve(this.store.getThreatAssessment?.(pluginId, entityId)),
      Promise.resolve(this.store.getRelationshipsFrom?.(pluginId, entityId)),
    ]);

    if (classification) {
      alert.enrichedContext.entityType = classification.type;
      alert.enrichedContext.disposition = classification.disposition;
    }

    if (threat) {
      alert.enrichedContext.threatLevel = threat.threatLevel;
      alert.enrichedContext.hostilityScore = threat.hostilityScore;
    }

    if (relationships) {
      alert.enrichedContext.relatedEntities = relationships.map((r) => r.targetId);
    }
  }

  /**
   * Determine routing targets for alert.
   */
  private determineRoutes(alert: Alert): string[] {
    const routes = new Set<string>();

    for (const route of this.routes) {
      if (route.condition(alert)) {
        for (const target of route.targets) {
          routes.add(target);
        }
      }
    }

    return Array.from(routes);
  }

  private getInitialEscalation(severity: string): number {
    switch (severity) {
      case 'critical':
        return 2;
      case 'high':
        return 1.5;
      case 'medium':
        return 1;
      case 'low':
      default:
        return 0;
    }
  }

  /**
   * Resolve an active alert.
   */
  async resolveAlert(alertId: string): Promise<void> {
    await this.db.alert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    await this.db.alertEvent.create({
      data: {
        tenantId: this.tenantId,
        alertId,
        eventType: 'resolved',
      },
    });
  }

  /**
   * Suppress an alert temporarily.
   */
  async suppressAlert(alertId: string, durationMs: number): Promise<void> {
    const suppressedUntil = new Date(Date.now() + durationMs);

    await this.db.alert.update({
      where: { id: alertId },
      data: {
        status: 'suppressed',
        suppressedUntil,
      },
    });

    await this.db.alertEvent.create({
      data: {
        tenantId: this.tenantId,
        alertId,
        eventType: 'suppressed',
        eventData: JSON.stringify({ durationMs, suppressedUntil }),
      },
    });

    // Schedule re-activation after duration
    setTimeout(async () => {
      try {
        const alert = await this.db.alert.findUnique({ where: { id: alertId } });
        if (alert && alert.status === 'suppressed') {
          await this.db.alert.update({
            where: { id: alertId },
            data: { status: 'active' },
          });
        }
      } catch (error) {
        console.error(`Failed to reactivate alert ${alertId}:`, error);
      }
    }, durationMs);
  }

  /**
   * Get active alerts.
   */
  async getActiveAlerts(severity?: string): Promise<Alert[]> {
    const alerts = await this.db.alert.findMany({
      where: {
        tenantId: this.tenantId,
        status: 'active',
        severity: severity ? severity : undefined,
      },
      orderBy: [
        { severity: 'asc' },
        { lastSeen: 'desc' },
      ],
    });

    return alerts.map((a) => this.dbAlertToModel(a));
  }

  /**
   * Get alert statistics.
   */
  async getStats(): Promise<{
    activeCount: number;
    criticalCount: number;
    highCount: number;
    totalDeduplicatedFrom: number;
  }> {
    const alerts = await this.db.alert.findMany({
      where: {
        tenantId: this.tenantId,
        status: 'active',
      },
    });

    let totalDeduplicatedFrom = 0;
    let criticalCount = 0;
    let highCount = 0;

    for (const alert of alerts) {
      const sourceIds = JSON.parse(alert.sourceAlertIds);
      totalDeduplicatedFrom += sourceIds.length - 1;
      if (alert.severity === 'critical') criticalCount++;
      if (alert.severity === 'high') highCount++;
    }

    return {
      activeCount: alerts.length,
      criticalCount,
      highCount,
      totalDeduplicatedFrom,
    };
  }
}
