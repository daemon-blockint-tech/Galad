export interface SensorData {
  timestamp: number;
  sourceId: string;
  sourceType: 'anomaly_detector' | 'alert_engine' | 'correlation' | 'entity_state' | 'network_telemetry';
  entityId: string;
  confidence: number;
  data: Record<string, any>;
}

export interface FusedThreatSignal {
  entityId: string;
  threatLevel: number;
  threatScore: number;
  sources: string[];
  indicators: ThreatIndicator[];
  fusionTimestamp: number;
  ttl: number;
  confidence: number;
}

export interface ThreatIndicator {
  type: 'anomaly' | 'alert' | 'correlation' | 'behavioral' | 'network';
  description: string;
  severity: number;
  sourceId: string;
  timestamp: number;
  evidence: string[];
}

export interface SensorState {
  sensorId: string;
  sourceType: string;
  lastSeen: number;
  status: 'active' | 'degraded' | 'offline';
  reliability: number;
}

export class SensorFusion {
  private sensorBuffer: Map<string, SensorData[]> = new Map();
  private sensorStates: Map<string, SensorState> = new Map();
  private fusedSignals: Map<string, FusedThreatSignal> = new Map();
  private readonly MAX_BUFFER_SIZE = 1000;
  private readonly FUSION_WINDOW = 60000; // 60 seconds

