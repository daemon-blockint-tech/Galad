/**
 * @file C2CommandExecutor.ts
 * @description C2 command execution engine for entity control and response.
 * Handles command validation, execution, and result tracking.
 */

import { PrismaClient } from '@/generated/prisma';

export interface C2Command {
  commandId: string;
  entityId: string;
  parameters?: Record<string, any>;
  executedBy?: string;
  timestamp?: number;
}

export interface CommandResult {
  commandId: string;
  entityId: string;
  status: 'pending' | 'executing' | 'success' | 'failed' | 'timeout';
  result?: any;
  error?: string;
  executedAt: number;
  duration?: number;
}

export class C2CommandExecutor {
  private db: PrismaClient;
  private tenantId?: string;
  private executionTimeout = 30000; // 30 seconds
  private commandLog: Map<string, CommandResult> = new Map();

  constructor(db: PrismaClient, tenantId?: string) {
    this.db = db;
    this.tenantId = tenantId;
  }

  /**
   * Execute a C2 command.
   */
  async execute(command: C2Command): Promise<CommandResult> {
    const startTime = Date.now();
    const resultId = `${command.commandId}-${command.entityId}-${startTime}`;

    try {
      // Validate command
      this.validateCommand(command);

      // Mark as executing
      const result: CommandResult = {
        commandId: command.commandId,
        entityId: command.entityId,
        status: 'executing',
        executedAt: startTime,
      };

      this.commandLog.set(resultId, result);

      // Execute command
      const commandResult = await this.executeCommand(command);

      // Update result
      const finalResult: CommandResult = {
        commandId: command.commandId,
        entityId: command.entityId,
        status: commandResult.success ? 'success' : 'failed',
        result: commandResult.result,
        error: commandResult.error,
        executedAt: startTime,
        duration: Date.now() - startTime,
      };

      this.commandLog.set(resultId, finalResult);
      this.recordCommandExecution(finalResult, command.executedBy);

      return finalResult;
    } catch (error) {
      const finalResult: CommandResult = {
        commandId: command.commandId,
        entityId: command.entityId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: startTime,
        duration: Date.now() - startTime,
      };

      this.commandLog.set(resultId, finalResult);
      return finalResult;
    }
  }

  /**
   * Get entity status.
   */
  private async executeGetStatus(entityId: string): Promise<any> {
    const alert = await this.db.alert.findFirst({
      where: {
        tenantId: this.tenantId,
        entityId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      entityId,
      status: alert ? (alert.severity === 'critical' ? 'warning' : 'healthy') : 'unknown',
      lastAlert: alert?.createdAt || null,
      alertCount: await this.db.alert.count({
        where: { tenantId: this.tenantId, entityId },
      }),
    };
  }

  /**
   * Execute command based on type.
   */
  private async executeCommand(command: C2Command): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      let result: any;

      switch (command.commandId) {
        case 'status':
          result = await this.executeGetStatus(command.entityId);
          break;

        case 'restart':
        case 'isolate':
        case 'collect':
        case 'block_ip':
        case 'quarantine':
          throw new Error(
            `Command "${command.commandId}" is not implemented — no endpoint integration is configured. No action was taken on ${command.entityId}.`,
          );

        default:
          throw new Error(`Unknown command: ${command.commandId}`);
      }

      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Command execution failed',
      };
    }
  }

  /**
   * Validate command structure.
   */
  private validateCommand(command: C2Command): void {
    if (!command.commandId) {
      throw new Error('Command ID is required');
    }

    if (!command.entityId) {
      throw new Error('Entity ID is required');
    }

    const validCommands = ['status', 'restart', 'isolate', 'collect', 'block_ip', 'quarantine'];
    if (!validCommands.includes(command.commandId)) {
      throw new Error(`Invalid command: ${command.commandId}`);
    }
  }

  /**
   * Record command execution in audit log.
   */
  private recordCommandExecution(result: CommandResult, executedBy?: string): void {
    // Operational log only. The durable audit record is the AlertEvent written by
    // POST /api/ops/c2/commands, which is the caller that has the request context.
    console.log(`[C2] Command executed: ${result.commandId} on ${result.entityId}`, {
      status: result.status,
      duration: result.duration,
      executedBy,
    });
  }



  /**
   * Get command execution history.
   */
  getCommandHistory(entityId?: string, limit: number = 50): CommandResult[] {
    return Array.from(this.commandLog.values())
      .filter((result) => (entityId ? result.entityId === entityId : true))
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, limit);
  }

  /**
   * Clear command history.
   */
  clearHistory(): void {
    this.commandLog.clear();
  }

  /**
   * Get command execution stats.
   */
  getStats(): {
    totalExecuted: number;
    successful: number;
    failed: number;
    averageDuration: number;
  } {
    const results = Array.from(this.commandLog.values());
    if (results.length === 0) {
      return { totalExecuted: 0, successful: 0, failed: 0, averageDuration: 0 };
    }

    const successful = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const avgDuration =
      results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length;

    return {
      totalExecuted: results.length,
      successful,
      failed,
      averageDuration: Math.round(avgDuration),
    };
  }
}
