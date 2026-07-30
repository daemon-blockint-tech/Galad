/**
 * @file semanticStore.ts
 * @description In-memory semantic layer store for classifications, properties, and relationships.
 * Acts as the single source of truth for entity semantics until persisted to database.
 */

import type {
  EntityClassification,
  SemanticProperty,
  EntityProvenance,
  SemanticRelationship,
  RelationshipType,
  EntityType,
  EntityDomain,
  Disposition,
} from '@maven-system/plugin-sdk';

const RELATIONSHIP_TYPES: readonly string[] = [
  'part_of', 'controlled_by', 'same_as', 'related_to', 'parent_of',
  'member_of', 'associated_with', 'threatens', 'defends', 'supports',
  'located_at', 'operates_from', 'communicates_with', 'owns', 'commands',
  'escorts', 'observes', 'deployed_by', 'assigned_to', 'fusion_of',
] satisfies readonly RelationshipType[];

function isRelationshipType(value: string): value is RelationshipType {
  return RELATIONSHIP_TYPES.includes(value);
}

interface StoredClassification extends EntityClassification {
  entityPluginId: string;
  entityId: string;
}

interface StoredProperty extends SemanticProperty {
  entityPluginId: string;
  entityId: string;
  propertyName: string;
}

interface StoredRelationship extends SemanticRelationship {
  id: string;
}

/**
 * In-memory semantic store. Coordinates classifications, properties, relationships,
 * and provenance for all entities in the current session.
 *
 * Multi-tenant aware: uses tenantId to scope all data.
 */
export class SemanticStore {
  private tenantId: string | null;

  // Classifications: (pluginId:entityId) → EntityClassification
  private classifications = new Map<string, StoredClassification>();

  // Semantic properties: (pluginId:entityId:propertyName) → SemanticProperty
  private semanticProperties = new Map<string, StoredProperty>();

  // Relationships: edges in the ontology graph
  private relationships = new Map<string, StoredRelationship>();

  // Provenance: (pluginId:entityId) → EntityProvenance
  private provenance = new Map<string, EntityProvenance>();

  constructor(tenantId?: string | null) {
    this.tenantId = tenantId ?? null;
  }

  // ─── Classification Store ──────────────────────────────────

  /**
   * Store or update entity classification.
   */
  setClassification(
    pluginId: string,
    entityId: string,
    classification: EntityClassification,
  ): void {
    const key = `${pluginId}:${entityId}`;
    this.classifications.set(key, {
      ...classification,
      entityPluginId: pluginId,
      entityId,
    });
  }

  /**
   * Get classification for entity, or null if not classified.
   */
  getClassification(pluginId: string, entityId: string): StoredClassification | null {
    const key = `${pluginId}:${entityId}`;
    return this.classifications.get(key) ?? null;
  }

  /**
   * Find all classifications matching a type.
   */
  findByType(entityType: EntityType): StoredClassification[] {
    return Array.from(this.classifications.values()).filter(
      (c) => c.type === entityType,
    );
  }

  /**
   * Find all classifications matching a domain.
   */
  findByDomain(domain: EntityDomain): StoredClassification[] {
    return Array.from(this.classifications.values()).filter(
      (c) => c.domain === domain,
    );
  }

  /**
   * Find all with given disposition.
   */
  findByDisposition(disposition: Disposition): StoredClassification[] {
    return Array.from(this.classifications.values()).filter(
      (c) => c.disposition === disposition,
    );
  }

  // ─── Semantic Properties Store ──────────────────────────────

  /**
   * Store a semantic property for an entity.
   */
  setProperty(
    pluginId: string,
    entityId: string,
    propertyName: string,
    property: SemanticProperty,
  ): void {
    const key = `${pluginId}:${entityId}:${propertyName}`;
    this.semanticProperties.set(key, {
      ...property,
      entityPluginId: pluginId,
      entityId,
      propertyName,
    });
  }

  /**
   * Get a property value with unit and semantic context.
   */
  getProperty(
    pluginId: string,
    entityId: string,
    propertyName: string,
  ): StoredProperty | null {
    const key = `${pluginId}:${entityId}:${propertyName}`;
    return this.semanticProperties.get(key) ?? null;
  }

  /**
   * Get all semantic properties for an entity.
   */
  getAllProperties(pluginId: string, entityId: string): StoredProperty[] {
    const prefix = `${pluginId}:${entityId}:`;
    return Array.from(this.semanticProperties.values()).filter((p) =>
      p.entityPluginId === pluginId && p.entityId === entityId
    );
  }

  // ─── Relationship Store (Ontology Graph) ──────────────────

  /**
   * Add a relationship between two entities.
   */
  addRelationship(
    sourcePluginId: string,
    sourceEntityId: string,
    targetPluginId: string,
    targetEntityId: string,
    relationshipType: string,
    confidence: number = 1.0,
  ): string {
    const id = `${Math.random().toString(36).slice(2)}`;
    const relationship: StoredRelationship = {
      id,
      sourceId: `${sourcePluginId}:${sourceEntityId}`,
      targetId: `${targetPluginId}:${targetEntityId}`,
      // Boundary conversion: plugin-supplied strings outside the SDK taxonomy
      // degrade to the generic association type.
      relationshipType: isRelationshipType(relationshipType)
        ? relationshipType
        : 'related_to',
      confidence,
      establishedAt: Date.now(),
    };
    this.relationships.set(id, relationship);
    return id;
  }

