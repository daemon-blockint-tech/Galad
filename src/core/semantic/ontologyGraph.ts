/**
 * @file ontologyGraph.ts
 * @description Knowledge graph for semantic entity relationships and reasoning.
 * Enables agents to query relationships, traverse entity hierarchies, and perform
 * multi-hop reasoning over the entity constellation.
 */

import type {
  SemanticEntity,
  SemanticRelationship,
  RelationshipType,
  EntityContext,
  EntityType,
  Confidence,
} from '@maven-system/plugin-sdk';
import { SemanticStore } from './semanticStore';

interface QueryResult {
  entity: SemanticEntity;
  distance: number;
  path: RelationshipType[];
}

/**
 * Ontology graph: in-memory knowledge graph over entities.
 * Supports queries like:
 * - "Find all aircraft controlled_by this unit"
 * - "Get all entities related to threat at location X"
 * - "Traverse hierarchy: organization → division → battalion"
 */
export class OntologyGraph {
  private store: SemanticStore;

  // Cache for frequently accessed relationships
  private relationshipCache = new Map<string, SemanticRelationship[]>();

  constructor(store: SemanticStore) {
    this.store = store;
  }

  // ─── Query Interface ──────────────────────────────────────

  /**
   * Find all entities of a given type in the store.
   */
  findEntitiesByType(
    entityType: EntityType,
  ): Array<{ pluginId: string; entityId: string }> {
    return this.store.findByType(entityType).map((c) => ({
      pluginId: c.entityPluginId,
      entityId: c.entityId,
    }));
  }

  /**
   * Find entities with a given relationship type originating from source.
   */
  findRelatedEntities(
    sourcePluginId: string,
    sourceEntityId: string,
    relationshipType?: RelationshipType,
  ): Array<{ pluginId: string; entityId: string; relationshipType: RelationshipType }> {
    const rels = this.store.getRelationshipsFrom(sourcePluginId, sourceEntityId);

    if (relationshipType) {
      return rels
        .filter((r) => r.relationshipType === relationshipType)
        .map((r) => {
          const [pId, eId] = r.targetId.split(':');
          return { pluginId: pId, entityId: eId, relationshipType: r.relationshipType };
        });
    }

    return rels.map((r) => {
      const [pId, eId] = r.targetId.split(':');
      return { pluginId: pId, entityId: eId, relationshipType: r.relationshipType };
    });
  }

  /**
   * Traverse graph breadth-first to find connected components.
   * Returns paths up to maxDepth, grouped by hop distance.
   */
  traverseGraph(
    sourcePluginId: string,
    sourceEntityId: string,
    maxDepth: number = 3,
  ): Map<number, Array<{ pluginId: string; entityId: string }>> {
    const results = new Map<number, Array<{ pluginId: string; entityId: string }>>();
    const visited = new Set<string>();
    const queue: Array<{
      key: string;
      depth: number;
      pluginId: string;
      entityId: string;
    }> = [{ key: `${sourcePluginId}:${sourceEntityId}`, depth: 0, pluginId: sourcePluginId, entityId: sourceEntityId }];

    while (queue.length > 0) {
      const { key, depth, pluginId, entityId } = queue.shift()!;
      if (visited.has(key) || depth > maxDepth) continue;
      visited.add(key);

      if (!results.has(depth)) results.set(depth, []);
      results.get(depth)!.push({ pluginId, entityId });

      const outgoing = this.store.getRelationshipsFrom(pluginId, entityId);
      for (const rel of outgoing) {
        const [pId, eId] = rel.targetId.split(':');
        const nextKey = `${pId}:${eId}`;
        if (!visited.has(nextKey)) {
          queue.push({ key: nextKey, depth: depth + 1, pluginId: pId, entityId: eId });
        }
      }
    }

    return results;
  }

  /**
   * Find shortest path between two entities.
   */
  findPath(
    sourcePluginId: string,
    sourceEntityId: string,
    targetPluginId: string,
    targetEntityId: string,
  ): RelationshipType[] | null {
    const queue: Array<{ key: string; path: RelationshipType[] }> = [
      { key: `${sourcePluginId}:${sourceEntityId}`, path: [] },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { key, path } = queue.shift()!;
      if (visited.has(key)) continue;
      visited.add(key);

      const [pId, eId] = key.split(':');
      if (pId === targetPluginId && eId === targetEntityId) {
        return path;
      }

      const rels = this.store.getRelationshipsFrom(pId, eId);
      for (const rel of rels) {
        const nextKey = rel.targetId;
        if (!visited.has(nextKey)) {
          queue.push({ key: nextKey, path: [...path, rel.relationshipType] });
        }
      }
    }

    return null;
  }

  /**
   * Aggregate context for an entity: what's related to it?
   */
  buildEntityContext(
    sourcePluginId: string,
    sourceEntityId: string,
    maxHops: number = 2,
  ): EntityContext {
    const classification = this.store.getClassification(sourcePluginId, sourceEntityId);
    const nearby = this.findRelatedEntities(sourcePluginId, sourceEntityId);
    const graph = this.traverseGraph(sourcePluginId, sourceEntityId, maxHops);

    const relatedEntities: Array<{ entityId: string; relationshipType: RelationshipType }> = [];
    for (const rel of this.store.getRelationshipsFrom(sourcePluginId, sourceEntityId)) {
      const [, targetId] = rel.targetId.split(':');
      relatedEntities.push({
        entityId: targetId,
        relationshipType: rel.relationshipType,
      });
    }

    return {
      entityId: sourceEntityId,
      nearbyEntitiesByDistance: nearby.map((n) => ({
        entityId: n.entityId,
        distanceKm: 0, // Would compute from actual lat/lon
      })),
      relatedEntities,
      threatAssessment: undefined, // Computed separately
      lastUpdated: Date.now(),
      volatilityScore: 0.5, // Placeholder
    };
  }

  /**
   * Infer entity type from relationships (e.g., "if X controls Y and Y is an aircraft,
   * then X is likely a military organization").
   */
  inferType(
    pluginId: string,
    entityId: string,
  ): EntityType | null {
    const classification = this.store.getClassification(pluginId, entityId);
    if (classification) return classification.type;

    // Heuristic inference: check incoming "controlled_by" relationships
    const controlledBy = this.store
      .getRelationshipsTo(pluginId, entityId)
      .filter((r) => r.relationshipType === 'controlled_by');

    if (controlledBy.length > 0) {
      const [controllerPluginId, controllerEntityId] =
        controlledBy[0].sourceId.split(':');
      const controllerClassification = this.store.getClassification(
        controllerPluginId,
        controllerEntityId,
      );
      if (controllerClassification?.type === 'organization') {
        return 'vehicle'; // Heuristic
      }
    }

    return null;
  }

  /**
   * Clear relationship cache (call after mutations).
   */
  invalidateCache(): void {
    this.relationshipCache.clear();
  }
}
