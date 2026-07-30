import { NextResponse } from 'next/server';
import { getOpsUserId } from '@/lib/ops/session';

/**
 * Playbook execution is not implemented.
 *
 * PlaybookEngine keeps playbooks and executions in per-process Maps and there is
 * no playbook table in prisma/schema.prisma, so a playbook created through
 * POST /api/ops/c2/playbooks is never visible to this module and nothing can be
 * resolved to execute. Reporting an outcome for containment actions
 * (isolate / block_ip / quarantine) that were never issued is worse than
 * refusing, so both verbs fail explicitly instead.
 */
const NOT_IMPLEMENTED = {
  error:
    'Playbook execution is not implemented: playbooks are not persisted, so no playbook can be resolved or executed.',
};

/**
 * POST /api/ops/c2/playbooks/execute
 */
export async function POST() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

/**
 * GET /api/ops/c2/playbooks/execute
 */
export async function GET() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}
