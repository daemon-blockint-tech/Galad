import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { CorrelationQueryEngine } from '@/core/query/CorrelationQueryEngine';
import { getOpsUserId } from '@/lib/ops/session';
import { getGlobalSemanticStore } from '@/core/semantic/semanticStore';

const correlationEngine = new CorrelationQueryEngine(prisma, undefined, getGlobalSemanticStore());

/**
 * POST /api/ops/correlations
 * Analyze correlations between entities.
 *
 * Request body:
 * {
 *   type: 'threat_correlation' | 'temporal_alignment' | 'spatial_proximity' | 'entity_fusion',
 *   entityIds: string[],
 *   timeWindow?: number,
 *   spatialRadius?: number,
 *   threshold?: number
 * }
 */
export async function POST(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, entityIds, timeWindow, spatialRadius, threshold } = body;

    if (!type || !entityIds || !Array.isArray(entityIds) || entityIds.length < 2) {
      return NextResponse.json(
        { error: 'Missing or invalid: type, entityIds (must be array with at least 2 entities)' },
        { status: 400 },
      );
    }

    const validTypes = ['threat_correlation', 'temporal_alignment', 'spatial_proximity', 'entity_fusion'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 },
      );
    }

    const results = await correlationEngine.query({
      type,
      entityIds,
      timeWindow: timeWindow || undefined,
      spatialRadius: spatialRadius || undefined,
      threshold: threshold || 0.5,
    });

    return NextResponse.json({
      success: true,
      type,
      entityCount: entityIds.length,
      correlationCount: results.length,
      data: results,
    });
  } catch (error) {
    console.error('Correlation API error:', error);
    return NextResponse.json(
      { error: 'Correlation analysis failed' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ops/correlations
 * Get correlation analysis for specific entities (as query params).
 *
 * Query parameters:
 * - entityIds: comma-separated entity IDs
 * - type: correlation type
 * - threshold: correlation threshold (0-1)
 */
export async function GET(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const entityIdsParam = searchParams.get('entityIds');
    const type = searchParams.get('type') || 'threat_correlation';
    const threshold = parseFloat(searchParams.get('threshold') || '0.5');

    if (!entityIdsParam) {
      return NextResponse.json(
        { error: 'Missing entityIds query parameter' },
        { status: 400 },
      );
    }

    const entityIds = entityIdsParam.split(',').filter((id) => id.trim());
    if (entityIds.length < 2) {
      return NextResponse.json(
        { error: 'Must specify at least 2 entity IDs' },
        { status: 400 },
      );
    }

    const results = await correlationEngine.query({
      type: type as any,
      entityIds,
      threshold,
    });

    return NextResponse.json({
      success: true,
      type,
      entityCount: entityIds.length,
      correlationCount: results.length,
      data: results,
    });
  } catch (error) {
    console.error('Correlation API error:', error);
    return NextResponse.json(
      { error: 'Correlation analysis failed' },
      { status: 500 },
    );
  }
}
