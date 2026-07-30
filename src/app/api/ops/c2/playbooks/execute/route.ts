import { NextRequest, NextResponse } from 'next/server';
import { PlaybookEngine } from '@/core/c2/PlaybookEngine';
import { C2CommandExecutor } from '@/core/c2/C2CommandExecutor';
import { prisma } from '@/lib/db';

const commandExecutor = new C2CommandExecutor(prisma);
const playbookEngine = new PlaybookEngine(prisma, commandExecutor);

/**
 * POST /api/ops/c2/playbooks/execute
 * Execute a playbook on an entity.
 *
 * Request body:
 * {
 *   playbookId: string,
 *   entityId: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playbookId, entityId } = body;

    if (!playbookId || !entityId) {
      return NextResponse.json(
        { error: 'Missing required fields: playbookId, entityId' },
        { status: 400 },
      );
    }

    const execution = await playbookEngine.executePlaybook(playbookId, entityId);

    return NextResponse.json({
      success: true,
      data: execution,
    });
  } catch (error) {
    console.error('Playbook execution error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute playbook' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ops/c2/playbooks/execute
 * Get execution status or history.
 *
 * Query parameters:
 * - id: Execution ID
 * - playbookId: Filter by playbook
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const executionId = searchParams.get('id');
    const playbookId = searchParams.get('playbookId');

    if (executionId) {
      const execution = playbookEngine.getExecution(executionId);
      if (!execution) {
        return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: execution });
    }

    const executions = playbookEngine.listExecutions(playbookId || undefined);

    return NextResponse.json({
      success: true,
      data: executions,
      count: executions.length,
    });
  } catch (error) {
    console.error('Execution retrieval error:', error);
    return NextResponse.json({ error: 'Failed to retrieve executions' }, { status: 500 });
  }
}
