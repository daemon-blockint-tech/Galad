'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw, Settings } from 'lucide-react';
import { EntityManagementPanel } from './EntityManagementPanel';
import { EntityDetailView } from './EntityDetailView';
import { AssetHierarchy } from './AssetHierarchy';
import { C2CommandInterface } from './C2CommandInterface';

interface Entity {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'error' | 'unknown' | 'live' | 'degraded';
  checks?: number;
  entityId: string;
  provenance: string;
  ontology: string;
  capabilities: string[];
  platformType: string;
  threatLevel: number;
  lastUpdated?: number;
}

type ViewMode = 'explorer' | 'hierarchy' | 'dashboard';

export function C2Dashboard() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('explorer');
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  // Load entities
  const loadEntities = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ops/c2/entities?limit=100');
      if (response.ok) {
        const data = await response.json();
        setEntities(data.data || []);
        setLastRefresh(Date.now());
      }
    } catch (error) {
      console.error('Failed to load entities:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load entities on mount
  useEffect(() => {
    loadEntities();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadEntities, 30000);
    return () => clearInterval(interval);
  }, [loadEntities]);

  const handleSelectEntity = (entity: Entity) => {
    setSelectedEntity(entity);
  };

  const handleDeleteEntities = async (ids: string[]) => {
    try {
      const response = await fetch('/api/ops/c2/entities', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityIds: ids }),
      });

      if (response.ok) {
        setEntities(entities.filter((e) => !ids.includes(e.id)));
        setSelectedEntity(null);
      }
    } catch (error) {
      console.error('Failed to delete entities:', error);
    }
  };

  const buildHierarchyNodes = (entities: Entity[]) => {
    // Group by platform type for hierarchy
    const groups = new Map<string, Entity[]>();

    for (const entity of entities) {
      const key = entity.platformType;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(entity);
    }

    return Array.from(groups.entries()).map(([type, items]) => ({
      id: type,
      label: type,
      status: items.some((e) => e.status === 'error') ? ('error' as const) : ('online' as const),
      type: 'group',
      metadata: {
        platformType: type,
      },
      children: items.map((entity) => ({
        id: entity.id,
        label: entity.name,
        status: entity.status,
        type: entity.ontology,
        metadata: {
          ontology: entity.ontology,
          platformType: entity.platformType,
          threatLevel: entity.threatLevel,
        },
      })),
    }));
  };

  const statusSummary = {
    online: entities.filter((e) => e.status === 'online' || e.status === 'live').length,
    offline: entities.filter((e) => e.status === 'offline').length,
    error: entities.filter((e) => e.status === 'error').length,
    degraded: entities.filter((e) => e.status === 'degraded').length,
    avgThreat: entities.length > 0 ? (entities.reduce((sum, e) => sum + e.threatLevel, 0) / entities.length * 100).toFixed(0) : 0,
  };

  return (
    <div className="w-full h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">C2 Command & Control</h1>
            <p className="text-sm text-slate-400 mt-1">Entity management, monitoring, and control interface</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadEntities}
              disabled={isLoading}
              className="p-2 hover:bg-slate-800 text-slate-400 rounded transition disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
            </button>

            <button
              className="p-2 hover:bg-slate-800 text-slate-400 rounded transition"
              title="Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-5 gap-3">
          <div className="px-4 py-2 bg-slate-800/50 rounded border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">ONLINE</div>
            <div className="text-lg font-semibold text-green-400">{statusSummary.online}</div>
          </div>

          <div className="px-4 py-2 bg-slate-800/50 rounded border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">OFFLINE</div>
            <div className="text-lg font-semibold text-red-400">{statusSummary.offline}</div>
          </div>

          <div className="px-4 py-2 bg-slate-800/50 rounded border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">ERROR</div>
            <div className="text-lg font-semibold text-orange-400">{statusSummary.error}</div>
          </div>

          <div className="px-4 py-2 bg-slate-800/50 rounded border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">DEGRADED</div>
            <div className="text-lg font-semibold text-yellow-400">{statusSummary.degraded}</div>
          </div>

          <div className="px-4 py-2 bg-slate-800/50 rounded border border-slate-700">
            <div className="text-xs text-slate-500 mb-1">AVG THREAT</div>
            <div className="text-lg font-semibold text-blue-400">{statusSummary.avgThreat}%</div>
          </div>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900 px-6">
        {(['explorer', 'hierarchy', 'dashboard'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-4 py-3 text-sm font-medium transition capitalize ${
              viewMode === mode
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex gap-0 overflow-hidden">
        {viewMode === 'explorer' ? (
          <>
            <div className="flex-1 min-w-0">
              <EntityManagementPanel
                entities={entities}
                onSelectEntity={handleSelectEntity}
                onDeleteEntity={(id) => handleDeleteEntities([id])}
                isLoading={isLoading}
                selectedEntityIds={selectedEntityIds}
              />
            </div>

            {selectedEntity && (
              <>
                <div className="w-96 border-l border-slate-800 overflow-hidden">
                  <EntityDetailView entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
                </div>

                <div className="w-96 border-l border-slate-800 overflow-hidden">
                  <C2CommandInterface
                    entityId={selectedEntity.id}
                    entityName={selectedEntity.name}
                  />
                </div>
              </>
            )}
          </>
        ) : viewMode === 'hierarchy' ? (
          <>
            <div className="flex-1 min-w-0 overflow-hidden border-r border-slate-800">
              <AssetHierarchy
                nodes={buildHierarchyNodes(entities)}
                onSelectNode={(node) => {
                  const entity = entities.find((e) => e.id === node.id);
                  if (entity) {
                    setSelectedEntity(entity);
                  }
                }}
                selectedNodeId={selectedEntity?.id}
              />
            </div>

            {selectedEntity && (
              <>
                <div className="w-96 border-r border-slate-800 overflow-hidden">
                  <EntityDetailView entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
                </div>

                <div className="w-96 overflow-hidden">
                  <C2CommandInterface
                    entityId={selectedEntity.id}
                    entityName={selectedEntity.name}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex-1 p-6 flex items-center justify-center">
            <div className="text-center">
              <AlertCircle size={48} className="mx-auto text-slate-500 mb-4" />
              <h3 className="text-lg font-semibold text-slate-300 mb-2">Dashboard View</h3>
              <p className="text-slate-500">
                Comprehensive threat intelligence dashboard with integrated visualization and analytics
              </p>
              <p className="text-xs text-slate-600 mt-4">Entities: {entities.length} | Last refresh: {new Date(lastRefresh).toLocaleTimeString()}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