  addSensorData(data: SensorData): void {
    const key = `${data.entityId}-${data.sourceType}`;
    if (!this.sensorBuffer.has(key)) {
      this.sensorBuffer.set(key, []);
    }

    const buffer = this.sensorBuffer.get(key)!;
    buffer.push(data);

    if (buffer.length > this.MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    this.updateSensorState(data.sourceId, data.sourceType, data.confidence);
  }

  private updateSensorState(
    sensorId: string,
    sourceType: string,
    confidence: number,
  ): void {
    const state: SensorState = {
      sensorId,
      sourceType,
      lastSeen: Date.now(),
      status: confidence > 0.7 ? 'active' : 'degraded',
      reliability: confidence,
    };
    this.sensorStates.set(sensorId, state);
  }

  fuseThreatSignals(entityId: string): FusedThreatSignal {
    const now = Date.now();
    const key = `${entityId}:${now}`;

    const relevantData = this.getSensorDataForEntity(entityId);
    const indicators = this.extractIndicators(relevantData);
    const threatLevel = this.calculateThreatLevel(indicators);
    const threatScore = this.calculateThreatScore(indicators);
    const sources = Array.from(new Set(relevantData.map((d) => d.sourceId)));
    const confidence = this.calculateConfidence(relevantData);

    const fusedSignal: FusedThreatSignal = {
      entityId,
      threatLevel,
      threatScore,
      sources,
      indicators,
      fusionTimestamp: now,
      ttl: this.FUSION_WINDOW,
      confidence,
    };

    this.fusedSignals.set(key, fusedSignal);
    this.pruneOldSignals();

    return fusedSignal;
  }

  private getSensorDataForEntity(entityId: string): SensorData[] {
    const now = Date.now();
    const data: SensorData[] = [];

    for (const [key, buffer] of this.sensorBuffer.entries()) {
      if (key.startsWith(entityId)) {
        const recent = buffer.filter((d) => now - d.timestamp < this.FUSION_WINDOW);
        data.push(...recent);
      }
    }

    return data;
  }

  private extractIndicators(data: SensorData[]): ThreatIndicator[] {
    const indicators: ThreatIndicator[] = [];
    const now = Date.now();

    for (const sensor of data) {
      let type: ThreatIndicator['type'] = 'behavioral';
      let severity = sensor.confidence * 100;
      const evidence: string[] = [];

      switch (sensor.sourceType) {
        case 'anomaly_detector':
          type = 'anomaly';
          if (sensor.data.anomalyScore) {
            severity = Math.min(100, sensor.data.anomalyScore);
          }
          if (sensor.data.pattern) {
            evidence.push(`Anomalous pattern: ${sensor.data.pattern}`);
          }
          break;

        case 'alert_engine':
          type = 'alert';
          if (sensor.data.severity) {
            const severityMap = { low: 20, medium: 50, high: 80, critical: 100 };
            severity = severityMap[sensor.data.severity as keyof typeof severityMap] || 50;
          }
          if (sensor.data.title) {
            evidence.push(`Alert: ${sensor.data.title}`);
          }
          break;

        case 'correlation':
          type = 'correlation';
          if (sensor.data.correlationStrength) {
            severity = sensor.data.correlationStrength * 100;
          }
          if (sensor.data.correlatedEntities) {
            evidence.push(
              `Correlated with ${sensor.data.correlatedEntities.length} entities`,
            );
          }
          break;

        case 'network_telemetry':
          type = 'network';
          if (sensor.data.suspiciousPackets) {
            severity = Math.min(100, sensor.data.suspiciousPackets * 5);
            evidence.push(`${sensor.data.suspiciousPackets} suspicious packets`);
          }
          break;

        case 'entity_state':
          type = 'behavioral';
          if (sensor.data.statusChange) {
            severity = 40;
            evidence.push(`Status changed to ${sensor.data.statusChange}`);
          }
          break;
      }

      indicators.push({
        type,
        description: sensor.data.description || `Detection from ${sensor.sourceType}`,
        severity: Math.min(100, severity),
        sourceId: sensor.sourceId,
        timestamp: sensor.timestamp,
        evidence,
      });
    }

    return indicators;
  }

  private calculateThreatLevel(indicators: ThreatIndicator[]): number {
    if (indicators.length === 0) return 0;

    const weights: Record<ThreatIndicator['type'], number> = {
      anomaly: 1.2,
      alert: 1.0,
      correlation: 0.9,
      behavioral: 0.8,
      network: 1.1,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const indicator of indicators) {
      const weight = weights[indicator.type] || 1.0;
      const sourceSensorState = this.sensorStates.get(indicator.sourceId);
      const sensorReliability = sourceSensorState?.reliability || 0.8;

      const adjustedSeverity = indicator.severity * sensorReliability;
      weightedSum += adjustedSeverity * weight;
      totalWeight += weight;
    }

    return Math.min(100, (weightedSum / totalWeight) * 1.1);
  }

  private calculateThreatScore(indicators: ThreatIndicator[]): number {
    if (indicators.length === 0) return 0;

    const avgSeverity =
      indicators.reduce((sum, ind) => sum + ind.severity, 0) / indicators.length;
    const indicatorDiversity = Math.min(1, indicators.length / 5);
    const temporalConvergence = this.getTemporalConvergence(indicators);

    const threatScore = (avgSeverity * 0.5 + indicatorDiversity * 100 * 0.3 + temporalConvergence * 0.2) / 100;
    return Math.min(1, Math.max(0, threatScore));
  }

  private getTemporalConvergence(indicators: ThreatIndicator[]): number {
    if (indicators.length < 2) return 0.5;

    const timestamps = indicators.map((i) => i.timestamp).sort((a, b) => a - b);
    const timeGaps = [];

    for (let i = 1; i < timestamps.length; i++) {
      timeGaps.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgGap = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
    const maxGap = Math.max(...timeGaps);

    const convergenceRatio = Math.max(0, 1 - avgGap / (this.FUSION_WINDOW / 2));
    return convergenceRatio;
  }

  private calculateConfidence(data: SensorData[]): number {
    if (data.length === 0) return 0;

    const activeSourceCount = Array.from(
      new Set(
        data
          .filter(
            (d) =>
              this.sensorStates.get(d.sourceId)?.status === 'active',
          )
          .map((d) => d.sourceId),
      ),
    ).length;

    const avgSensorConfidence =
      data.reduce((sum, d) => sum + d.confidence, 0) / data.length;

    const sourceRedundancy = Math.min(1, activeSourceCount / 3);

    return avgSensorConfidence * 0.6 + sourceRedundancy * 0.4;
  }

  private pruneOldSignals(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, signal] of this.fusedSignals.entries()) {
      if (now - signal.fusionTimestamp > signal.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.fusedSignals.delete(key));
  }

  getLatestSignal(entityId: string): FusedThreatSignal | null {
    let latest: FusedThreatSignal | null = null;
    let latestTime = 0;

    for (const [key, signal] of this.fusedSignals.entries()) {
      if (signal.entityId === entityId && signal.fusionTimestamp > latestTime) {
        latest = signal;
        latestTime = signal.fusionTimestamp;
      }
    }

    return latest;
  }

  getSensorHealth(): Record<string, SensorState> {
    const health: Record<string, SensorState> = {};
    const now = Date.now();

    for (const [sensorId, state] of this.sensorStates.entries()) {
      const isOnline = now - state.lastSeen < 120000;
      health[sensorId] = {
        ...state,
        status: isOnline ? state.status : 'offline',
      };
    }

    return health;
  }

  clearBuffers(): void {
    this.sensorBuffer.clear();
    this.fusedSignals.clear();
  }
}
