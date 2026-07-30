import { NextResponse } from 'next/server';
import { getOpsUserId } from '@/lib/ops/session';

/**
 * Automation rules are not implemented.
 *
 * Rules were held in a per-process PlaybookEngine Map with no table behind them,
 * and `PlaybookEngine.evaluateAutomationRules` has no caller — nothing ever
 * evaluated a trigger. Accepting a rule that silently never fires is worse than
 * refusing on an operations product: it reads as configured automated response
 * where there is none. Their action targets playbooks, which are themselves not
 * persisted (see ../playbooks/route.ts).
 */
const NOT_IMPLEMENTED = {
  error:
    'Automation rules are not implemented: rules are not persisted and no evaluator runs, so a rule created here would never fire.',
};

async function refuse() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

/** GET /api/ops/c2/automation-rules */
export async function GET() {
  return refuse();
}

/** POST /api/ops/c2/automation-rules */
export async function POST() {
  return refuse();
}

/** DELETE /api/ops/c2/automation-rules */
export async function DELETE() {
  return refuse();
}
