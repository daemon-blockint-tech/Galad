/**
 * @file PlaybookEngine.ts
 * @description Mission automation and playbook execution engine.
 * Orchestrates multi-step automated responses and workflows.
 * Enhanced with Mission Autonomy capabilities: Intent-to-Task, Sensor Fusion, Resource Management, Dynamic Planning.
 */

import { PrismaClient } from '@/generated/prisma';
import { C2CommandExecutor } from './C2CommandExecutor';
import { IntentToTaskBreakdown, TaskObjective, DecomposedTask } from './IntentToTaskBreakdown';
import { SensorFusion, SensorData, FusedThreatSignal } from './SensorFusion';
import { ResourceManager, ExecutionSchedule } from './ResourceManager';
import { DynamicPlanningEngine } from './DynamicPlanningEngine';

export interface PlaybookAction {
  id: string;
  type: 'command' | 'condition' | 'delay' | 'notification' | 'parallel';
  commandId?: string;
  parameters?: Record<string, any>;
  condition?: {
    field: string;
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than';
    value: any;
  };
  delayMs?: number;
  notificationMessage?: string;
  parallelActions?: PlaybookAction[];
  onError?: 'continue' | 'abort' | 'retry';
  retries?: number;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  actions: PlaybookAction[];
  trigger?: {
    type: 'manual' | 'automatic';
    condition?: string; // e.g., "threatLevel > 0.8"
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MissionExecution {
  id: string;
  playbookId: string;
  entityId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'paused';
  startTime: number;
  endTime?: number;
  duration?: number;
  actions: Array<{
    actionId: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
    result?: any;
    error?: string;
    duration?: number;
  }>;
  logs: Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    actionId?: string;
  }>;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: 'threat_level' | 'alert_type' | 'status_change' | 'time_based';
    threshold?: number;
    alertType?: string;
    status?: string;
    schedule?: string; // cron expression
  };
  action: {
    playbookId: string;
    parameters?: Record<string, any>;
  };
  scope: {
    entityIds?: string[];
    platformTypes?: string[];
    threatLevelRange?: [number, number];
  };
  enabled: boolean;
  createdAt: number;
}

export class PlaybookEngine {
  private db: PrismaClient;
  private commandExecutor: C2CommandExecutor;
  private playbooks: Map<string, Playbook> = new Map();
  private executions: Map<string, MissionExecution> = new Map();
  private automationRules: Map<string, AutomationRule> = new Map();
  private tenantId?: string;
  private intentToTaskBreakdown: IntentToTaskBreakdown;
  private sensorFusion: SensorFusion;
  private resourceManager: ResourceManager;
  private dynamicPlanningEngine: DynamicPlanningEngine;
  private decomposedTasks: Map<string, DecomposedTask> = new Map();

  constructor(db: PrismaClient, commandExecutor: C2CommandExecutor, tenantId?: string) {
    this.db = db;
    this.commandExecutor = commandExecutor;
    this.tenantId = tenantId;
    this.intentToTaskBreakdown = new IntentToTaskBreakdown(this);
    this.sensorFusion = new SensorFusion();
    this.resourceManager = new ResourceManager();
    this.dynamicPlanningEngine = new DynamicPlanningEngine();
  }

  /**
   * MISSION AUTONOMY: Decompose operator intent into executable tasks.
   */
  async decomposeIntentToTask(objective: TaskObjective): Promise<DecomposedTask> {
    const task = await this.intentToTaskBreakdown.decomposeIntent(objective);
    this.decomposedTasks.set(task.id, task);
    return task;
  }

  /**
   * MISSION AUTONOMY: Get decomposed task details.
   */
  getDecomposedTask(taskId: string): DecomposedTask | undefined {
    return this.decomposedTasks.get(taskId);
  }

  /**
   * MISSION AUTONOMY: Ingest sensor data from multiple sources.
   */
  addSensorData(data: SensorData): void {
    this.sensorFusion.addSensorData(data);
  }

  /**
   * MISSION AUTONOMY: Fuse threat signals from all sensor sources.
   */
  fuseThreatSignal(entityId: string): FusedThreatSignal {
    return this.sensorFusion.fuseThreatSignals(entityId);
  }

  /**
   * MISSION AUTONOMY: Schedule execution with resource management and conflict resolution.
   */
  scheduleExecution(schedule: ExecutionSchedule): boolean {
    return this.resourceManager.scheduleExecution(schedule);
  }

  /**
   * MISSION AUTONOMY: Allocate resources for playbook execution.
   */
  allocateResources(executionId: string, entityId: string, required: Record<string, number>) {
    return this.resourceManager.allocateResources(executionId, entityId, required);
  }

