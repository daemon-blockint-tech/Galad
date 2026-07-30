import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getOpsUserId, getTenantId } from '@/lib/ops/session';

/** Ceiling of the `escalationLevel` 0-3 scale (schema.prisma: Alert). */
const MAX_ESCALATION_LEVEL = 3;

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

    if (!(await prisma.alert.findUnique({ where: { id: alertId } }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // One transaction so the level, the status and the audit event either all
    // land or none do — the event stream is the record of who escalated what.
    //
    // The bump is an atomic increment instead of a read-modify-write, so two
    // operators clicking Escalate at once can no longer overwrite each other's
    // level. Keeping the cap correct takes the two ordered statements below:
    // `escalationLevel` is a Float that dedup nudges by 0.1 at a time
    // (AlertOrchestrator.ingestAlert), so an unguarded `increment` could land
    // past 3. Clamping the sub-cap band first means the increment only ever
    // sees levels that stay inside the cap after +1.
    const [, , alert] = await prisma.$transaction([
      prisma.alert.updateMany({
        where: {
          id: alertId,
          escalationLevel: { gt: MAX_ESCALATION_LEVEL - 1, lt: MAX_ESCALATION_LEVEL },
        },
        data: { escalationLevel: MAX_ESCALATION_LEVEL },
      }),
      prisma.alert.updateMany({
        where: { id: alertId, escalationLevel: { lte: MAX_ESCALATION_LEVEL - 1 } },
        data: { escalationLevel: { increment: 1 } },
      }),
      prisma.alert.update({
        where: { id: alertId },
        data: { status: 'escalated' },
      }),
      prisma.alertEvent.create({
        data: {
          tenantId,
          alertId,
          eventType: 'escalated',
          actorUserId: userId,
          actorAction: 'escalated',
          actorNotes: reason,
        },
      }),
    ]);

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
