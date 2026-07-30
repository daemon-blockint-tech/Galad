import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getOpsUserId, getTenantId } from '@/lib/ops/session';

/**
 * PATCH /api/ops/alerts/[id]/resolve — resolve an alert.
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
    const notes = typeof body.notes === 'string' ? body.notes : undefined;

    if (!(await prisma.alert.findUnique({ where: { id: alertId } }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    // Record event
    await prisma.alertEvent.create({
      data: {
        tenantId,
        alertId,
        eventType: 'resolved',
        actorUserId: userId,
        actorAction: 'resolved',
        actorNotes: notes,
      },
    });

    return NextResponse.json({
      id: alert.id,
      status: alert.status,
      resolvedAt: alert.resolvedAt?.getTime(),
    });
  } catch (e) {
    console.error(`PATCH /api/ops/alerts/${alertId}/resolve`, e);
    return NextResponse.json({ error: 'Failed to resolve alert' }, { status: 500 });
  }
}
