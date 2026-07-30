/**
 * @file FullTextSearchIndex.ts
 * @description Full-text search engine using PostgreSQL capabilities.
 */

import { PrismaClient } from '@/generated/prisma';

export interface FullTextSearchResult {
  type: 'entity' | 'alert' | 'relationship';
  id: string;
  pluginId?: string;
  title: string;
  description?: string;
  relevance: number; // 0-1 score
  snippet?: string;
  metadata?: Record<string, any>;
}

/**
 * Full-text search index for entities, alerts, and relationships.
 */
export class FullTextSearchIndex {
  private db: PrismaClient;
  private tenantId?: string;

  constructor(db: PrismaClient, tenantId?: string) {
    this.db = db;
    this.tenantId = tenantId;
  }

  /**
   * Search across all indexed content.
   */
  async search(query: string, limit: number = 50): Promise<FullTextSearchResult[]> {
    try {
      // Search alerts by title and description
      const results: FullTextSearchResult[] = [];

      // Split query into terms
      const terms = query.toLowerCase().split(/\s+/);

      // Search alerts using LIKE (simple full-text search)
      const alerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
      });

      for (const alert of alerts) {
        const relevance = this.calculateRelevance(query, alert.title, alert.description);
        results.push({
          type: 'alert',
          id: alert.id,
          title: alert.title,
          description: alert.description,
          relevance,
          metadata: {
            severity: alert.severity,
            entityId: alert.entityId,
            type: alert.type,
            createdAt: alert.createdAt,
          },
        });
      }

      // Sort by relevance
      results.sort((a, b) => b.relevance - a.relevance);

      return results.slice(0, limit);
    } catch (error) {
      console.error('FullTextSearchIndex: Search failed:', error);
      return [];
    }
  }

  /**
   * Search only alerts.
   */
  async searchAlerts(query: string, limit: number = 50): Promise<FullTextSearchResult[]> {
    try {
      const alerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
      });

      return alerts.map((alert) => ({
        type: 'alert' as const,
        id: alert.id,
        title: alert.title,
        description: alert.description,
        relevance: this.calculateRelevance(query, alert.title, alert.description),
        metadata: {
          severity: alert.severity,
          entityId: alert.entityId,
          status: alert.status,
        },
      }));
    } catch (error) {
      console.error('FullTextSearchIndex: Alert search failed:', error);
      return [];
    }
  }

  /**
   * Search by entity.
   */
  async searchByEntity(entityId: string, limit: number = 50): Promise<FullTextSearchResult[]> {
    try {
      const results: FullTextSearchResult[] = [];

      // Find all alerts for this entity
      const alerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          entityId,
        },
        take: limit,
      });

      for (const alert of alerts) {
        results.push({
          type: 'alert',
          id: alert.id,
          title: alert.title,
          description: alert.description,
          relevance: 1.0, // Direct entity match
          metadata: {
            severity: alert.severity,
            type: alert.type,
            createdAt: alert.createdAt,
          },
        });
      }

      return results;
    } catch (error) {
      console.error('FullTextSearchIndex: Entity search failed:', error);
      return [];
    }
  }

  /**
   * Search by severity.
   */
  async searchBySeverity(severity: string, limit: number = 50): Promise<FullTextSearchResult[]> {
    try {
      const alerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          severity,
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      return alerts.map((alert) => ({
        type: 'alert' as const,
        id: alert.id,
        title: alert.title,
        description: alert.description,
        relevance: 1.0,
        metadata: {
          severity: alert.severity,
          entityId: alert.entityId,
          createdAt: alert.createdAt,
        },
      }));
    } catch (error) {
      console.error('FullTextSearchIndex: Severity search failed:', error);
      return [];
    }
  }

  /**
   * Advanced search with filters.
   */
  async advancedSearch(
    query: string,
    filters: {
      severity?: string;
      type?: string;
      entityId?: string;
      startTime?: number;
      endTime?: number;
    } = {},
    limit: number = 50,
  ): Promise<FullTextSearchResult[]> {
    try {
      const where: any = {
        tenantId: this.tenantId,
        AND: [
          {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      };

      // Apply filters
      if (filters.severity) {
        where.AND.push({ severity: filters.severity });
      }
      if (filters.type) {
        where.AND.push({ type: filters.type });
      }
      if (filters.entityId) {
        where.AND.push({ entityId: filters.entityId });
      }
      if (filters.startTime || filters.endTime) {
        const dateWhere: any = {};
        if (filters.startTime) {
          dateWhere.gte = new Date(filters.startTime);
        }
        if (filters.endTime) {
          dateWhere.lte = new Date(filters.endTime);
        }
        where.AND.push({ createdAt: dateWhere });
      }

      const alerts = await this.db.alert.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      return alerts.map((alert) => ({
        type: 'alert' as const,
        id: alert.id,
        title: alert.title,
        description: alert.description,
        relevance: this.calculateRelevance(query, alert.title, alert.description),
        metadata: {
          severity: alert.severity,
          type: alert.type,
          entityId: alert.entityId,
          createdAt: alert.createdAt,
        },
      }));
    } catch (error) {
      console.error('FullTextSearchIndex: Advanced search failed:', error);
      return [];
    }
  }

  /**
   * Calculate relevance score using BM25-like algorithm.
   */
  private calculateRelevance(query: string, title: string, description?: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const titleLower = title.toLowerCase();
    const descLower = (description || '').toLowerCase();

    let score = 0;

    for (const term of queryTerms) {
      // Title match (3x weight)
      if (titleLower.includes(term)) {
        const count = (titleLower.match(new RegExp(term, 'g')) || []).length;
        score += count * 3;
      }

      // Description match (1x weight)
      if (descLower.includes(term)) {
        const count = (descLower.match(new RegExp(term, 'g')) || []).length;
        score += count * 1;
      }
    }

    // Normalize to 0-1 scale
    const maxScore = queryTerms.length * 3;
    return Math.min(1, score / maxScore);
  }

  /**
   * Get search suggestions based on prefix.
   */
  async getSuggestions(prefix: string, limit: number = 10): Promise<string[]> {
    try {
      const alerts = await this.db.alert.findMany({
        where: {
          tenantId: this.tenantId,
          title: { contains: prefix, mode: 'insensitive' },
        },
        select: { title: true },
        distinct: ['title'],
        take: limit,
      });

      return alerts.map((a) => a.title);
    } catch (error) {
      console.error('FullTextSearchIndex: Suggestions failed:', error);
      return [];
    }
  }

  /**
   * Get trending search terms.
   */
  async getTrendingTerms(limit: number = 10): Promise<Array<{ term: string; count: number }>> {
    try {
      const alerts = await this.db.alert.findMany({
        where: { tenantId: this.tenantId },
        select: { title: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });

      // Extract words and count frequency
      const termCounts = new Map<string, number>();

      for (const alert of alerts) {
        const words = alert.title.toLowerCase().split(/\s+/);
        for (const word of words) {
          if (word.length > 3) {
            // Filter out very short words
            termCounts.set(word, (termCounts.get(word) || 0) + 1);
          }
        }
      }

      const trending = Array.from(termCounts.entries())
        .map(([term, count]) => ({ term, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return trending;
    } catch (error) {
      console.error('FullTextSearchIndex: Trending failed:', error);
      return [];
    }
  }
}
