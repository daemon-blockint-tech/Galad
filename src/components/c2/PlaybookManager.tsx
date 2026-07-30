'use client';

import React, { useState } from 'react';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  ChevronDown,
  ChevronUp,
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

interface PlaybookManagerProps {
  entityId?: string;
  entityName?: string;
}

export function PlaybookManager({ entityName }: PlaybookManagerProps) {
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

  const [expandedPlaybookId, setExpandedPlaybookId] = useState<string | null>(null);
  const [showNewPlaybookForm, setShowNewPlaybookForm] = useState(false);

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
                  {/*
                    Execution is disabled, not simulated: there is no server path
                    that runs a playbook, so a click could only ever report an
                    outcome that did not happen.
                  */}
                  <button
                    disabled
                    className="p-1.5 disabled:hover:bg-transparent text-slate-600 rounded transition"
                    title="Playbook execution is not implemented"
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

      {/* Execution Availability */}
      <div className="text-xs text-amber-400/80 p-3 bg-amber-900/10 border border-amber-700/40 rounded">
        <p className="font-semibold text-amber-400 mb-1">Execution unavailable</p>
        <p>
          Playbook execution is not implemented. No command is issued and no containment
          action is taken
          {entityName ? ` on ${entityName}` : ''} — isolate, block and quarantine must be
          run from the owning security console.
        </p>
      </div>
    </div>
  );
}
