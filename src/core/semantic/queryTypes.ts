/**
 * @file queryTypes.ts
 * @description Query definitions and result types for semantic entity searches.
 * Enables agents to ask: "Find all friendly aircraft", "Get threats near position X", etc.
 */

import type {
  EntityType,
  EntityDomain,
  Disposition,
  Confidence,
  SemanticEntity,
} from '@maven-system/plugin-sdk';

/**
 * Base query result for any semantic search.
 * Includes classification metadata so agents can reason about confidence.
 */
export interface QueryResultEntity {
  /** Entity identifiers */
  pluginId: string;
  entityId: string;

  /** Core spatial data */
  latitude: number;
  longitude: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  label?: string;

  /** Classification info (from semantic layer) */
  classification?: {
    type: EntityType;
    domain?: EntityDomain;
    disposition?: Disposition;
    subtypes?: string[];
    confidence: Confidence;
  };

  /** Threat level (if computed) */
  threatLevel?: 'low' | 'medium' | 'high' | 'critical';

  /** Distance in km (for spatial queries) */
  distanceKm?: number;

  /** Bearing in degrees (for spatial queries) */
  bearingDegrees?: number;

  /** Relationship context (if returned from relationship query) */
  relationshipType?: string;
  relationshipConfidence?: Confidence;
}

/**
 * Query: find entities by type.
 * Example: "Find all aircraft", "Find all hostile military units"
 */
export interface FindByTypeQuery {
  type: 'find_by_type';
  entityTypes: EntityType[];
  domains?: EntityDomain[];
  disposition?: Disposition;
  minConfidence?: Confidence;
  limit?: number;
}

/**
 * Query: find entities by relationship.
 * Example: "Find all aircraft escorted by this ship", "Find units controlled by org X"
 */
export interface QueryRelationshipsQuery {
  type: 'query_relationships';
  sourcePluginId: string;
  sourceEntityId: string;
  relationshipTypes?: string[];
  traversalDepth?: number; // 1-3 hops
  limit?: number;
}

/**
 * Query: spatial + semantic search.
 * Example: "Find all hostile contacts within 50km of this position"
 */
export interface SpatialSemanticQuery {
  type: 'spatial_semantic';
  latitude: number;
  longitude: number;
  radiusKm: number;
  entityTypes?: EntityType[];
  disposition?: Disposition;
  domains?: EntityDomain[];
  minConfidence?: Confidence;
  maxDistanceKm?: number;
  limit?: number;
}

/**
 * Query: threat assessment.
 * Example: "Analyze threats to this position", "Get threat level for entity X"
 */
export interface ThreatAssessmentQuery {
  type: 'threat_assessment';
  entityPluginId: string;
  entityId: string;
  referenceLatitude?: number;
  referenceLongitude?: number;
  threatModel?: 'disposition' | 'proximity' | 'capability' | 'combined';
}

/**
 * Query: entity context aggregation.
 * Example: "Tell me about all related assets to this unit"
 */
export interface AggregateContextQuery {
  type: 'aggregate_context';
  entityPluginId: string;
  entityId: string;
  traversalDepth?: number;
}

/**
 * Query: find path between entities.
 * Example: "How is ship A connected to organization B?"
 */
export interface FindPathQuery {
  type: 'find_path';
  sourcePluginId: string;
  sourceEntityId: string;
  targetPluginId: string;
  targetEntityId: string;
}

/**
 * Union of all semantic queries.
 */
export type SemanticQuery =
  | FindByTypeQuery
  | QueryRelationshipsQuery
  | SpatialSemanticQuery
  | ThreatAssessmentQuery
  | AggregateContextQuery
  | FindPathQuery;

/**
 * Result from a semantic query execution.
 */
export interface QueryResult {
  success: boolean;
  query: SemanticQuery;
  entities: QueryResultEntity[];
  count: number;
  executionTimeMs: number;
  error?: string;
  /**
   * Spatial queries only: candidates that matched the semantic filters but were
   * excluded because no position is known for them. Non-zero means the radius
   * result is incomplete, not that nothing else is out there.
   */
  unlocatedCount?: number;
}

/**
 * Threat assessment result with reasoning.
 */
export interface ThreatAssessmentResult {
  entityPluginId: string;
  entityId: string;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  hostilityScore: number; // 0-1
  proximityScore: number; // 0-1
  threatTypes: string[]; // ["military", "cyber", "infrastructure"]
  reasoning: {
    factors: Array<{ factor: string; weight: number; contribution: number }>;
    threshold: number;
    confidence: Confidence;
  };
  relatedThreats: Array<{
    entityId: string;
    relationshipType: string;
    threatLevel: string;
  }>;
}

/**
 * Context aggregation result.
 */
export interface ContextAggregationResult {
  entityPluginId: string;
  entityId: string;
  summary: {
    type: EntityType;
    label?: string;
    classification: any;
  };
  relatedByType: Record<string, QueryResultEntity[]>;
  relatedByRelationship: Record<string, QueryResultEntity[]>;
  threatLandscape: {
    hostileCount: number;
    friendlyCount: number;
    neutralCount: number;
    criticalThreats: QueryResultEntity[];
  };
}

/**
 * Path finding result.
 */
export interface PathFindingResult {
  sourcePluginId: string;
  sourceEntityId: string;
  targetPluginId: string;
  targetEntityId: string;
  path: Array<{
    pluginId: string;
    entityId: string;
    relationshipType: string;
    hopNumber: number;
  }> | null;
  pathLength: number | null;
  maxPathLength: number;
}
