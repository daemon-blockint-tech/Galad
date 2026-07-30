/**
 * @file ThreatCorrelationPanel.tsx
 * @description Panel showing the current threat level breakdown across entities.
 * Real-time updates as threats are detected and assessed.
 *
 * No timeline is charted: the semantic store keeps only a current threat
 * snapshot per entity (60s TTL, see threatInference), so there is no history to
 * bucket. This panel previously drew Math.random() bars under a "Threat
 * Timeline" heading.
 */

'use client';

import React, { useMemo } from 'react';
import { getGlobalSemanticStore } from '@/core/semantic/semanticStore';

interface ThreatStats {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export const ThreatCorrelationPanel: React.FC = () => {
  const store = getGlobalSemanticStore();

  const { stats, entityCount } = useMemo(() => {
    // Aggregate threat data
    const entities = store.getAllEntities();
    const statsLocal: ThreatStats = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };

    for (const entity of entities) {
      const threat = store.getThreatAssessment?.(entity.pluginId, entity.entityId);
      const level = threat?.threatLevel ?? 'unknown';

      statsLocal[level as keyof ThreatStats]++;
    }

    return { stats: statsLocal, entityCount: entities.length };
  }, [store]);

  const getThreatColor = (level: string): string => {
    switch (level) {
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
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-slate-950 text-slate-100 rounded-lg border border-slate-700 h-96 overflow-hidden">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold">Threat Levels</h2>
        <div className="text-xs text-slate-400">{entityCount} entities</div>
      </div>

      {/* No historical threat series exists to chart — say so rather than
          drawing something that looks like one. */}
      <div className="flex-1 flex items-center justify-center border border-dashed border-slate-700 rounded text-xs text-slate-400 text-center px-4">
        No threat history available — assessments are point-in-time only.
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-5 gap-2 text-xs">
        <div className="flex flex-col gap-1">
          <div className="font-semibold" style={{ color: getThreatColor('critical') }}>
            {stats.critical}
          </div>
          <div className="text-slate-400">Critical</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-semibold" style={{ color: getThreatColor('high') }}>
            {stats.high}
          </div>
          <div className="text-slate-400">High</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-semibold" style={{ color: getThreatColor('medium') }}>
            {stats.medium}
          </div>
          <div className="text-slate-400">Medium</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-semibold" style={{ color: getThreatColor('low') }}>
            {stats.low}
          </div>
          <div className="text-slate-400">Low</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-slate-400">{stats.unknown}</div>
          <div className="text-slate-400">Unknown</div>
        </div>
      </div>
    </div>
  );
};
