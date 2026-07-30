/**
 * @file DeduplicationStrategy.ts
 * @description Pluggable deduplication strategies for entity fusion.
 * Each strategy scores candidate pairs and recommends merges.
 */

export interface FusionCandidate {
  id1: string; // "pluginId|entityId"
  id2: string;
  pluginId1: string;
  entityId1: string;
  pluginId2: string;
  entityId2: string;
  score: number; // 0-1 confidence
  reasons: string[]; // ["spatial_proximity", "semantic_name"]
  metadata: Record<string, unknown>;
}

export interface Entity {
  id: string;
  pluginId: string;
  entityId: string;
  label?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp?: number;
  type?: string;
  disposition?: string;
  properties?: Record<string, unknown>;
}

export interface ScoringResult {
  spatialScore: number;
  semanticScore: number;
  temporalScore: number;
  overallScore: number;
}

export abstract class DeduplicationStrategy {
  abstract name: string;
  abstract score(entity1: Entity, entity2: Entity): Promise<ScoringResult>;
}

export class SpatialProximityStrategy extends DeduplicationStrategy {
  name = 'spatial_proximity';
  private readonly maxDistanceKm = 50; // Tunable threshold
  private readonly velocityAgreementWeight = 0.6;
  private readonly speedAgreementWeight = 0.4;

  async score(entity1: Entity, entity2: Entity): Promise<ScoringResult> {
    const spatialScore = this.calculateSpatialScore(entity1, entity2);
    const semanticScore = 0; // Not used for spatial strategy
    const temporalScore = this.calculateTemporalScore(entity1, entity2);

    return {
      spatialScore,
      semanticScore,
      temporalScore,
      // No spatial evidence (out of range or missing coords) => no proximity
      // match, regardless of the neutral temporal prior.
      overallScore: spatialScore === 0 ? 0 : spatialScore * 0.7 + temporalScore * 0.3,
    };
  }

  private calculateSpatialScore(e1: Entity, e2: Entity): number {
    if (!e1.latitude || !e1.longitude || !e2.latitude || !e2.longitude) {
      return 0;
    }

    const distanceKm = this.haversineDistance(
      e1.latitude,
      e1.longitude,
      e2.latitude,
      e2.longitude,
    );

    if (distanceKm > this.maxDistanceKm) {
      return 0;
    }

    // Closer = higher score
    const proximityScore = 1 - distanceKm / this.maxDistanceKm;

    // Boost if headings agree (within 30°)
    const headingScore =
      e1.heading !== undefined && e2.heading !== undefined
        ? this.calculateHeadingAgreement(e1.heading, e2.heading)
        : 0.5;

    // Boost if speeds agree (within 10%)
    const speedScore =
      e1.speed !== undefined && e2.speed !== undefined
        ? this.calculateSpeedAgreement(e1.speed, e2.speed)
        : 0.5;

    return (
      proximityScore * 0.5 +
      headingScore * this.velocityAgreementWeight * 0.3 +
      speedScore * this.speedAgreementWeight * 0.2
    );
  }

  private calculateTemporalScore(e1: Entity, e2: Entity): number {
    if (!e1.timestamp || !e2.timestamp) {
      return 0.5; // No temporal data, neutral
    }

    const timeDiffSeconds = Math.abs(e1.timestamp - e2.timestamp) / 1000;
    const maxTimeGapSeconds = 600; // 10 minutes

    if (timeDiffSeconds > maxTimeGapSeconds) {
      return 0;
    }

    return 1 - timeDiffSeconds / maxTimeGapSeconds;
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private calculateHeadingAgreement(h1: number, h2: number): number {
    const diff = Math.abs(h1 - h2);
    const normalizedDiff = Math.min(diff, 360 - diff);
    const maxDeviation = 30; // degrees
    return Math.max(0, 1 - normalizedDiff / maxDeviation);
  }

  private calculateSpeedAgreement(s1: number, s2: number): number {
    const maxSpeed = Math.max(s1, s2);
    if (maxSpeed === 0) return 1; // Both stationary, perfect match
    const percentDiff = Math.abs(s1 - s2) / maxSpeed;
    return Math.max(0, 1 - percentDiff);
  }
}

export class SemanticNameStrategy extends DeduplicationStrategy {
  name = 'semantic_name';
  private readonly minSimilarity = 0.7;

