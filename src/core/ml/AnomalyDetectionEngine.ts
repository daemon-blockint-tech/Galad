/**
 * @file AnomalyDetectionEngine.ts
 * @description ML-powered anomaly detection using isolation forest.
 * Detects unusual entity behavior patterns in real-time.
 */

import { SemanticStore } from '@/core/semantic/semanticStore';

export interface EntityBehavior {
  entityId: string;
  pluginId: string;
  timestamp: number;
  features: {
    speed: number;
    acceleration: number;
    heading: number;
    headingChange: number;
    proximity: number; // Distance to other entities
    activityLevel: number; // 0-1
    deviceAnomalyCount: number;
  };
}

export interface AnomalyScore {
  entityId: string;
  score: number; // 0-1, higher = more anomalous
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  indicators: string[];
  baselineDeviation: number; // Standard deviations from mean
  timestamp: number;
}

export interface BehaviorBaseline {
  entityId: string;
  pluginId: string;
  mean: Record<string, number>;
  stdDev: Record<string, number>;
  sampleCount: number;
  lastUpdated: number;
}

/**
 * Isolation Forest implementation for anomaly detection.
 * Fast O(n log n) algorithm suitable for real-time detection.
 */
export class IsolationForest {
  private trees: IsolationTree[] = [];
  private maxDepth: number;
  private numTrees: number;
  /** Subsample size each tree was built from — drives the score normaliser. */
  private sampleSize = 0;

  constructor(numTrees: number = 100, maxDepth: number = 10) {
    this.numTrees = numTrees;
    this.maxDepth = maxDepth;
  }

  /**
   * Train forest on dataset.
   */
  train(data: EntityBehavior[]): void {
    this.trees = [];
    this.sampleSize = Math.ceil(Math.sqrt(data.length));

    for (let i = 0; i < this.numTrees; i++) {
      const sample = this.randomSample(data, this.sampleSize);
      const tree = new IsolationTree(this.maxDepth);
      tree.build(sample);
      this.trees.push(tree);
    }
  }

  isTrained(): boolean {
    return this.trees.length > 0;
  }

  /**
   * Score a single data point (higher = more anomalous).
   */
  score(point: EntityBehavior): number {
    if (this.trees.length === 0) {
      // A score of 0 from an untrained forest is indistinguishable from
      // "measured and normal", so refuse instead of reporting a clean sweep.
      throw new Error('IsolationForest is not trained: call train() before score()');
    }

    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += tree.pathLength(point);
    }

    const avgPathLength = totalPathLength / this.trees.length;
    const c = this.normalizer();

    return Math.pow(2, -avgPathLength / c);
  }

  /**
   * Expected path length c(n) of an unsuccessful BST search over n points —
   * the standard isolation-forest normaliser, evaluated at the subsample size
   * the trees were built from. Degenerate for n <= 2, where the standard
   * formulation uses 1 (leaving the raw 2^-E[h(x)] score).
   */
  private normalizer(): number {
    const n = this.sampleSize;
    if (n <= 2) return 1;
    return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
  }

  private randomSample<T>(data: T[], size: number): T[] {
    const sample: T[] = [];
    const indices = new Set<number>();

    while (indices.size < Math.min(size, data.length)) {
      indices.add(Math.floor(Math.random() * data.length));
    }

    for (const idx of indices) {
      sample.push(data[idx]);
    }

    return sample;
  }
}

class IsolationTree {
  private root: IsolationNode | null = null;
  private maxDepth: number;

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  build(data: EntityBehavior[]): void {
    this.root = this.buildRecursive(data, 0);
  }

  private buildRecursive(data: EntityBehavior[], depth: number): IsolationNode {
    if (depth >= this.maxDepth || data.length <= 1) {
      return new IsolationNode(null, null, null, data.length);
    }

    // Randomly select feature and split value
    const features = Object.keys(data[0].features);
    const featureName = features[Math.floor(Math.random() * features.length)] as keyof EntityBehavior['features'];
    const featureValues = data.map((d) => d.features[featureName]);
    const minVal = Math.min(...featureValues);
    const maxVal = Math.max(...featureValues);
    const splitValue = minVal + Math.random() * (maxVal - minVal);

    // Partition data
    const left = data.filter((d) => d.features[featureName] < splitValue);
    const right = data.filter((d) => d.features[featureName] >= splitValue);

    return new IsolationNode(
      this.buildRecursive(left, depth + 1),
      this.buildRecursive(right, depth + 1),
      { feature: featureName, value: splitValue },
      data.length,
    );
  }

