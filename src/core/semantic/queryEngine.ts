/**
 * @file queryEngine.ts
 * @description Semantic query execution engine.
 * Executes queries like "find all friendly aircraft" and returns classified entity results.
 */

import type {
  EntityDomain,
  Disposition,
  Confidence,
  EntityType,
} from '@maven-system/plugin-sdk';
import { SemanticStore } from './semanticStore';
import { OntologyGraph } from './ontologyGraph';
import { getEntityPosition, haversineDistanceKm } from './geo';
import type {
  SemanticQuery,
  QueryResult,
  QueryResultEntity,
  ThreatAssessmentResult,
  ContextAggregationResult,
  PathFindingResult,
  FindByTypeQuery,
  QueryRelationshipsQuery,
  SpatialSemanticQuery,
  ThreatAssessmentQuery,
  AggregateContextQuery,
  FindPathQuery,
} from './queryTypes';

/**
 * Semantic Query Engine: executes queries over the semantic layer.
 * Bridges agent questions ("find friendly aircraft") to entity results.
 */
export class SemanticQueryEngine {
  private store: SemanticStore;
  private graph: OntologyGraph;

  constructor(store: SemanticStore) {
    this.store = store;
    this.graph = new OntologyGraph(store);
  }

  /**
   * Execute a semantic query and return typed results.
   */
  async execute(query: SemanticQuery): Promise<QueryResult> {
    const startTime = Date.now();

    try {
      switch (query.type) {
        case 'find_by_type':
          return this.findByType(query, startTime);
        case 'query_relationships':
          return this.queryRelationships(query, startTime);
        case 'spatial_semantic':
          return this.spatialSemanticSearch(query, startTime);
        case 'threat_assessment':
          // threat_assessment handled separately
          throw new Error('Use assessThreat() for threat_assessment queries');
        case 'aggregate_context':
          // context aggregation handled separately
          throw new Error('Use aggregateContext() for aggregate_context queries');
        case 'find_path':
          // path finding handled separately
          throw new Error('Use findPath() for find_path queries');
        default:
          return {
            success: false,
            query,
            entities: [],
            count: 0,
            executionTimeMs: Date.now() - startTime,
            error: 'Unknown query type',
          };
      }
    } catch (error) {
      return {
        success: false,
        query,
        entities: [],
        count: 0,
        executionTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Find entities by type and filters.
   */
  private findByType(query: FindByTypeQuery, startTime: number): QueryResult {
    const results: QueryResultEntity[] = [];

    for (const entityType of query.entityTypes) {
      const classified = this.store.findByType(entityType);

      for (const cls of classified) {
        // Check domain filter
        if (query.domains && !query.domains.includes(cls.domain)) continue;

        // Check disposition filter
        if (query.disposition && cls.disposition !== query.disposition) continue;

        // Check confidence filter
        if (
          query.minConfidence &&
          cls.confidence < query.minConfidence
        )
          continue;

        results.push({
          pluginId: cls.entityPluginId,
          entityId: cls.entityId,
          latitude: 0,
          longitude: 0,
          classification: {
            type: cls.type,
            domain: cls.domain,
            disposition: cls.disposition,
            subtypes: cls.subtypes,
            confidence: cls.confidence,
          },
        });
      }
    }

    // Sort by confidence descending
    results.sort((a, b) => (b.classification?.confidence ?? 0) - (a.classification?.confidence ?? 0));

    // Apply limit
    const limited = query.limit ? results.slice(0, query.limit) : results;

    return {
      success: true,
      query,
      entities: limited,
      count: limited.length,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Query relationships from a source entity.
   */
  private queryRelationships(
    query: QueryRelationshipsQuery,
    startTime: number,
  ): QueryResult {
    const results: QueryResultEntity[] = [];
    const visited = new Set<string>();

    // BFS traversal
    const queue: Array<{ key: string; depth: number }> = [
      {
        key: `${query.sourcePluginId}:${query.sourceEntityId}`,
        depth: 0,
      },
    ];

    const maxDepth = query.traversalDepth ?? 1;

    while (queue.length > 0 && results.length < (query.limit ?? 1000)) {
      const { key, depth } = queue.shift()!;
      if (visited.has(key) || depth > maxDepth) continue;
      visited.add(key);

      const [pId, eId] = key.split(':');
      const rels = this.store.getRelationshipsFrom(pId, eId);

      for (const rel of rels) {
        // Filter by relationship type if specified
        if (query.relationshipTypes && !query.relationshipTypes.includes(rel.relationshipType)) {
          continue;
        }

        const [targetPId, targetEId] = rel.targetId.split(':');
        const cls = this.store.getClassification(targetPId, targetEId);

        results.push({
          pluginId: targetPId,
          entityId: targetEId,
          latitude: 0,
          longitude: 0,
          classification: cls
            ? {
              type: cls.type,
              domain: cls.domain,
              disposition: cls.disposition,
              subtypes: cls.subtypes,
              confidence: cls.confidence,
            }
            : undefined,
          relationshipType: rel.relationshipType,
          relationshipConfidence: rel.confidence,
        });

        // Add to queue for deeper traversal
        if (depth < maxDepth) {
          const nextKey = `${targetPId}:${targetEId}`;
          if (!visited.has(nextKey)) {
            queue.push({ key: nextKey, depth: depth + 1 });
          }
        }
      }
    }

    return {
      success: true,
      query,
      entities: results.slice(0, query.limit),
      count: results.length,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Spatial + semantic search: real great-circle distance from the query point,
   * filtered to the requested radius.
   *
   * Positions come from the store's entity cache. An entity with no known
   * position cannot be shown to be inside the radius, so it is excluded and
   * counted in `unlocatedCount` — the caller must be able to tell "nothing
   * nearby" from "position unknown for N candidates".
   */
  private spatialSemanticSearch(
    query: SpatialSemanticQuery,
    startTime: number,
  ): QueryResult {
    const results: QueryResultEntity[] = [];
    let unlocatedCount = 0;

    const types = query.entityTypes ?? [
      'aircraft',
      'maritime_vessel',
      'person',
      'organization',
      'facility',
    ] as EntityType[];

    const maxDistanceKm = Math.min(
      query.radiusKm,
      query.maxDistanceKm ?? Number.POSITIVE_INFINITY,
    );

    for (const entityType of types) {
      const classified = this.store.findByType(entityType);

      for (const cls of classified) {
        if (query.domains && !query.domains.includes(cls.domain)) continue;
        if (query.disposition && cls.disposition !== query.disposition) continue;
        if (query.minConfidence && cls.confidence < query.minConfidence) continue;

        const position = getEntityPosition(
          this.store,
          cls.entityPluginId,
          cls.entityId,
        );
        if (!position) {
          unlocatedCount++;
          continue;
        }

        const distanceKm = haversineDistanceKm(
          query.latitude,
          query.longitude,
          position.latitude,
          position.longitude,
        );
        if (distanceKm > maxDistanceKm) continue;

        results.push({
          pluginId: cls.entityPluginId,
          entityId: cls.entityId,
          latitude: position.latitude,
          longitude: position.longitude,
          distanceKm,
          classification: {
            type: cls.type,
            domain: cls.domain,
            disposition: cls.disposition,
            subtypes: cls.subtypes,
            confidence: cls.confidence,
          },
        });
      }
    }

    // Sort by distance
    results.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

    const limited = query.limit ? results.slice(0, query.limit) : results;

    return {
      success: true,
      query,
      entities: limited,
      count: limited.length,
      unlocatedCount,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Assess threat level for an entity.
   */
  assessThreat(query: ThreatAssessmentQuery): ThreatAssessmentResult {
    const cls = this.store.getClassification(query.entityPluginId, query.entityId);

    // Compute hostility score from disposition
    let hostilityScore = 0;
    if (cls?.disposition === 'hostile') hostilityScore = 0.9;
    else if (cls?.disposition === 'friend') hostilityScore = 0;
    else if (cls?.disposition === 'neutral') hostilityScore = 0.3;
    else hostilityScore = 0.5; // unknown

    // Proximity score (would use actual locations).
    // Unknown proximity is a neutral prior, not "definitely far" — a 0 here
    // silently deflates the weighted sum by the full proximity weight.
    let proximityScore = 0.3;
    if (query.referenceLatitude && query.referenceLongitude) {
      // TODO: calculate actual distance
      proximityScore = 0.5;
    }

    // Combined threat level
    let threatLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    const combined = hostilityScore * 0.6 + proximityScore * 0.4;
    if (combined >= 0.8) threatLevel = 'critical';
    else if (combined >= 0.6) threatLevel = 'high';
    else if (combined >= 0.4) threatLevel = 'medium';

    return {
      entityPluginId: query.entityPluginId,
      entityId: query.entityId,
      threatLevel,
      hostilityScore,
      proximityScore,
      threatTypes: [
        cls?.domain === 'air' ? 'military' : undefined,
        cls?.disposition === 'hostile' ? 'kinetic' : undefined,
      ].filter(Boolean) as string[],
      reasoning: {
        factors: [
          { factor: 'disposition', weight: 0.6, contribution: hostilityScore * 0.6 },
          { factor: 'proximity', weight: 0.4, contribution: proximityScore * 0.4 },
        ],
        threshold: 0.5,
        confidence: cls?.confidence ?? 0.5,
      },
      relatedThreats: [],
    };
  }

  /**
   * Aggregate context for an entity (related assets, threats, relationships).
   */
  aggregateContext(query: AggregateContextQuery): ContextAggregationResult {
    const cls = this.store.getClassification(query.entityPluginId, query.entityId);

    // An unclassified entity still has a relationship graph and a threat
    // landscape — only its own summary is unknown.

    const relatedByRelationship: Record<string, QueryResultEntity[]> = {};
    const relatedByType: Record<EntityType, QueryResultEntity[]> = {} as Record<EntityType, QueryResultEntity[]>;

    const rels = this.store.getRelationshipsFrom(query.entityPluginId, query.entityId);

    for (const rel of rels) {
      const [pId, eId] = rel.targetId.split(':');
      const targetCls = this.store.getClassification(pId, eId);

      const resultEntity: QueryResultEntity = {
        pluginId: pId,
        entityId: eId,
        latitude: 0,
        longitude: 0,
        classification: targetCls
          ? {
            type: targetCls.type,
            domain: targetCls.domain,
            disposition: targetCls.disposition,
            subtypes: targetCls.subtypes,
            confidence: targetCls.confidence,
          }
          : undefined,
        relationshipType: rel.relationshipType,
      };

      // Group by relationship type
      if (!relatedByRelationship[rel.relationshipType]) {
        relatedByRelationship[rel.relationshipType] = [];
      }
      relatedByRelationship[rel.relationshipType].push(resultEntity);

      // Group by entity type
      if (targetCls) {
        if (!relatedByType[targetCls.type]) {
          relatedByType[targetCls.type] = [];
        }
        relatedByType[targetCls.type].push(resultEntity);
      }
    }

    // Count threat types
    const threatLandscape = {
      hostileCount: 0,
      friendlyCount: 0,
      neutralCount: 0,
      criticalThreats: [] as QueryResultEntity[],
    };

    for (const entities of Object.values(relatedByRelationship)) {
      for (const entity of entities) {
        if (entity.classification?.disposition === 'hostile') threatLandscape.hostileCount++;
        else if (entity.classification?.disposition === 'friend') threatLandscape.friendlyCount++;
        else threatLandscape.neutralCount++;
      }
    }

    return {
      entityPluginId: query.entityPluginId,
      entityId: query.entityId,
      summary: {
        type: cls?.type ?? 'unknown',
        classification: cls
          ? {
            type: cls.type,
            domain: cls.domain,
            disposition: cls.disposition,
            confidence: cls.confidence,
          }
          : undefined,
      },
      relatedByType,
      relatedByRelationship,
      threatLandscape,
    };
  }

  /**
   * Find shortest path between two entities.
   */
  findPath(query: FindPathQuery): PathFindingResult {
    const path = this.graph.findPath(
      query.sourcePluginId,
      query.sourceEntityId,
      query.targetPluginId,
      query.targetEntityId,
    );

    // TODO: Build full path with entity data
    return {
      sourcePluginId: query.sourcePluginId,
      sourceEntityId: query.sourceEntityId,
      targetPluginId: query.targetPluginId,
      targetEntityId: query.targetEntityId,
      path: null, // Would populate from graph path
      pathLength: path?.length ?? null,
      maxPathLength: 10,
    };
  }
}
