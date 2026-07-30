/**
 * @file src/app/api/agent/semantic-query/route.ts
 * @description API endpoint for semantic entity queries.
 * Agents call this endpoint to execute semantic queries (find by type, relationships, etc.)
 *
 * Auth: Same session-cookie gate as /api/agent/stream
 */

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantId } from '@/lib/ops/session';
import { SemanticQueryEngine } from '@/core/semantic/queryEngine';
import { getGlobalSemanticStore } from '@/core/semantic';
import type {
  SemanticQuery,
  ThreatAssessmentQuery,
  AggregateContextQuery,
  FindPathQuery,
} from '@/core/semantic/queryTypes';

/**
 * POST /api/agent/semantic-query
 *
 * Execute a semantic query against the entity store.
 * Query types:
 *   - find_by_type: Find entities matching type filters
 *   - query_relationships: Traverse relationships from a source
 *   - spatial_semantic: Find entities in geographic radius with semantic filters
 *   - threat_assessment: Analyze threat level of an entity
 *   - aggregate_context: Get all related assets and threat landscape
 *   - find_path: Find shortest relationship path between entities
 *
 * Auth: Authenticated user session (same as /api/agent/publish)
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Body must be a query object' },
      { status: 400 },
    );
  }

  const query = body as SemanticQuery;

  // Validate query has a type field
  if (!('type' in query) || !query.type) {
    return NextResponse.json(
      { error: 'Query must have a "type" field' },
      { status: 400 },
    );
  }

  try {
    const store = getGlobalSemanticStore(await getTenantId());
    const engine = new SemanticQueryEngine(store);

    // Route to appropriate handler based on query type
    switch (query.type) {
      case 'find_by_type':
      case 'query_relationships':
      case 'spatial_semantic': {
        const result = await engine.execute(query);
        return NextResponse.json(result);
      }

      case 'threat_assessment': {
        const threatQuery = query as ThreatAssessmentQuery;
        const result = engine.assessThreat(threatQuery);
        return NextResponse.json({
          success: true,
          query,
          result,
        });
      }

      case 'aggregate_context': {
        const ctxQuery = query as AggregateContextQuery;
        const result = engine.aggregateContext(ctxQuery);
        return NextResponse.json({
          success: true,
          query,
          result,
        });
      }

      case 'find_path': {
        const pathQuery = query as FindPathQuery;
        const result = engine.findPath(pathQuery);
        return NextResponse.json({
          success: true,
          query,
          result,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown query type: ${(query as any).type}` },
          { status: 400 },
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Query execution failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/agent/semantic-query
 *
 * Returns available semantic query tools and their schemas.
 * Agents use this to discover what queries they can execute.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    tools: [
      {
        name: 'find_entities_by_type',
        description: 'Find entities by type and filters (aircraft, maritime, etc.)',
      },
      {
        name: 'query_relationships',
        description: 'Find related entities via semantic relationships',
      },
      {
        name: 'spatial_semantic_query',
        description: 'Find entities in geographic radius with semantic filters',
      },
      {
        name: 'assess_threat',
        description: 'Analyze threat level of an entity',
      },
      {
        name: 'aggregate_context',
        description: 'Get comprehensive context for an entity',
      },
      {
        name: 'find_relationship_path',
        description: 'Find relationship path between two entities',
      },
    ],
  });
}
