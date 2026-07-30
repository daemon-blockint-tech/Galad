'use client';

import React, { useState } from 'react';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  GitBranch,
} from 'lucide-react';

interface PlaybookAction {
  id: string;
  type: 'command' | 'condition' | 'delay' | 'notification' | 'parallel';
  commandId?: string;
  delayMs?: number;
  notificationMessage?: string;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  actions: PlaybookAction[];
  enabled: boolean;
}

interface PlaybookExecution {
  id: string;
  playbookId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime: number;
  duration?: number;
}

interface PlaybookManagerProps {
  entityId?: string;
  entityName?: string;
  onPlaybookExecute?: (playbookId: string) => void;
}

export function PlaybookManager({ entityId, entityName, onPlaybookExecute }: PlaybookManagerProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([
    {
      id: 'pb-isolate-respond',
      name: 'Isolate & Respond',
      description: 'Isolate entity and collect forensics',
      actions: [
        { id: 'act-1', type: 'command', commandId: 'isolate' },
        { id: 'act-2', type: 'delay', delayMs: 5000 },
        { id: 'act-3', type: 'command', commandId: 'collect' },
      ],
      enabled: true,
    },
    {
      id: 'pb-block-notify',
      name: 'Block & Notify',
      description: 'Block malicious IP and notify SOC',
      actions: [
        { id: 'act-4', type: 'command', commandId: 'block_ip' },
        { id: 'act-5', type: 'notification', notificationMessage: 'IP blocked and escalated to SOC' },
      ],
      enabled: true,
    },
    {
      id: 'pb-quarantine-scan',
      name: 'Quarantine & Scan',
      description: 'Quarantine suspected file and perform scan',
      actions: [
        { id: 'act-6', type: 'command', commandId: 'quarantine' },
        { id: 'act-7', type: 'delay', delayMs: 2000 },
        { id: 'act-8', type: 'notification', notificationMessage: 'File quarantined, scan initiated' },
      ],
      enabled: true,
    },
  ]);

  const [executions, setExecutions] = useState<PlaybookExecution[]>([]);
  const [expandedPlaybookId, setExpandedPlaybookId] = useState<string | null>(null);
  const [showNewPlaybookForm, setShowNewPlaybookForm] = useState(false);

  const handleExecutePlaybook = async (playbookId: string) => {
    const executionId = `exec-${playbookId}-${Date.now()}`;
    const execution: PlaybookExecution = {
      id: executionId,
      playbookId,
      status: 'running',
      startTime: Date.now(),
    };

    setExecutions((prev) => [execution, ...prev]);
    onPlaybookExecute?.(playbookId);

    // Simulate execution
    setTimeout(() => {
      setExecutions((prev) =>
        prev.map((e) =>
          e.id === executionId
            ? {
                ...e,
                status: Math.random() > 0.2 ? 'success' : 'failed',
                duration: Date.now() - e.startTime,
              }
            : e,
        ),
      );
    }, 3000);
  };

  const handleTogglePlaybook = (playbookId: string) => {
    setPlaybooks((prev) =>
      prev.map((pb) => (pb.id === playbookId ? { ...pb, enabled: !pb.enabled } : pb)),
    );
  };

  const handleDeletePlaybook = (playbookId: string) => {
    setPlaybooks((prev) => prev.filter((pb) => pb.id !== playbookId));
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'command':
        return <Zap size={14} className="text-blue-400" />;
      case 'delay':
        return <Clock size={14} className="text-yellow-400" />;
      case 'condition':
        return <GitBranch size={14} className="text-purple-400" />;
      case 'notification':
        return <AlertCircle size={14} className="text-green-400" />;
      default:
        return <Zap size={14} className="text-slate-400" />;
    }
  };

  const getActionLabel = (action: PlaybookAction): string => {
    switch (action.type) {
      case 'command':
        return `Execute: ${action.commandId}`;
      case 'delay':
        return `Wait ${action.delayMs}ms`;
      case 'notification':
        return `Notify: ${action.notificationMessage?.substring(0, 30)}...`;
      default:
        return action.type;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Mission Playbooks</h3>
        <button
          onClick={() => setShowNewPlaybookForm(!showNewPlaybookForm)}
          className="p-1.5 hover:bg-slate-800 text-slate-400 rounded transition"
          title="Create playbook"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* New Playbook Form */}
      {showNewPlaybookForm && (
        <div className="p-3 bg-slate-800/50 border border-slate-700 rounded space-y-3">
          <input
            type="text"
            placeholder="Playbook name"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Description"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button className="flex-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition">
              Create
            </button>
            <button
              onClick={() => setShowNewPlaybookForm(false)}
              className="flex-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Playbooks List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {playbooks.map((playbook) => {
          const isExpanded = expandedPlaybookId === playbook.id;
          const recentExecution = executions.find((e) => e.playbookId === playbook.id);

          return (
            <div
              key={playbook.id}
              className="bg-slate-800/30 border border-slate-700 rounded hover:bg-slate-800/50 transition"
            >
              {/* Playbook Header */}
              <div className="p-3 flex items-start justify-between gap-2">
                <button
                  onClick={() => setExpandedPlaybookId(isExpanded ? null : playbook.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp size={16} className="text-slate-400" />
                      ) : (
                        <ChevronDown size={16} className="text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-slate-100 truncate">{playbook.name}</h4>
                      <p className="text-xs text-slate-500 truncate">{playbook.description}</p>
                    </div>
                  </div>
                </button>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {recentExecution && (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        recentExecution.status === 'success'
                          ? 'bg-green-900/30 text-green-400'
                          : recentExecution.status === 'failed'
                            ? 'bg-red-900/30 text-red-400'
                            : 'bg-blue-900/30 text-blue-400'
                      }`}
                    >
                      {recentExecution.status === 'running' && (
                        <Pause size={12} className="animate-pulse" />
                      )}
                      {recentExecution.status === 'success' && <CheckCircle2 size={12} />}
                      {recentExecution.status === 'failed' && <AlertCircle size={12} />}
                      <span className="capitalize">{recentExecution.status}</span>
                    </div>
                  )}

                  <button
                    onClick={() => handleExecutePlaybook(playbook.id)}
                    disabled={!entityId || !playbook.enabled}
                    className="p-1.5 hover:bg-blue-900/30 disabled:hover:bg-transparent text-blue-400 disabled:text-slate-600 rounded transition"
                    title="Execute playbook"
                  >
                    <Play size={14} />
                  </button>

                  <button
                    onClick={() => handleTogglePlaybook(playbook.id)}
                    className={`p-1.5 rounded transition ${
                      playbook.enabled
                        ? 'hover:bg-slate-700 text-slate-400'
                        : 'hover:bg-slate-700 text-slate-600'
                    }`}
                    title={playbook.enabled ? 'Disable' : 'Enable'}
                  >
                    <Pause size={14} />
                  </button>

                  <button
                    onClick={() => handleDeletePlaybook(playbook.id)}
                    className="p-1.5 hover:bg-red-900/30 text-red-400 rounded transition"
                    title="Delete playbook"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Actions List */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-slate-700 pt-2 space-y-2">
                  {playbook.actions.map((action, index) => (
                    <div key={action.id} className="flex items-start gap-2 text-xs">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex-shrink-0">{getActionIcon(action.type)}</div>
                        <div className="min-w-0">
                          <span className="text-slate-300 truncate">{getActionLabel(action)}</span>
                        </div>
                      </div>

                      {index < playbook.actions.length - 1 && (
                        <div className="flex-shrink-0 text-slate-600">↓</div>
                      )}
                    </div>
                  ))}

                  {/* Add Action Button */}
                  <button className="w-full text-left px-2 py-1.5 hover:bg-slate-800 rounded text-xs text-slate-500 hover:text-slate-400 transition border border-dashed border-slate-700">
                    + Add action
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Automation Rules Info */}
      <div className="text-xs text-slate-500 p-3 bg-slate-800/20 border border-slate-700/50 rounded">
        <p className="font-semibold text-slate-400 mb-1">🤖 Autonomous Response</p>
        <p>Playbooks can be triggered automatically based on threat levels and status changes.</p>
      </div>

      {/* Recent Executions */}
      {executions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-400">Recent Executions</h4>
          {executions.slice(0, 5).map((execution) => {
            const playbook = playbooks.find((pb) => pb.id === execution.playbookId);
            return (
              <div
                key={execution.id}
                className="flex items-center justify-between p-2 bg-slate-800/30 border border-slate-700 rounded text-xs"
              >
                <span className="text-slate-300">{playbook?.name}</span>
                <div className="flex items-center gap-2">
                  {execution.status === 'success' && (
                    <CheckCircle2 size={14} className="text-green-400" />
                  )}
                  {execution.status === 'failed' && <AlertCircle size={14} className="text-red-400" />}
                  {execution.status === 'running' && (
                    <Pause size={14} className="text-blue-400 animate-pulse" />
                  )}
                  {execution.duration && (
                    <span className="text-slate-500">{(execution.duration / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