  async score(entity1: Entity, entity2: Entity): Promise<ScoringResult> {
    const semanticScore = this.calculateSemanticScore(entity1, entity2);
    const spatialScore = 0;
    const temporalScore = 0;

    return {
      spatialScore,
      semanticScore,
      temporalScore,
      overallScore: semanticScore,
    };
  }

  private calculateSemanticScore(e1: Entity, e2: Entity): number {
    const label1 = e1.label?.toLowerCase() || '';
    const label2 = e2.label?.toLowerCase() || '';

    if (!label1 || !label2) return 0;

    const similarity = this.levenshteinSimilarity(label1, label2);
    if (similarity < this.minSimilarity) return 0;

    // Type/disposition agreement: bonus when both are known and equal,
    // penalty when both are known and differ (a vessel and an aircraft are
    // not the same contact however identical their labels).
    const typeMatch =
      e1.type && e2.type ? (e1.type === e2.type ? 0.2 : -0.2) : 0;
    const dispositionMatch =
      e1.disposition && e2.disposition
        ? e1.disposition === e2.disposition
          ? 0.1
          : -0.1
        : 0;

    return Math.max(0, Math.min(1, similarity + typeMatch + dispositionMatch));
  }

  private levenshteinSimilarity(s1: string, s2: string): number {
    const maxLen = Math.max(s1.length, s2.length);
    // Edit distance is at least the length difference, so a length gap alone
    // can rule the pair out before doing the O(n·m) work.
    if (1 - Math.abs(s1.length - s2.length) / maxLen < this.minSimilarity) {
      return 0;
    }
    const distance = this.levenshteinDistance(s1, s2);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const len1 = s1.length;
    const len2 = s2.length;

    // Two rolling rows instead of a full matrix: this runs on every candidate
    // pair (O(n²) pairs), so the per-call allocation is what costs.
    let prev = Array.from({ length: len2 + 1 }, (_, j) => j);
    let curr = new Array<number>(len2 + 1);

    for (let i = 1; i <= len1; i++) {
      curr[0] = i;
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1, // deletion
          curr[j - 1] + 1, // insertion
          prev[j - 1] + cost, // substitution
        );
      }
      [prev, curr] = [curr, prev];
    }

    return prev[len2];
  }
}

export class TemporalCoherenceStrategy extends DeduplicationStrategy {
  name = 'temporal_coherence';
  private readonly maxTraceLengthKm = 100; // Max distance an entity can travel between observations

  async score(entity1: Entity, entity2: Entity): Promise<ScoringResult> {
    const temporalScore = this.calculateTemporalScore(entity1, entity2);
    const spatialScore = 0;
    const semanticScore = 0;

    return {
      spatialScore,
      semanticScore,
      temporalScore,
      overallScore: temporalScore,
    };
  }

  private calculateTemporalScore(e1: Entity, e2: Entity): number {
    if (
      !e1.latitude ||
      !e1.longitude ||
      !e2.latitude ||
      !e2.longitude ||
      !e1.timestamp ||
      !e2.timestamp ||
      !e1.speed
    ) {
      return 0;
    }

    const timeDiffSeconds = Math.abs(e1.timestamp - e2.timestamp) / 1000;
    const expectedDistanceKm = (e1.speed * timeDiffSeconds) / 3600; // speed in knots → km
    const actualDistanceKm = this.calculateDistance(
      e1.latitude,
      e1.longitude,
      e2.latitude,
      e2.longitude,
    );

    if (actualDistanceKm > this.maxTraceLengthKm) {
      return 0;
    }

    const distanceDeviation = Math.abs(actualDistanceKm - expectedDistanceKm);
    const maxDeviation = expectedDistanceKm * 0.3; // Allow 30% deviation

    return Math.max(0, 1 - distanceDeviation / maxDeviation);
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
