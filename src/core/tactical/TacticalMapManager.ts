/**
 * Tactical Map Visualization with Real-Time Track Updates
 * Geo-spatial entity rendering with threat mapping and temporal playback
 */

export interface GeoLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp: number;
}

export interface EntityTrack {
  entityId: string;
  entityName: string;
  platformType: 'air' | 'land' | 'sea' | 'space';
  currentLocation: GeoLocation;
  trackHistory: GeoLocation[];
  status: 'online' | 'offline' | 'degraded';
  threatLevel: number;
  heading?: number;
  speed?: number;
  capability?: string;
}

export interface MapLayer {
  id: string;
  name: string;
  type: 'terrain' | 'satellite' | 'threat_heatmap' | 'network_mesh' | 'engagement_zone';
  visible: boolean;
  opacity: number;
  zIndex: number;
}

export interface TacticalAirspace {
  id: string;
  name: string;
  boundary: GeoLocation[];
  type: 'restricted' | 'contested' | 'friendly' | 'neutral';
  threatLevel: number;
  lastUpdated: number;
}

export interface EngagementZone {
  id: string;
  center: GeoLocation;
  radius: number; // meters
  threatLevel: number;
  activeThreats: string[];
  lastUpdated: number;
}

export class TacticalMapManager {
  private tracks: Map<string, EntityTrack> = new Map();
  private layers: Map<string, MapLayer> = new Map();
  private airspaces: Map<string, TacticalAirspace> = new Map();
  private engagementZones: Map<string, EngagementZone> = new Map();
  private playbackTime: number = Date.now();
  private isPlayingback: boolean = false;
  private playbackSpeed: number = 1.0;

  constructor() {
    this.initializeDefaultLayers();
  }

  private initializeDefaultLayers(): void {
    this.layers.set('terrain', {
      id: 'terrain',
      name: 'Terrain',
      type: 'terrain',
      visible: true,
      opacity: 1.0,
      zIndex: 0,
    });

    this.layers.set('threat_heatmap', {
      id: 'threat_heatmap',
      name: 'Threat Heatmap',
      type: 'threat_heatmap',
      visible: true,
      opacity: 0.6,
      zIndex: 10,
    });

    this.layers.set('network_mesh', {
      id: 'network_mesh',
      name: 'Network Mesh',
      type: 'network_mesh',
      visible: false,
      opacity: 0.8,
      zIndex: 15,
    });

    this.layers.set('engagement_zones', {
      id: 'engagement_zones',
      name: 'Engagement Zones',
      type: 'engagement_zone',
      visible: true,
      opacity: 0.4,
      zIndex: 20,
    });
  }

  updateEntityTrack(track: EntityTrack): void {
    const existing = this.tracks.get(track.entityId);

    if (existing) {
      existing.trackHistory.push(track.currentLocation);
      while (existing.trackHistory.length > 1000) {
        existing.trackHistory.shift();
      }
      Object.assign(existing, track);
    } else {
      track.trackHistory = [track.currentLocation];
      this.tracks.set(track.entityId, track);
    }
  }

  getEntityTrack(entityId: string): EntityTrack | undefined {
    return this.tracks.get(entityId);
  }

  getAllTracks(): EntityTrack[] {
    return Array.from(this.tracks.values());
  }

  getTracksByPlatformType(type: 'air' | 'land' | 'sea' | 'space'): EntityTrack[] {
    return Array.from(this.tracks.values()).filter((t) => t.platformType === type);
  }

  getTracksByThreatLevel(minThreat: number, maxThreat: number): EntityTrack[] {
    return Array.from(this.tracks.values()).filter(
      (t) => t.threatLevel >= minThreat && t.threatLevel <= maxThreat,
    );
  }

  getTracksInProximity(
    location: GeoLocation,
    radiusKm: number,
  ): EntityTrack[] {
    const proximityTracks: EntityTrack[] = [];

    for (const track of this.tracks.values()) {
      const distance = this.haversineDistance(location, track.currentLocation);
      if (distance <= radiusKm) {
        proximityTracks.push(track);
      }
    }

    return proximityTracks;
  }