  /**
   * MISSION AUTONOMY: Evaluate threat signal and adapt execution plan dynamically.
   */
  evaluateThreatAndAdapt(
    executionId: string,
    entityId: string,
    threatSignal: FusedThreatSignal,
    context: Partial<Parameters<typeof this.dynamicPlanningEngine.evaluateThreat>[3]>,
  ) {
    return this.dynamicPlanningEngine.evaluateThreat(
      executionId,
      entityId,
      threatSignal,
      context,
    );
  }

  /**
   * MISSION AUTONOMY: Get sensor health status.
   */
  getSensorHealth() {
    return this.sensorFusion.getSensorHealth();
  }

  /**
   * MISSION AUTONOMY: Get resource utilization.
   */
  getResourceUtilization() {
    return this.resourceManager.getResourceUtilization();
  }

  /**
   * MISSION AUTONOMY: Get adaptation history for execution.
   */
  getAdaptationHistory(executionId: string) {
    return this.dynamicPlanningEngine.getAdaptationHistory(executionId);
  }

  /**
   * Create a new playbook.
   */
  createPlaybook(playbook: Omit<Playbook, 'createdAt' | 'updatedAt'>): Playbook {
    const now = Date.now();
    const newPlaybook: Playbook = {
      ...playbook,
      createdAt: now,
      updatedAt: now,
    };

    this.playbooks.set(playbook.id, newPlaybook);
    return newPlaybook;
  }

  /**
   * Get playbook by ID.
   */
  getPlaybook(playbookId: string): Playbook | undefined {
    return this.playbooks.get(playbookId);
  }

  /**
   * List all playbooks.
   */
  listPlaybooks(): Playbook[] {
    return Array.from(this.playbooks.values());
  }

  /**
   * Update playbook.
   */
  updatePlaybook(playbookId: string, updates: Partial<Playbook>): Playbook | undefined {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) return undefined;

    const updated = {
      ...playbook,
      ...updates,
      updatedAt: Date.now(),
    };

