/**
 * @file GraphRenderer.ts
 * @description Graph visualization renderer for semantic relationships.
 * Converts entity store to force-directed graph layout.
 */

import { SemanticStore } from '@/core/semantic/semanticStore';

export interface GraphNode {
  id: string; // "pluginId|entityId"
  label: string;
  entityType?: string;
  threatLevel?: string;
  confidence: number;
  x?: number; // Layout coordinates
  y?: number;
  vx?: number; // Velocity for force simulation
  vy?: number;
  fx?: number; // Fixed position (if pinned)
  fy?: number;
  radius: number; // Visual radius based on confidence
  color: string; // Determined by threat level
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string; // "sourceId->targetId"
  source: string;
  target: string;
  relationshipType: string;
  confidence: number;
  strength: number; // 0-1 for force strength
  label?: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: { width: number; height: number; centerX: number; centerY: number };
}

export interface ForceSimulationOptions {
  width?: number;
  height?: number;
  chargeStrength?: number;
  linkDistance?: number;
  iterations?: number;
  seed?: number;
}

export class GraphRenderer {
  private store: SemanticStore;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private layout: GraphLayout = {
    nodes: [],
    edges: [],
    bounds: { width: 1000, height: 800, centerX: 500, centerY: 400 },
  };

  constructor(store: SemanticStore) {
    this.store = store;
  }

  /**
   * Build graph from semantic store relationships.
   */
  buildGraph(maxNodes: number = 500, threatFilter?: string): GraphLayout {
    this.nodes.clear();
    this.edges.clear();

    // Get all entities
    const entities = this.store.getAllEntities?.() ?? [];

    // Filter by threat level if specified
    const filteredEntities = threatFilter
      ? entities.filter((e) => {
          const threat = this.store.getThreatAssessment?.(e.pluginId, e.entityId);
          return threat?.threatLevel === threatFilter;
        })
      : entities;

    // Limit node count
    const nodesToAdd = filteredEntities.slice(0, maxNodes);

    // Create nodes
    for (const entity of nodesToAdd) {
      const nodeId = `${entity.pluginId}|${entity.entityId}`;
      const classification = this.store.getClassification?.(entity.pluginId, entity.entityId);
      const threat = this.store.getThreatAssessment?.(entity.pluginId, entity.entityId);

      const node: GraphNode = {
        id: nodeId,
        label: entity.label || entity.entityId,
        entityType: classification?.type,
        threatLevel: threat?.threatLevel,
        confidence: classification?.confidence ?? 0.8,
        radius: this.getNodeRadius(threat?.threatLevel),
        color: this.getThreatColor(threat?.threatLevel),
        metadata: {
          pluginId: entity.pluginId,
          entityId: entity.entityId,
          classification,
          threat,
        },
      };

      this.nodes.set(nodeId, node);
    }

    // Create edges from relationships
    for (const nodeId of this.nodes.keys()) {
      const [pluginId, entityId] = nodeId.split('|');
      const relationships = this.store.getRelationshipsFrom?.(pluginId, entityId) ?? [];

      for (const rel of relationships) {
        // rel.targetId is "pluginId:entityId"; node ids use "pluginId|entityId"
        const targetId = rel.targetId.replace(':', '|');

        // Only add edge if both nodes exist
        if (this.nodes.has(targetId)) {
          const edgeId = `${nodeId}->${targetId}`;

          const edge: GraphEdge = {
            id: edgeId,
            source: nodeId,
            target: targetId,
            relationshipType: rel.relationshipType,
            confidence: rel.confidence,
            strength: rel.confidence,
            label: rel.relationshipType.replace(/_/g, ' '),
          };

          this.edges.set(edgeId, edge);
        }
      }
    }

    // Calculate layout
    this.layout = this.calculateLayout(
      Array.from(this.nodes.values()),
      Array.from(this.edges.values()),
    );

    return this.layout;
  }

  /**
   * Force-directed layout calculation (simplified).
   */
  private calculateLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
    const width = 1200;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;

    if (nodes.length === 0) {
      return { nodes: [], edges, bounds: { width, height, centerX, centerY } };
    }

