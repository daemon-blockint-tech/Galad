import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { C2CommandExecutor } from '@/core/c2/C2CommandExecutor';
import { getOpsUserId } from '@/lib/ops/session';

const commandExecutor = new C2CommandExecutor(prisma);

/**
 * POST /api/ops/c2/commands
 * Execute a C2 command on an entity.
 *
 * Request body:
 * {
 *   commandId: string,
 *   entityId: string,
 *   parameters?: Record<string, any>
 * }
 */
export async function POST(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { commandId, entityId, parameters } = body;

    if (!commandId || !entityId) {
      return NextResponse.json(
        { error: 'Missing required fields: commandId, entityId' },
        { status: 400 },
      );
    }

    const result = await commandExecutor.execute({
      commandId,
      entityId,
      parameters,
      executedBy: userId,
      timestamp: Date.now(),
    });

    // Record command in audit trail
    try {
      await prisma.alertEvent.create({
        data: {
          alertId: entityId,
          eventType: 'c2_command',
          eventData: JSON.stringify({
            commandId,
            parameters,
            result: result.result,
            status: result.status,
            duration: result.duration,
          }),
          actorUserId: userId,
          actorAction: `Executed command: ${commandId}`,
          actorNotes: `Command result: ${result.status}`,
        },
      });
    } catch (error) {
      console.error('Failed to record command event:', error);
    }

    return NextResponse.json({
      success: result.status === 'success',
      data: result,
      duration: result.duration,
      error: result.error,
    });
  } catch (error) {
    console.error('Command execution error:', error);
    return NextResponse.json(
      { error: 'Command execution failed' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ops/c2/commands/history
 * Get command execution history.
 *
 * Query parameters:
 * - entityId: filter by entity
 * - limit: max results (default 50)
 */
export async function GET(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const entityId = searchParams.get('entityId') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);

    const history = commandExecutor.getCommandHistory(entityId, limit);
    const stats = commandExecutor.getStats();

    return NextResponse.json({
      success: true,
      data: history,
      stats,
    });
  } catch (error) {
    console.error('History retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve command history' },
      { status: 500 },
    );
  }
}
