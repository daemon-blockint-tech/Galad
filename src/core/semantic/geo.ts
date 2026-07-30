/**
 * @file geo.ts
 * @description Shared spatial helpers for the semantic layer: great-circle distance
 * and position lookup against the semantic store's entity cache.
 */

import type { SemanticStore } from './semanticStore';

const EARTH_RADIUS_KM = 6371;

export interface EntityPosition {
  latitude: number;
  longitude: number;
  /** Observation time of the position, when the source supplied one. */
  timestamp?: number;
}

/**
 * Great-circle distance between two WGS84 points, in kilometres.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Read an entity's position from the store's entity cache.
 *
 * Returns null when the entity is unknown or carries no usable coordinates.
 * Callers must treat null as "position unknown" — never as 0,0, which is a
 * real location in the Gulf of Guinea.
 */
export function getEntityPosition(
  store: Pick<SemanticStore, 'getEntity'>,
  pluginId: string,
  entityId: string,
): EntityPosition | null {
  const entity: unknown = store.getEntity(pluginId, entityId);
  if (!entity || typeof entity !== 'object') return null;

  const { latitude, longitude, timestamp } = entity as {
    latitude?: unknown;
    longitude?: unknown;
    timestamp?: unknown;
  };

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude: latitude as number,
    longitude: longitude as number,
    timestamp: Number.isFinite(timestamp) ? (timestamp as number) : undefined,
  };
}
