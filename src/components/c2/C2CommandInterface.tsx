'use client';

import React, { useState, useEffect } from 'react';
import { Send, Loader2, CheckCircle2, AlertCircle, Clock, Copy } from 'lucide-react';

interface Command {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Actuating commands have no endpoint integration; the server refuses them. */
  unavailable?: boolean;
  parameters?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    required?: boolean;
    options?: string[];
  }>;
}

interface ExecutionResult {
  commandId: string;
  entityId: string;
  status: 'pending' | 'executing' | 'success' | 'failed' | 'timeout';
  result?: any;
  error?: string;
  executedAt: number;
  duration?: number;
}

interface C2CommandInterfaceProps {
  entityId?: string;
  entityName?: string;
  onCommandExecuted?: (result: ExecutionResult) => void;
}

const COMMON_COMMANDS: Command[] = [
  {
    id: 'status',
    name: 'Get Status',
    description: 'Retrieve current entity status',
    category: 'monitoring',
  },
  {
    id: 'restart',
    name: 'Restart',
    description: 'Restart the entity',
    category: 'control',
    unavailable: true,
  },
  {
    id: 'isolate',
    name: 'Isolate',
    description: 'Isolate entity from network',
    category: 'security',
    unavailable: true,
  },
  {
    id: 'collect',
    name: 'Collect Artifacts',
    description: 'Collect forensic artifacts',
    category: 'response',
    unavailable: true,
    parameters: [
      {
        name: 'artifact_type',
        type: 'select',
        required: true,
        options: ['logs', 'memory', 'disk', 'network'],
      },
    ],
  },
  {
    id: 'block_ip',
    name: 'Block IP',
    description: 'Block suspicious IP address',
    category: 'security',
    unavailable: true,
    parameters: [
      {
        name: 'ip_address',
        type: 'string',
        required: true,
      },
      {
        name: 'duration_hours',
        type: 'number',
        required: false,
      },
    ],
  },
  {
    id: 'quarantine',
    name: 'Quarantine',
    description: 'Quarantine potentially malicious file',
    category: 'response',
    unavailable: true,
    parameters: [
      {
        name: 'file_path',
        type: 'string',
        required: true,
      },
    ],
  },
];

export function C2CommandInterface({
  entityId = 'unknown',
  entityName = 'Selected Entity',
  onCommandExecuted,
}: C2CommandInterfaceProps) {
  const [selectedCommand, setSelectedCommand] = useState<Command | null>(null);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<ExecutionResult[]>([]);
  const [activeTab, setActiveTab] = useState<'commands' | 'history'>('commands');

  const handleParameterChange = (paramName: string, value: any) => {
    setParameters({ ...parameters, [paramName]: value });
  };

  const handleExecuteCommand = async () => {
    if (!selectedCommand) return;

    setIsExecuting(true);

    try {
      const response = await fetch('/api/ops/c2/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandId: selectedCommand.id,
          entityId,
          parameters,
        }),
      });

      const data = await response.json();

      const result: ExecutionResult = {
        commandId: selectedCommand.id,
        entityId,
        status: response.ok ? 'success' : 'failed',
        result: data.data,
        error: data.error,
        executedAt: Date.now(),
        duration: data.duration,
      };

      setExecutionHistory([result, ...executionHistory]);
      onCommandExecuted?.(result);

      // Reset form
      setSelectedCommand(null);
      setParameters({});
    } catch (error) {
      const result: ExecutionResult = {
        commandId: selectedCommand.id,
        entityId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: Date.now(),
      };

      setExecutionHistory([result, ...executionHistory]);
      onCommandExecuted?.(result);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 border-l border-slate-800">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <h3 className="font-semibold text-slate-100 mb-1">Command Interface</h3>
        <p className="text-xs text-slate-400">{entityName}</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveTab('commands')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition ${
            activeTab === 'commands'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Commands
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition ${
            activeTab === 'history'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          History ({executionHistory.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'commands' ? (
          <div className="p-4 space-y-3">
            {selectedCommand ? (
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-slate-100 mb-1">{selectedCommand.name}</h4>
                  <p className="text-xs text-slate-400">{selectedCommand.description}</p>
                </div>

                {/* Parameters */}
                {selectedCommand.parameters && selectedCommand.parameters.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    {selectedCommand.parameters.map((param) => (
                      <div key={param.name}>
                        <label className="text-xs font-semibold text-slate-400 mb-1 block">
                          {param.name}
                          {param.required && <span className="text-red-400">*</span>}
                        </label>

                        {param.type === 'select' ? (
                          <select
                            value={parameters[param.name] || ''}
                            onChange={(e) => handleParameterChange(param.name, e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:border-blue-500 outline-none transition"
                          >
                            <option value="">Select {param.name}...</option>
                            {param.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : param.type === 'number' ? (
                          <input
                            type="number"
                            value={parameters[param.name] || ''}
                            onChange={(e) => handleParameterChange(param.name, e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:border-blue-500 outline-none transition"
                            placeholder={param.name}
                          />
                        ) : (
                          <input
                            type="text"
                            value={parameters[param.name] || ''}
                            onChange={(e) => handleParameterChange(param.name, e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:border-blue-500 outline-none transition"
                            placeholder={param.name}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2 pt-4 border-t border-slate-800">
                  <button
                    onClick={handleExecuteCommand}
                    disabled={isExecuting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white rounded transition font-medium"
                  >
                    {isExecuting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Execute
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setSelectedCommand(null);
                      setParameters({});
                    }}
                    disabled={isExecuting}
                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-slate-300 rounded transition font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {COMMON_COMMANDS.map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => setSelectedCommand(cmd)}
                    disabled={cmd.unavailable}
                    title={
                      cmd.unavailable
                        ? 'Not implemented — no endpoint integration is configured'
                        : undefined
                    }
                    className="w-full text-left p-3 bg-slate-800/50 hover:bg-slate-800 rounded transition border border-slate-700 hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-800/50 disabled:hover:border-slate-700"
                  >
                    <div className="font-medium text-slate-100 text-sm">
                      {cmd.name}
                      {cmd.unavailable && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400/80">
                          unavailable
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{cmd.description}</div>
                    <div className="text-xs text-slate-500 mt-2 capitalize">{cmd.category}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            {executionHistory.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No command history</div>
            ) : (
              <div className="space-y-3">
                {executionHistory.map((result) => (
                  <div
                    key={`${result.commandId}-${result.executedAt}`}
                    className="p-3 bg-slate-800/50 rounded border border-slate-700"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-sm font-medium text-slate-100">
                          {COMMON_COMMANDS.find((c) => c.id === result.commandId)?.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {new Date(result.executedAt).toLocaleTimeString()}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {result.status === 'success' && (
                          <CheckCircle2 size={16} className="text-green-400" />
                        )}
                        {result.status === 'failed' && (
                          <AlertCircle size={16} className="text-red-400" />
                        )}
                        {result.status === 'executing' && (
                          <Loader2 size={16} className="text-blue-400 animate-spin" />
                        )}

                        {result.duration && (
                          <span className="text-xs text-slate-500">{result.duration}ms</span>
                        )}
                      </div>
                    </div>

                    {result.result && (
                      <div className="mt-2 p-2 bg-slate-900 rounded text-xs text-slate-300 font-mono max-h-24 overflow-auto">
                        {typeof result.result === 'string'
                          ? result.result
                          : JSON.stringify(result.result, null, 2)}
                      </div>
                    )}

                    {result.error && (
                      <div className="mt-2 p-2 bg-red-900/20 rounded text-xs text-red-300">
                        {result.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