  pathLength(point: EntityBehavior): number {
    return this.pathLengthRecursive(this.root, point, 0);
  }

  private pathLengthRecursive(node: IsolationNode | null, point: EntityBehavior, depth: number): number {
    if (!node || node.isLeaf) {
      return depth + this.c(node?.size ?? 0);
    }

    const split = node.split!;
    const value = point.features[split.feature as keyof EntityBehavior['features']];

    if (value < split.value) {
      return this.pathLengthRecursive(node.left, point, depth + 1);
    } else {
      return this.pathLengthRecursive(node.right, point, depth + 1);
    }
  }

  private c(n: number): number {
    if (n <= 1) return 0;
    return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
  }
}

class IsolationNode {
  left: IsolationNode | null;
  right: IsolationNode | null;
  split: { feature: string; value: number } | null;
  isLeaf: boolean;
  size: number;

  constructor(
    left: IsolationNode | null,
    right: IsolationNode | null,
    split: { feature: string; value: number } | null,
    size: number,
  ) {
    this.left = left;
    this.right = right;
    this.split = split;
    this.isLeaf = split === null;
    this.size = size;
  }
}

/** Minimum observations before the isolation forest can be trained. */
const MIN_TRAINING_SAMPLES = 100;

/**
 * Anomaly Detection Engine using ML.
 */
export class AnomalyDetectionEngine {
  private store: SemanticStore;
  private forest: IsolationForest;
  private baselines: Map<string, BehaviorBaseline> = new Map();
  private behaviorHistory: EntityBehavior[] = [];
  private maxHistorySize = 10000;

  constructor(store: SemanticStore) {
    this.store = store;
    this.forest = new IsolationForest(100, 10);
  }

  /**
   * Record entity behavior observation.
   */
  recordBehavior(behavior: EntityBehavior): void {
    // Validate behavior.features schema
    const requiredFeatures = ['speed', 'acceleration', 'heading', 'headingChange', 'proximity', 'activityLevel', 'deviceAnomalyCount'];
    for (const feature of requiredFeatures) {
      if (!(feature in behavior.features)) {
        throw new Error(`Missing required feature: ${feature}`);
      }
      const value = behavior.features[feature as keyof typeof behavior.features];
      if (typeof value !== 'number') {
        throw new Error(`Feature ${feature} must be a number, got ${typeof value}`);
      }
    }

    this.behaviorHistory.push(behavior);

    if (this.behaviorHistory.length > this.maxHistorySize) {
      this.behaviorHistory.shift();
    }

    // Update baseline
    this.updateBaseline(behavior);
  }

  /**
   * Train anomaly detection model on historical data.
   *
   * Throws on insufficient data: a silent no-op left callers reporting a
   * successfully trained model that had zero trees.
   */
  trainModel(): void {
    if (this.behaviorHistory.length < MIN_TRAINING_SAMPLES) {
      throw new Error(
        `Insufficient data for model training: have ${this.behaviorHistory.length}, need ${MIN_TRAINING_SAMPLES}+ samples`,
      );
    }

    this.forest.train(this.behaviorHistory);
  }

