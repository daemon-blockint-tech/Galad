import { NextResponse } from 'next/server';
import { getOpsUserId } from '@/lib/ops/session';

/**
 * Playbook storage is not implemented.
 *
 * PlaybookEngine keeps playbooks in a per-process Map — it never touches the
 * injected Prisma client and prisma/schema.prisma has no playbook table — so a
 * playbook created here is invisible to /api/ops/c2/playbooks/execute and is
 * lost on restart. Rather than acknowledge writes that are not stored and serve
 * a list that can never be anything but empty, every verb fails explicitly.
 *
 * Restoring this needs a Playbook model plus a migration; see the follow-up.
 */
const NOT_IMPLEMENTED = {
  error:
    'Playbook storage is not implemented: playbooks are not persisted, so they cannot be listed, created, updated or deleted.',
};

/**
 * GET /api/ops/c2/playbooks
 */
export async function GET() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

/**
 * POST /api/ops/c2/playbooks
 */
export async function POST() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

/**
 * DELETE /api/ops/c2/playbooks
 */
export async function DELETE() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

/**
 * PUT /api/ops/c2/playbooks
 */
export async function PUT() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}