    this.playbooks.set(playbookId, updated);
    return updated;
  }

  /**
   * Delete playbook.
   */
  deletePlaybook(playbookId: string): boolean {
    return this.playbooks.delete(playbookId);
  }

  /**
   * Execute playbook on entity.
   */
  async executePlaybook(playbookId: string, entityId: string): Promise<MissionExecution> {
    const playbook = this.getPlaybook(playbookId);
    if (!playbook) {
      throw new Error(`Playbook ${playbookId} not found`);
    }

    const executionId = `exec-${playbookId}-${entityId}-${Date.now()}`;
    const execution: MissionExecution = {
      id: executionId,
      playbookId,
      entityId,
      status: 'pending',
      startTime: Date.now(),
      actions: playbook.actions.map((action) => ({
        actionId: action.id,
        status: 'pending',
      })),
      logs: [
        {
          timestamp: Date.now(),
          level: 'info',
          message: `Starting playbook execution: ${playbook.name}`,
        },
      ],
    };

    this.executions.set(executionId, execution);

    // Try to allocate resources with dynamic scheduling
    const resourceRequirements = this.estimateResourceRequirements(playbook);
    const allocation = this.resourceManager.allocateResources(executionId, entityId, resourceRequirements);

    if (allocation) {
      this.logToExecution(execution, 'info', `Resources allocated: ${allocation.allocationId}`);
    } else {
      this.logToExecution(execution, 'warn', 'Insufficient resources - executing with degraded capacity');
    }

    // Execute playbook asynchronously with dynamic adaptation support
    this.executeActions(execution, playbook.actions, entityId, executionId).catch((error) => {
      this.logToExecution(execution, 'error', `Playbook execution failed: ${error.message}`);
      execution.status = 'failed';
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;

      if (allocation) {
        this.resourceManager.releaseResources(allocation.allocationId);
      }
    });

    return execution;
  }

  /**
   * Estimate resource requirements for a playbook.
   */
  private estimateResourceRequirements(playbook: Playbook): Record<string, number> {
    const requirements: Record<string, number> = { compute: 1, network: 1 };

    const hasHeavyCompute = playbook.actions.some((a) =>
      a.type === 'command' && a.commandId?.includes('scan'),
    );
    if (hasHeavyCompute) {
      requirements.compute = 3;
    }

    const hasNetworkOps = playbook.actions.some((a) =>
      a.type === 'command' && (a.commandId?.includes('isolate') || a.commandId?.includes('block')),
    );
    if (hasNetworkOps) {
      requirements.network = 2;
    }

    const hasStorage = playbook.actions.some((a) =>
      a.type === 'command' && a.commandId?.includes('collect'),
    );
    if (hasStorage) {
      requirements.storage = 100;
    }

    return requirements;
  }

  /**
   * Execute playbook actions recursively with dynamic adaptation support.
   */
  private async executeActions(
    execution: MissionExecution,
    actions: PlaybookAction[],
    entityId: string,
    executionId?: string,
  ): Promise<void> {
    execution.status = 'running';

    for (const action of actions) {
      const actionExecution = execution.actions.find((a) => a.actionId === action.id);
      if (!actionExecution) continue;

      try {
        actionExecution.status = 'running';
        const startTime = Date.now();

        switch (action.type) {
          case 'command':
            await this.executeCommandAction(action, entityId, execution);
            break;

          case 'delay':
            await this.executeDelayAction(action, execution);
            break;

          case 'condition':
            await this.executeConditionAction(action, execution);
            break;

          case 'notification':
            await this.executeNotificationAction(action, execution);
            break;

          case 'parallel':
            await this.executeParallelActions(action, entityId, execution, executionId);
            break;

          default:
            throw new Error(`Unknown action type: ${action.type}`);
        }

        actionExecution.status = 'success';
        actionExecution.duration = Date.now() - startTime;
        this.logToExecution(execution, 'success', `Action completed: ${action.id}`);
      } catch (error) {
        actionExecution.status = 'failed';
        actionExecution.error = error instanceof Error ? error.message : String(error);
        this.logToExecution(execution, 'error', `Action failed: ${actionExecution.error}`);

        if (action.onError === 'abort') {
          execution.status = 'failed';
          break;
        } else if (action.onError === 'retry' && action.retries && action.retries > 0) {
          action.retries--;
          continue;
        }
      }
    }

    execution.status = 'success';
    execution.endTime = Date.now();
    execution.duration = execution.endTime - execution.startTime;
    this.logToExecution(execution, 'success', 'Playbook execution completed');
  }

  /**
   * Execute command action.
   */
  private async executeCommandAction(
    action: PlaybookAction,
    entityId: string,
    execution: MissionExecution,
  ): Promise<void> {
    if (!action.commandId) {
      throw new Error('Command ID is required for command action');
    }

    const result = await this.commandExecutor.execute({
      commandId: action.commandId,
      entityId,
      parameters: action.parameters,
    });

    if (result.status !== 'success') {
      throw new Error(result.error || 'Command execution failed');
    }

    const actionExecution = execution.actions.find((a) => a.actionId === action.id);
    if (actionExecution) {
      actionExecution.result = result.result;
    }
  }

  /**
   * Execute delay action.
   */
  private executeDelayAction(action: PlaybookAction, execution: MissionExecution): Promise<void> {
    return new Promise((resolve) => {
      const delayMs = action.delayMs || 1000;
      this.logToExecution(execution, 'info', `Delaying for ${delayMs}ms`);
      setTimeout(resolve, delayMs);
    });
  }

  /**
   * Execute condition action.
   */
  private async executeConditionAction(
    action: PlaybookAction,
    execution: MissionExecution,
  ): Promise<void> {
    if (!action.condition) {
      throw new Error('Condition is required for condition action');
    }

    // In a real implementation, would evaluate against entity state
    const conditionMet = this.evaluateCondition(action.condition);

    if (!conditionMet) {
      const actionExecution = execution.actions.find((a) => a.actionId === action.id);
      if (actionExecution) {
        actionExecution.status = 'skipped';
      }
      this.logToExecution(execution, 'info', `Condition not met: ${action.condition.field}`);
    }
  }

  /**
   * Execute notification action.
   */
  private async executeNotificationAction(
    action: PlaybookAction,
    execution: MissionExecution,
  ): Promise<void> {
    if (!action.notificationMessage) {
      throw new Error('Notification message is required');
    }

    this.logToExecution(execution, 'info', `Notification: ${action.notificationMessage}`);
    // In a real implementation, would send to notification system
  }

  /**
   * Execute parallel actions.
   */
  private async executeParallelActions(
    action: PlaybookAction,
    entityId: string,
    execution: MissionExecution,
    executionId?: string,
  ): Promise<void> {
    if (!action.parallelActions || action.parallelActions.length === 0) {
      throw new Error('Parallel actions required');
    }

    this.logToExecution(execution, 'info', `Executing ${action.parallelActions.length} actions in parallel`);

    await Promise.all(action.parallelActions.map((parallelAction) =>
      this.executeActions(execution, [parallelAction], entityId, executionId),
    ));
  }

  /**
   * Evaluate condition logic.
   */
  private evaluateCondition(condition: PlaybookAction['condition']): boolean {
    if (!condition) return true;

    // Placeholder implementation
    // In production, would evaluate against actual entity state
    switch (condition.operator) {
      case 'equals':
        return condition.value === condition.value;
      case 'contains':
        return String(condition.value).includes(condition.value);
      case 'greater_than':
        return condition.value > condition.value;
      case 'less_than':
        return condition.value < condition.value;
      default:
        return true;
    }
  }

  /**
   * Get execution status.
   */
  getExecution(executionId: string): MissionExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * List executions.
   */
  listExecutions(playbookId?: string): MissionExecution[] {
    const executions = Array.from(this.executions.values());
    return playbookId ? executions.filter((e) => e.playbookId === playbookId) : executions;
  }

  /**
   * Create automation rule.
   */
  createAutomationRule(rule: Omit<AutomationRule, 'createdAt'>): AutomationRule {
    const newRule: AutomationRule = {
      ...rule,
      createdAt: Date.now(),
    };

    this.automationRules.set(rule.id, newRule);
    return newRule;
  }

  /**
   * Get automation rule.
   */
  getAutomationRule(ruleId: string): AutomationRule | undefined {
    return this.automationRules.get(ruleId);
  }

  /**
   * List automation rules.
   */
  listAutomationRules(): AutomationRule[] {
    return Array.from(this.automationRules.values());
  }

  /**
   * Disable automation rule.
   */
  disableAutomationRule(ruleId: string): void {
    const rule = this.automationRules.get(ruleId);
    if (rule) {
      rule.enabled = false;
    }
  }

  /**
   * Check triggers and execute matching playbooks.
   */
  async evaluateAutomationRules(entityId: string, threatLevel: number, status: string): Promise<void> {
    const applicableRules = Array.from(this.automationRules.values()).filter(
      (rule) => rule.enabled && this.matchesScope(rule, entityId, threatLevel),
    );

    for (const rule of applicableRules) {
      const triggerMatches = this.evaluateTrigger(rule.trigger, threatLevel, status);

      if (triggerMatches) {
        const playbook = this.getPlaybook(rule.action.playbookId);
        if (playbook) {
          this.logAutomation(`Executing playbook ${rule.action.playbookId} for entity ${entityId} via rule ${rule.id}`);
          await this.executePlaybook(rule.action.playbookId, entityId);
        }
      }
    }
  }

  /**
   * Check if entity matches rule scope.
   */
  private matchesScope(rule: AutomationRule, entityId: string, threatLevel: number): boolean {
    const { scope } = rule;

    if (scope.entityIds && !scope.entityIds.includes(entityId)) {
      return false;
    }

    if (scope.threatLevelRange) {
      const [min, max] = scope.threatLevelRange;
      if (threatLevel < min || threatLevel > max) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate automation rule trigger.
   */
  private evaluateTrigger(
    trigger: AutomationRule['trigger'],
    threatLevel: number,
    status: string,
  ): boolean {
    switch (trigger.type) {
      case 'threat_level':
        return trigger.threshold !== undefined && threatLevel >= trigger.threshold;

      case 'status_change':
        return trigger.status === status;

      case 'alert_type':
        // Would compare against alert type
        return true;

      case 'time_based':
        // Would evaluate cron expression
        return false;

      default:
        return false;
    }
  }

  /**
   * Log to execution.
   */
  private logToExecution(
    execution: MissionExecution,
    level: 'info' | 'warn' | 'error' | 'success',
    message: string,
    actionId?: string,
  ): void {
    execution.logs.push({
      timestamp: Date.now(),
      level,
      message,
      actionId,
    });
  }

  /**
   * Log automation event.
   */
  private logAutomation(message: string): void {
    console.log(`[PlaybookEngine] ${message}`);
  }

  /**
   * Get engine statistics.
   */
  getStats(): {
    playbookCount: number;
    executionCount: number;
    automationRuleCount: number;
    successfulExecutions: number;
    failedExecutions: number;
  } {
    const executions = Array.from(this.executions.values());

    return {
      playbookCount: this.playbooks.size,
      executionCount: executions.length,
      automationRuleCount: this.automationRules.size,
      successfulExecutions: executions.filter((e) => e.status === 'success').length,
      failedExecutions: executions.filter((e) => e.status === 'failed').length,
    };
  }

  /**
   * MISSION AUTONOMY: Get comprehensive mission autonomy dashboard data.
   */
  getMissionAutonomyStatus() {
    return {
      resourceUtilization: this.resourceManager.getResourceUtilization(),
      sensorHealth: this.sensorFusion.getSensorHealth(),
      pendingExecutions: this.resourceManager.getPendingExecutions(),
      runningExecutions: this.resourceManager.getRunningExecutions(),
      adaptationStats: this.dynamicPlanningEngine.getAdaptationStats(),
      decomposedTasksCount: this.decomposedTasks.size,
    };
  }

  /**
   * MISSION AUTONOMY: Execute mission from intent.
   */
  async executeMissionFromIntent(objective: TaskObjective, entityId: string): Promise<DecomposedTask> {
    const task = await this.decomposeIntentToTask(objective);

    if (task.proposedPlaybooks.length > 0) {
      const bestPlaybook = task.proposedPlaybooks[0];
      await this.executePlaybook(bestPlaybook.playbookId, entityId);
      this.logAutomation(`Executed mission from intent: ${objective.intent}`);
    }

    return task;
  }
}
