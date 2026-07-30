import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { PlaybookEngine } from '@/core/c2/PlaybookEngine';
import { C2CommandExecutor } from '@/core/c2/C2CommandExecutor';

const commandExecutor = new C2CommandExecutor(prisma);
const playbookEngine = new PlaybookEngine(prisma, commandExecutor);

/**
 * GET /api/ops/c2/playbooks
 * List all playbooks or get playbook by ID.
 *
 * Query parameters:
 * - id: Get specific playbook
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const playbookId = searchParams.get('id');

    if (playbookId) {
      const playbook = playbookEngine.getPlaybook(playbookId);
      if (!playbook) {
        return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: playbook });
    }

    const playbooks = playbookEngine.listPlaybooks();
    return NextResponse.json({
      success: true,
      data: playbooks,
      stats: playbookEngine.getStats(),
    });
  } catch (error) {
    console.error('Playbook listing error:', error);
    return NextResponse.json({ error: 'Failed to list playbooks' }, { status: 500 });
  }
}

/**
 * POST /api/ops/c2/playbooks
 * Create a new playbook.
 *
 * Request body:
 * {
 *   id: string,
 *   name: string,
 *   description: string,
 *   actions: PlaybookAction[],
 *   trigger?: { type: 'manual' | 'automatic', condition?: string },
 *   enabled: boolean
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, actions, trigger, enabled } = body;

    if (!id || !name || !actions) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name, actions' },
        { status: 400 },
      );
    }

    const playbook = playbookEngine.createPlaybook({
      id,
      name,
      description,
      actions,
      trigger,
      enabled,
    });

    return NextResponse.json({
      success: true,
      data: playbook,
    });
  } catch (error) {
    console.error('Playbook creation error:', error);
    return NextResponse.json({ error: 'Failed to create playbook' }, { status: 500 });
  }
}

/**
 * DELETE /api/ops/c2/playbooks
 * Delete a playbook.
 *
 * Query parameters:
 * - id: Playbook ID to delete
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const playbookId = searchParams.get('id');

    if (!playbookId) {
      return NextResponse.json({ error: 'Playbook ID required' }, { status: 400 });
    }

    const deleted = playbookEngine.deletePlaybook(playbookId);

    if (!deleted) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: playbookId });
  } catch (error) {
    console.error('Playbook deletion error:', error);
    return NextResponse.json({ error: 'Failed to delete playbook' }, { status: 500 });
  }
}

/**
 * PUT /api/ops/c2/playbooks
 * Update a playbook.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Playbook ID required' }, { status: 400 });
    }

    const updated = playbookEngine.updatePlaybook(id, updates);

    if (!updated) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Playbook update error:', error);
    return NextResponse.json({ error: 'Failed to update playbook' }, { status: 500 });
  }
}
