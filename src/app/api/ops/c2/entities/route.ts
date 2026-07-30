import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Shape stored (as JSON) in `Alert.enrichedContext` by the C2 interface.
 */
type EntityContext = {
  provenance?: string;
  ontology?: string;
  capabilities?: string[];
  platformType?: string;
};

/** `Alert.enrichedContext` is a JSON string column — parse defensively. */
function parseEntityContext(raw: string): EntityContext {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as EntityContext) : {};
  } catch {
    return {};
  }
}

/**
 * GET /api/ops/c2/entities
 * List entities with filtering and sorting.
 *
 * Query parameters:
 * - search: search by name or entity ID
 * - status: filter by status
 * - ontology: filter by ontology
 * - capability: filter by capability
 * - sortBy: field to sort by (name, status, threatLevel)
 * - sortOrder: asc or desc
 * - limit: max results (default 100)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status');
    const ontology = searchParams.get('ontology');
    const capability = searchParams.get('capability');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

    // Fetch alerts to build entity view
    const alerts = await prisma.alert.findMany({
      where: {
        AND: [
          search ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { entityId: { contains: search, mode: 'insensitive' } },
            ],
          } : {},
        ],
      },
      select: {
        entityId: true,
        title: true,
        severity: true,
        type: true,
        createdAt: true,
        enrichedContext: true,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    // Build entity list from alerts
    const entityMap = new Map();

    for (const alert of alerts) {
      if (!entityMap.has(alert.entityId)) {
        const context = parseEntityContext(alert.enrichedContext);

        entityMap.set(alert.entityId, {
          id: alert.entityId,
          name: alert.title || alert.entityId,
          entityId: alert.entityId,
          status: mapSeverityToStatus(alert.severity),
          provenance: context.provenance || 'system',
          ontology: context.ontology || 'UNKNOWN',
          capabilities: context.capabilities || [],
          platformType: context.platformType || 'UNKNOWN',
          threatLevel: mapSeverityToThreatLevel(alert.severity),
          lastUpdated: alert.createdAt.getTime(),
          checks: 0,
        });
      }
    }

    const entities = Array.from(entityMap.values());

    return NextResponse.json({
      success: true,
      data: entities,
      pagination: {
        total: entities.length,
        limit,
      },
    });
  } catch (error) {
    console.error('Entity listing error:', error);
    return NextResponse.json({ error: 'Failed to list entities' }, { status: 500 });
  }
}

/**
 * POST /api/ops/c2/entities
 * Create new entity.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, entityId, platformType, ontology, capabilities } = body;

    if (!name || !entityId || !platformType) {
      return NextResponse.json(
        { error: 'Missing required fields: name, entityId, platformType' },
        { status: 400 },
      );
    }

    // Create as alert for now (would be entity table in production)
    const alert = await prisma.alert.create({
      data: {
        title: name,
        entityId,
        severity: 'low',
        type: 'system',
        sourcePluginId: 'c2',
        description: `Created via C2 interface: ${name}`,
        // sourceAlertIds / routes / enrichedContext are JSON string columns.
        sourceAlertIds: JSON.stringify([]),
        routes: JSON.stringify([]),
        enrichedContext: JSON.stringify({
          platformType,
          ontology,
          capabilities,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: alert.entityId,
        name,
        entityId,
        platformType,
        ontology,
        capabilities,
      },
    });
  } catch (error) {
    console.error('Entity creation error:', error);
    return NextResponse.json({ error: 'Failed to create entity' }, { status: 500 });
  }
}

/**
 * DELETE /api/ops/c2/entities
 * Delete entities by ID.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityIds } = body;

    if (!Array.isArray(entityIds)) {
      return NextResponse.json(
        { error: 'entityIds must be an array' },
        { status: 400 },
      );
    }

    // Mark alerts as resolved (soft delete)
    const updated = await prisma.alert.updateMany({
      where: {
        entityId: { in: entityIds },
      },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: updated.count,
    });
  } catch (error) {
    console.error('Entity deletion error:', error);
    return NextResponse.json({ error: 'Failed to delete entities' }, { status: 500 });
  }
}

// Helper functions
function mapSeverityToStatus(severity: string): 'online' | 'offline' | 'error' | 'unknown' | 'live' | 'degraded' {
  switch (severity) {
    case 'critical': return 'error';
    case 'high': return 'degraded';
    case 'medium': return 'online';
    case 'low': return 'live';
    default: return 'unknown';
  }
}

function mapSeverityToThreatLevel(severity: string): number {
  const map: Record<string, number> = {
    critical: 0.95,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  };
  return map[severity] || 0;
}
