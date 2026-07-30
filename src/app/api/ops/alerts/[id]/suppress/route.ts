import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getOpsUserId, getTenantId } from '@/lib/ops/session';

/**
 * PATCH /api/ops/alerts/[id]/suppress — suppress an alert temporarily.
 */
/** Longest a client may suppress an alert for: 30 days. */
const MAX_SUPPRESS_MS = 30 * 24 * 60 * 60 * 1000;

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
    const durationMs = body.durationMs === undefined ? 3600000 : body.durationMs;
    if (
      typeof durationMs !== 'number'
      || !Number.isFinite(durationMs)
      || durationMs <= 0
      || durationMs > MAX_SUPPRESS_MS
    ) {
      return NextResponse.json(
        { error: `durationMs must be between 1 and ${MAX_SUPPRESS_MS}` },
        { status: 400 },
      );
    }

    const suppressedUntil = new Date(Date.now() + durationMs);

    if (!(await prisma.alert.findUnique({ where: { id: alertId } }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // One transaction: a status change with no audit event is a hole in the
    // record of who suppressed what.
    const [alert] = await prisma.$transaction([
      prisma.alert.update({
        where: { id: alertId },
        data: {
          status: 'suppressed',
          suppressedUntil,
        },
      }),
      prisma.alertEvent.create({
        data: {
          tenantId,
          alertId,
          eventType: 'suppressed',
          actorUserId: userId,
          actorAction: 'suppressed',
          eventData: JSON.stringify({ durationMs, suppressedUntil }),
        },
      }),
    ]);

    // No re-activation timer: `suppressedUntil` is persisted and readers treat
    // an elapsed suppression as active, which survives a process restart.

    return NextResponse.json({
      id: alert.id,
      status: alert.status,
      suppressedUntil: suppressedUntil.getTime(),
    });
  } catch (e) {
    console.error(`PATCH /api/ops/alerts/${alertId}/suppress`, e);
    return NextResponse.json({ error: 'Failed to suppress alert' }, { status: 500 });
  }
}