  private haversineDistance(loc1: GeoLocation, loc2: GeoLocation): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.degToRad(loc2.latitude - loc1.latitude);
    const dLon = this.degToRad(loc2.longitude - loc1.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.degToRad(loc1.latitude)) *
        Math.cos(this.degToRad(loc2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private degToRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  createEngagementZone(zone: EngagementZone): void {
    this.engagementZones.set(zone.id, zone);
  }

  updateEngagementZone(zoneId: string, updates: Partial<EngagementZone>): void {
    const zone = this.engagementZones.get(zoneId);
    if (zone) {
      Object.assign(zone, updates);
      zone.lastUpdated = Date.now();
    }
  }

  getEngagementZones(): EngagementZone[] {
    return Array.from(this.engagementZones.values());
  }

  createAirspace(airspace: TacticalAirspace): void {
    this.airspaces.set(airspace.id, airspace);
  }

  getAirspaces(): TacticalAirspace[] {
    return Array.from(this.airspaces.values());
  }

  toggleLayer(layerId: string, visible: boolean): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.visible = visible;
    }
  }

  setLayerOpacity(layerId: string, opacity: number): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.opacity = Math.max(0, Math.min(1, opacity));
    }
  }

  getLayers(): MapLayer[] {
    return Array.from(this.layers.values()).sort((a, b) => a.zIndex - b.zIndex);
  }

  startPlayback(startTime: number, speed: number = 1.0): void {
    this.playbackTime = startTime;
    this.playbackSpeed = speed;
    this.isPlayingback = true;
  }

  stopPlayback(): void {
    this.isPlayingback = false;
  }

  setPlaybackTime(time: number): void {
    this.playbackTime = time;
  }

  advancePlayback(deltaMs: number): void {
    if (this.isPlayingback) {
      this.playbackTime += deltaMs * this.playbackSpeed;
    }
  }

  getPlaybackState() {
    return {
      isPlayingback: this.isPlayingback,
      currentTime: this.playbackTime,
      speed: this.playbackSpeed,
    };
  }

  getTrackAtTime(entityId: string, time: number): EntityTrack | null {
    const track = this.tracks.get(entityId);
    if (!track) return null;

    const relevantHistory = track.trackHistory.filter((loc) => loc.timestamp <= time);
    if (relevantHistory.length === 0) return null;

    const closestLocation = relevantHistory[relevantHistory.length - 1];

    return {
      ...track,
      currentLocation: closestLocation,
      trackHistory: relevantHistory,
    };
  }

  generateThreatHeatmap(): Map<string, number> {
    const heatmap = new Map<string, number>();
    const gridSize = 0.1; // 0.1 degree cells

    for (const track of this.tracks.values()) {
      const cellKey = this.getCellKey(track.currentLocation, gridSize);
      const currentHeat = heatmap.get(cellKey) || 0;
      heatmap.set(cellKey, currentHeat + track.threatLevel);
    }

    return heatmap;
  }

  private getCellKey(location: GeoLocation, gridSize: number): string {
    const latCell = Math.floor(location.latitude / gridSize);
    const lonCell = Math.floor(location.longitude / gridSize);
    return `${latCell},${lonCell}`;
  }

  computeNetworkMeshTopology(): Array<{
    sourceId: string;
    targetId: string;
    signalStrength: number;
    latency: number;
  }> {
    const topology: Array<{
      sourceId: string;
      targetId: string;
      signalStrength: number;
      latency: number;
    }> = [];

    const tracks = Array.from(this.tracks.values());
    const maxRange = 200; // km

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const distance = this.haversineDistance(
          tracks[i].currentLocation,
          tracks[j].currentLocation,
        );

        if (distance <= maxRange) {
          const signalStrength = Math.max(0, 1 - distance / maxRange);
          // Propagation estimate from range alone (~0.5 ms/km), not a measurement.
          // The previous random jitter made it look like observed link latency.
          const latency = Math.round(distance * 0.5);

          topology.push({
            sourceId: tracks[i].entityId,
            targetId: tracks[j].entityId,
            signalStrength,
            latency,
          });
        }
      }
    }

    return topology;
  }
}
