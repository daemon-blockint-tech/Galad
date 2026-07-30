import { NextRequest, NextResponse } from 'next/server';
import { PlaybookEngine } from '@/core/c2/PlaybookEngine';
import { C2CommandExecutor } from '@/core/c2/C2CommandExecutor';
import { prisma } from '@/lib/db';
import { getOpsUserId } from '@/lib/ops/session';

const commandExecutor = new C2CommandExecutor(prisma);
const playbookEngine = new PlaybookEngine(prisma, commandExecutor);

/**
 * GET /api/ops/c2/automation-rules
 * List automation rules.
 */
export async function GET(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rules = playbookEngine.listAutomationRules();

    return NextResponse.json({
      success: true,
      data: rules,
      count: rules.length,
    });
  } catch (error) {
    console.error('Automation rules listing error:', error);
    return NextResponse.json({ error: 'Failed to list automation rules' }, { status: 500 });
  }
}

/**
 * POST /api/ops/c2/automation-rules
 * Create an automation rule.
 *
 * Request body:
 * {
 *   id: string,
 *   name: string,
 *   description: string,
 *   trigger: {
 *     type: 'threat_level' | 'alert_type' | 'status_change' | 'time_based',
 *     threshold?: number,
 *     alertType?: string,
 *     status?: string,
 *     schedule?: string
 *   },
 *   action: {
 *     playbookId: string,
 *     parameters?: Record<string, any>
 *   },
 *   scope: {
 *     entityIds?: string[],
 *     platformTypes?: string[],
 *     threatLevelRange?: [number, number]
 *   },
 *   enabled: boolean
 * }
 */
export async function POST(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, name, description, trigger, action, scope, enabled } = body;

    if (!id || !name || !trigger || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name, trigger, action' },
        { status: 400 },
      );
    }

    const rule = playbookEngine.createAutomationRule({
      id,
      name,
      description,
      trigger,
      action,
      scope: scope || {},
      enabled,
    });

    return NextResponse.json({
      success: true,
      data: rule,
    });
  } catch (error) {
    console.error('Automation rule creation error:', error);
    return NextResponse.json({ error: 'Failed to create automation rule' }, { status: 500 });
  }
}

/**
 * DELETE /api/ops/c2/automation-rules
 * Delete an automation rule.
 *
 * Query parameters:
 * - id: Rule ID to delete
 */
export async function DELETE(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const ruleId = searchParams.get('id');

    if (!ruleId) {
      return NextResponse.json({ error: 'Rule ID required' }, { status: 400 });
    }

    // In a real implementation, would delete from database
    playbookEngine.disableAutomationRule(ruleId);

    return NextResponse.json({
      success: true,
      deleted: ruleId,
    });
  } catch (error) {
    console.error('Automation rule deletion error:', error);
    return NextResponse.json({ error: 'Failed to delete automation rule' }, { status: 500 });
  }
}