    // Initialize positions (circle layout as baseline)
    const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1);
    const radius = Math.min(width, height) / 3;

    for (let i = 0; i < nodes.length; i++) {
      const angle = i * angleStep;
      const node = nodes[i];
      node.x = centerX + radius * Math.cos(angle);
      node.y = centerY + radius * Math.sin(angle);
      node.vx = 0;
      node.vy = 0;
    }

    // Run force simulation iterations
    const iterations = 50;
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsive forces between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const node1 = nodes[i];
          const node2 = nodes[j];
          const dx = (node2.x ?? 0) - (node1.x ?? 0);
          const dy = (node2.y ?? 0) - (node1.y ?? 0);
          const distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const repulsion = (100 * 100) / (distance * distance); // Coulomb's law

          node1.vx! -= (repulsion * dx) / distance;
          node1.vy! -= (repulsion * dy) / distance;
          node2.vx! += (repulsion * dx) / distance;
          node2.vy! += (repulsion * dy) / distance;
        }
      }

      // Attractive forces along edges
      for (const edge of edges) {
        const source = nodes.find((n) => n.id === edge.source);
        const target = nodes.find((n) => n.id === edge.target);

        if (!source || !target) continue;

        const dx = (target.x ?? 0) - (source.x ?? 0);
        const dy = (target.y ?? 0) - (source.y ?? 0);
        const distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const targetDistance = 100;
        const attraction =
          ((distance - targetDistance) * edge.strength) / distance;

        source.vx! += (attraction * dx) / distance;
        source.vy! += (attraction * dy) / distance;
        target.vx! -= (attraction * dx) / distance;
        target.vy! -= (attraction * dy) / distance;
      }

      // Center gravity
      for (const node of nodes) {
        const cx = centerX;
        const cy = centerY;
        const dx = (node.x ?? cx) - cx;
        const dy = (node.y ?? cy) - cy;
        const gravity = 0.01;

        node.vx! -= gravity * dx;
        node.vy! -= gravity * dy;
      }

      // Apply velocity with damping
      const damping = 0.99;
      for (const node of nodes) {
        node.vx! *= damping;
        node.vy! *= damping;
        node.x! += node.vx!;
        node.y! += node.vy!;

        // Boundary constraints
        node.x = Math.max(0, Math.min(width, node.x!));
        node.y = Math.max(0, Math.min(height, node.y!));
      }
    }

    // Recenter to bounds
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x ?? 0);
      maxX = Math.max(maxX, node.x ?? 0);
      minY = Math.min(minY, node.y ?? 0);
      maxY = Math.max(maxY, node.y ?? 0);
    }

    const currentWidth = maxX - minX || 1;
    const currentHeight = maxY - minY || 1;
    const scaleX = (width * 0.9) / currentWidth;
    const scaleY = (height * 0.9) / currentHeight;
    const scale = Math.min(scaleX, scaleY);

    for (const node of nodes) {
      node.x = (node.x! - minX) * scale + width * 0.05;
      node.y = (node.y! - minY) * scale + height * 0.05;
    }

    return { nodes, edges, bounds: { width, height, centerX, centerY } };
  }

  /**
   * Get visual radius based on threat level.
   */
  private getNodeRadius(threatLevel?: string): number {
    switch (threatLevel) {
      case 'critical':
        return 12;
      case 'high':
        return 10;
      case 'medium':
        return 8;
      case 'low':
      default:
        return 6;
    }
  }

  /**
   * Get color based on threat level.
   */
  private getThreatColor(threatLevel?: string): string {
    switch (threatLevel) {
      case 'critical':
        return '#dc2626';
      case 'high':
        return '#f97316';
      case 'medium':
        return '#eab308';
      case 'low':
        return '#22c55e';
      default:
        return '#6b7280';
    }
  }

  /**
   * Get current layout.
   */
  getLayout(): GraphLayout {
    return this.layout;
  }

  /**
   * Get node by ID.
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get edge by ID.
   */
  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  /**
   * Find neighbors of a node.
   */
  getNeighbors(nodeId: string): GraphNode[] {
    const neighbors: GraphNode[] = [];

    for (const edge of this.edges.values()) {
      if (edge.source === nodeId) {
        const neighbor = this.nodes.get(edge.target);
        if (neighbor) neighbors.push(neighbor);
      } else if (edge.target === nodeId) {
        const neighbor = this.nodes.get(edge.source);
        if (neighbor) neighbors.push(neighbor);
      }
    }

    return neighbors;
  }

  /**
   * Find connected component (all nodes reachable from start).
   */
  getConnectedComponent(startNodeId: string): GraphNode[] {
    const visited = new Set<string>();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        const neighbors = this.getNeighbors(nodeId);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor.id)) {
            queue.push(neighbor.id);
          }
        }
      }
    }

    return Array.from(visited)
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }
}
