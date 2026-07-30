/**
 * @file threat-intel-plugin.ts
 * @description Threat Intelligence plugin - integrates with TI feeds.
 * Enriches entities with threat context and indicators of compromise.
 */

import type { WorldPlugin, GeoEntity, PluginContext, LayerConfig, CesiumEntityOptions, PluginCategory } from '@grond/plugin-sdk';

interface ThreatIntelligence {
  id: string;
  name: string;
  threatType: string; // malware, exploit, c2, phishing, etc.
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  indicators: string[]; // IOCs: IPs, domains, hashes
  location?: { lat: number; lon: number };
  reportedAt: Date;
  tactics: string[]; // MITRE ATT&CK tactics
  campaigns?: string[];
}

export class ThreatIntelPlugin implements WorldPlugin {
  id = 'threat-intel';
  name = 'Threat Intelligence';
  description = 'Threat intelligence feeds - enriches entities with threat context and IOCs.';
  icon = 'ShieldAlert';
  category: PluginCategory = 'cyber';
  version = '1.0.0';
  private context?: PluginContext;
  private threatCache: Map<string, ThreatIntelligence> = new Map();
  private lastUpdateTime = 0;
  private updateInterval = 600000; // 10 minutes

  async fetch(timeRange: { start: Date; end: Date }): Promise<GeoEntity[]> {
    const entities: GeoEntity[] = [];
    const now = Date.now();

    // Rate limiting
    if (now - this.lastUpdateTime < this.updateInterval) {
      return this.cachedEntitiesToGeoEntities();
    }

    this.lastUpdateTime = now;

    try {
      // Mock fetch from threat intel API
      const threats = await this.fetchThreatsFromAPI();

      for (const threat of threats) {
        this.threatCache.set(threat.id, threat);

        if (threat.location) {
          const entity: GeoEntity = {
            id: threat.id,
            pluginId: this.id,
            latitude: threat.location.lat,
            longitude: threat.location.lon,
            label: threat.name,
            timestamp: threat.reportedAt,
            properties: {
              threatType: threat.threatType,
              severity: threat.severity,
              confidence: threat.confidence,
              indicators: threat.indicators,
              tactics: threat.tactics,
              campaigns: threat.campaigns ?? [],
              source: 'threat_intel',
            },
          };
          entities.push(entity);
        }
      }
    } catch (error) {
      console.error('Error fetching threat intelligence:', error);
    }

    return entities;
  }

  private async fetchThreatsFromAPI(): Promise<ThreatIntelligence[]> {
    // Mock implementation - returns sample threat data
    return [
      {
        id: 'ti-001',
        name: 'APT-28 Campaign',
        threatType: 'apt',
        severity: 'critical',
        confidence: 0.95,
        indicators: [
          '192.168.1.100',
          'evil.com',
          'c2-hash-123',
        ],
        location: { lat: 55.75, lon: 37.62 }, // Moscow
        reportedAt: new Date(),
        tactics: ['initial-access', 'c2', 'exfiltration'],
        campaigns: ['Operation Moonlight'],
      },
      {
        id: 'ti-002',
        name: 'Emotet Botnet Node',
        threatType: 'malware',
        severity: 'high',
        confidence: 0.87,
        indicators: [
          '10.0.0.50',
          'botnet-c2.net',
        ],
        location: { lat: 48.86, lon: 2.35 }, // Paris
        reportedAt: new Date(),
        tactics: ['command-and-control'],
        campaigns: [],
      },
      {
        id: 'ti-003',
        name: 'Phishing Campaign',
        threatType: 'phishing',
        severity: 'medium',
        confidence: 0.72,
        indicators: [
          'phish-domain.com',
          'lookalike.co',
        ],
        location: { lat: 51.51, lon: -0.13 }, // London
        reportedAt: new Date(),
        tactics: ['social-engineering'],
        campaigns: ['Credential Harvesting'],
      },
    ];
  }

  private cachedEntitiesToGeoEntities(): GeoEntity[] {
    const entities: GeoEntity[] = [];

    for (const threat of this.threatCache.values()) {
      if (threat.location) {
        entities.push({
          id: threat.id,
          pluginId: this.id,
          latitude: threat.location.lat,
          longitude: threat.location.lon,
          label: threat.name,
          timestamp: threat.reportedAt,
          properties: {
            threatType: threat.threatType,
            severity: threat.severity,
            confidence: threat.confidence,
            indicators: threat.indicators,
            tactics: threat.tactics,
          },
        });
      }
    }

    return entities;
  }

  getPollingInterval(): number {
    return this.updateInterval;
  }

  getLayerConfig(): LayerConfig {
    return {
      color: '#ef4444',
      clusterEnabled: true,
      clusterDistance: 40,
    };
  }

  renderEntity(entity: GeoEntity): CesiumEntityOptions {
    return {
      type: 'point',
      color: '#ef4444',
      size: 8,
      outlineColor: '#ffffff',
      outlineWidth: 1,
    };
  }

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
  }

  destroy(): void {
    this.context = undefined;
  }

  mapWebsocketPayload(payload: any): GeoEntity[] {
    // Handle real-time threat feed updates
    if (Array.isArray(payload)) {
      return payload
        .map((threat: any): GeoEntity | null => {
          if (threat.location) {
            return {
              id: threat.id,
              pluginId: this.id,
              latitude: threat.location.lat,
              longitude: threat.location.lon,
              label: threat.name,
              timestamp: new Date(threat.reportedAt),
              properties: {
                threatType: threat.threatType,
                severity: threat.severity,
                indicators: threat.indicators,
              },
            };
          }
          return null;
        })
        .filter((e: GeoEntity | null): e is GeoEntity => e !== null);
    }
    return [];
  }

  /**
   * Get threat details by ID (for enrichment).
   */
  getThreatDetails(threatId: string): ThreatIntelligence | null {
    return this.threatCache.get(threatId) ?? null;
  }

  /**
   * Get indicators for a threat.
   */
  getIndicators(threatId: string): string[] {
    return this.threatCache.get(threatId)?.indicators ?? [];
  }

  /**
   * Match indicators against entities (for correlation).
   */
  matchIndicators(entityProperties: Record<string, unknown>): string[] {
    const matches: string[] = [];

    for (const threat of this.threatCache.values()) {
      for (const indicator of threat.indicators) {
        if (JSON.stringify(entityProperties).includes(indicator)) {
          matches.push(threat.id);
          break;
        }
      }
    }

    return matches;
  }
}

export default new ThreatIntelPlugin();