  /**
   * Get all relationships from a source entity.
   */
  getRelationshipsFrom(pluginId: string, entityId: string): StoredRelationship[] {
    return Array.from(this.relationships.values()).filter(
      (r) => r.sourceId === `${pluginId}:${entityId}`,
    );
  }

  /**
   * Get all relationships to a target entity.
   */
  getRelationshipsTo(pluginId: string, entityId: string): StoredRelationship[] {
    return Array.from(this.relationships.values()).filter(
      (r) => r.targetId === `${pluginId}:${entityId}`,
    );
  }

  /**
   * Traverse relationship graph (BFS) up to given depth.
   */
  traverseRelationships(
    pluginId: string,
    entityId: string,
    maxDepth: number = 3,
  ): Map<string, { relationship: StoredRelationship; depth: number }> {
    const results = new Map<
      string,
      { relationship: StoredRelationship; depth: number }
    >();
    const queue: Array<{ key: string; depth: number }> = [
      { key: `${pluginId}:${entityId}`, depth: 0 },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { key, depth } = queue.shift()!;
      if (visited.has(key) || depth > maxDepth) continue;
      visited.add(key);

      const [pId, eId] = key.split(':');
      const outgoing = this.getRelationshipsFrom(pId, eId);

      for (const rel of outgoing) {
        const targetKey = rel.targetId;
        if (!results.has(targetKey)) {
          results.set(targetKey, { relationship: rel, depth: depth + 1 });
          queue.push({ key: targetKey, depth: depth + 1 });
        }
      }
    }

    return results;
  }

  // ─── Provenance Store ──────────────────────────────────────

  /**
   * Set provenance info for an entity.
   */
  setProvenance(
    pluginId: string,
    entityId: string,
    provenance: EntityProvenance,
  ): void {
    const key = `${pluginId}:${entityId}`;
    this.provenance.set(key, provenance);
  }

  /**
   * Get provenance for an entity.
   */
  getProvenance(pluginId: string, entityId: string): EntityProvenance | null {
    const key = `${pluginId}:${entityId}`;
    return this.provenance.get(key) ?? null;
  }

  // ─── Threat Assessment Cache ───────────────────────────────

  private threatAssessments = new Map<string, {
    threatLevel: string;
    hostilityScore: number;
    proximityScore: number;
  }>();

  /**
   * Cache threat assessment for an entity.
   */
  setThreatAssessment(
    pluginId: string,
    entityId: string,
    threatLevel: string,
    hostilityScore: number = 0,
    proximityScore: number = 0,
  ): void {
    const key = `${pluginId}:${entityId}`;
    this.threatAssessments.set(key, { threatLevel, hostilityScore, proximityScore });
  }

  /**
   * Get cached threat assessment.
   */
  getThreatAssessment(
    pluginId: string,
    entityId: string,
  ): { threatLevel: string; hostilityScore: number; proximityScore: number } | null {
    const key = `${pluginId}:${entityId}`;
    return this.threatAssessments.get(key) ?? null;
  }

  // ─── Entity Cache ──────────────────────────────────────────

  private entities = new Map<string, any>();

  /**
   * Store an entity (for lookups in fusion engine).
   */
  setEntity(
    pluginId: string,
    entityId: string,
    entity: any,
  ): void {
    const key = `${pluginId}:${entityId}`;
    this.entities.set(key, { pluginId, entityId, ...entity });
  }

  /**
   * Get an entity by ID.
   */
  getEntity(pluginId: string, entityId: string): any | null {
    const key = `${pluginId}:${entityId}`;
    return this.entities.get(key) ?? null;
  }

  /**
   * Get all entities.
   */
  getAllEntities(): any[] {
    return Array.from(this.entities.values());
  }

  // ─── Utilities ─────────────────────────────────────────────

  /**
   * Clear all semantic data (useful for session cleanup or testing).
   */
  clear(): void {
    this.classifications.clear();
    this.semanticProperties.clear();
    this.relationships.clear();
    this.provenance.clear();
  }

  /**
   * Get summary stats (for diagnostics).
   */
  getStats(): {
    classifications: number;
    properties: number;
    relationships: number;
    provenance: number;
  } {
    return {
      classifications: this.classifications.size,
      properties: this.semanticProperties.size,
      relationships: this.relationships.size,
      provenance: this.provenance.size,
    };
  }

  /**
   * Get the tenant ID this store is scoped to.
   */
  getTenantId(): string | null {
    return this.tenantId;
  }
}

/**
 * Global semantic store instance (per-tenant in multi-tenant deployments).
 * In production, instantiate per-request or use React context for per-session state.
 */
let globalSemanticStore: SemanticStore | null = null;

export function getGlobalSemanticStore(tenantId?: string | null): SemanticStore {
  if (!globalSemanticStore) {
    globalSemanticStore = new SemanticStore(tenantId);
  }
  return globalSemanticStore;
}

export function resetGlobalSemanticStore(): void {
  globalSemanticStore = null;
}