  /**
   * Detect anomalies in current entity behaviors.
   */
  detectAnomalies(behaviors: EntityBehavior[]): AnomalyScore[] {
    if (!this.forest.isTrained()) {
      throw new Error(
        'Anomaly model is not trained: cannot report anomaly scores (call trainModel() first)',
      );
    }

    const scores: AnomalyScore[] = [];

    for (const behavior of behaviors) {
      const mlScore = this.forest.score(behavior);
      const baselineScore = this.computeBaselineDeviation(behavior);
      const combinedScore = mlScore * 0.6 + baselineScore * 0.4;

      const severity = this.scoreToSeverity(combinedScore);
      const indicators = this.extractIndicators(behavior, baselineScore);

      scores.push({
        entityId: behavior.entityId,
        score: combinedScore,
        severity,
        indicators,
        baselineDeviation: baselineScore,
        timestamp: behavior.timestamp,
      });
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Compute deviation from baseline (in standard deviations).
   */
  private computeBaselineDeviation(behavior: EntityBehavior): number {
    const key = `${behavior.pluginId}:${behavior.entityId}`;
    const baseline = this.baselines.get(key);

    if (!baseline) return 0;

    let totalDeviation = 0;
    let count = 0;

    for (const [featureName, value] of Object.entries(behavior.features)) {
      const mean = baseline.mean[featureName] ?? 0;
      const stdDev = baseline.stdDev[featureName] ?? 1;

      if (stdDev > 0) {
        const deviation = Math.abs((value - mean) / stdDev);
        totalDeviation += Math.min(deviation, 5); // Cap at 5 sigma
        count++;
      }
    }

    return count > 0 ? Math.min(1, totalDeviation / count / 5) : 0;
  }

  /**
   * Update behavior baseline (rolling mean/stddev).
   */
  private updateBaseline(behavior: EntityBehavior): void {
    const key = `${behavior.pluginId}:${behavior.entityId}`;
    const baseline = this.baselines.get(key);

    if (!baseline) {
      // Initialize baseline
      const mean: Record<string, number> = {};
      const stdDev: Record<string, number> = {};

      for (const [featureName, value] of Object.entries(behavior.features)) {
        mean[featureName] = value;
        stdDev[featureName] = 0.1; // Initial uncertainty
      }

      this.baselines.set(key, {
        entityId: behavior.entityId,
        pluginId: behavior.pluginId,
        mean,
        stdDev,
        sampleCount: 1,
        lastUpdated: behavior.timestamp,
      });

      return;
    }

    // Exponential moving average update
    const alpha = 0.1; // Learning rate
    const n = baseline.sampleCount;

    for (const [featureName, value] of Object.entries(behavior.features)) {
      const oldMean = baseline.mean[featureName] ?? 0;
      const newMean = oldMean * (1 - alpha) + value * alpha;
      baseline.mean[featureName] = newMean;

      // Update standard deviation (using old mean for deviation calculation)
      const oldStdDev = baseline.stdDev[featureName] ?? 0.1;
      const variance = Math.pow(value - oldMean, 2);
      const newVariance = Math.pow(oldStdDev, 2) * (1 - alpha) + variance * alpha;
      baseline.stdDev[featureName] = Math.sqrt(newVariance);
    }

    baseline.sampleCount++;
    baseline.lastUpdated = behavior.timestamp;
  }

  private scoreToSeverity(score: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.4) return 'medium';
    if (score >= 0.2) return 'low';
    return 'none';
  }

  private extractIndicators(behavior: EntityBehavior, baselineDeviation: number): string[] {
    const indicators: string[] = [];

    // Speed anomaly
    if (behavior.features.speed > 1000) {
      indicators.push('excessive_speed');
    }

    // Acceleration anomaly
    if (behavior.features.acceleration > 500) {
      indicators.push('high_acceleration');
    }

    // Heading change
    if (behavior.features.headingChange > 90) {
      indicators.push('sharp_turn');
    }

    // Baseline deviation
    if (baselineDeviation > 0.7) {
      indicators.push('baseline_deviation');
    }

    // Proximity to others
    if (behavior.features.proximity < 0.5) {
      indicators.push('close_proximity');
    }

    return indicators;
  }

  /**
   * Get baseline for an entity.
   */
  getBaseline(pluginId: string, entityId: string): BehaviorBaseline | null {
    const key = `${pluginId}:${entityId}`;
    return this.baselines.get(key) ?? null;
  }

  /**
   * Get model statistics.
   */
  getStats(): {
    trainingDataSize: number;
    baselineCount: number;
    modelsCount: number;
  } {
    return {
      trainingDataSize: this.behaviorHistory.length,
      baselineCount: this.baselines.size,
      modelsCount: this.forest.isTrained() ? 1 : 0, // Single isolation forest
    };
  }
}
