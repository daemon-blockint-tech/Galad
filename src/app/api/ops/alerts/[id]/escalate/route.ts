import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getOpsUserId, getTenantId } from '@/lib/ops/session';

/**
 * PATCH /api/ops/alerts/[id]/escalate — escalate an alert.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = await getTenantId();
  const { id: alertId } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    const existing = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        escalationLevel: Math.min(3, Math.max(0, existing.escalationLevel) + 1),
        status: 'escalated',
      },
    });

    // Record event
    await prisma.alertEvent.create({
      data: {
        tenantId,
        alertId,
        eventType: 'escalated',
        actorUserId: userId,
        actorAction: 'escalated',
        actorNotes: reason,
      },
    });

    return NextResponse.json({
      id: alert.id,
      status: alert.status,
      escalationLevel: alert.escalationLevel,
    });
  } catch (e) {
    console.error(`PATCH /api/ops/alerts/${alertId}/escalate`, e);
    return NextResponse.json({ error: 'Failed to escalate alert' }, { status: 500 });
  }
}
