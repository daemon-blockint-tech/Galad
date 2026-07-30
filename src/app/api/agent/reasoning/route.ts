/**
 * @file src/app/api/agent/reasoning/route.ts
 * @description Agent reasoning loop control and status endpoint.
 * Triggers perception-orientation-decision-action cycles.
 *
 * POST: Start a reasoning cycle or continuous operation
 * GET: Get agent status and decision history
 */

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantId } from '@/lib/ops/session';
import { getGlobalSemanticStore } from '@/core/semantic';
import { getAgentContext } from '@/core/semantic/agentContext';
import { SemanticAgent } from '@/core/semantic/agentReasoning';

/**
 * POST /api/agent/reasoning
 *
 * Trigger a reasoning cycle or continuous operation.
 *
 * Body:
 * {
 *   "action": "cycle" | "status" | "add_goal" | "clear",
 *   "goal"?: { type, description, priority, ... },
 *   "interval"?: number (for continuous),
 *   "maxCycles"?: number (for continuous)
 * }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const tenantId = await getTenantId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Body must be an object' },
      { status: 400 },
    );
  }

  const { action } = body as { action?: string };

  try {
    const store = getGlobalSemanticStore(tenantId);
    const context = getAgentContext(userId, tenantId);
    const agent = new SemanticAgent(userId, context, store, tenantId);

    switch (action) {
      case 'cycle': {
        // Execute one reasoning cycle
        const result = await agent.cycle();
        return NextResponse.json({
          ok: true,
          result,
          status: agent.getStatus(),
        });
      }

      case 'status': {
        // Get agent status
        const status = agent.getStatus();
        const decisions = context.getDecisionHistory(10);
        const threats = context.getActivethreats();

        return NextResponse.json({
          ok: true,
          status,
          recentDecisions: decisions,
          activethreats: threats.map((t) => ({
            entityId: t.entityId,
            threatLevel: t.threatLevel,
            confidence: t.confidenceScore,
          })),
        });
      }

      case 'add_goal': {
        // Add a goal to the agent
        const { goal } = body as { goal?: any };
        if (!goal || !goal.id) {
          return NextResponse.json(
            { error: 'Goal must have id field' },
            { status: 400 },
          );
        }

        context.addGoal({
          ...goal,
          createdAt: Date.now(),
        });

        return NextResponse.json({
          ok: true,
          message: `Goal ${goal.id} added`,
          status: agent.getStatus(),
        });
      }

      case 'complete_goal': {
        // Mark goal as complete
        const { goalId } = body as { goalId?: string };
        if (!goalId) {
          return NextResponse.json(
            { error: 'goalId required' },
            { status: 400 },
          );
        }

        context.completeGoal(goalId);

        return NextResponse.json({
          ok: true,
          message: `Goal ${goalId} completed`,
        });
      }

      case 'get_context': {
        // Get full agent context
        const summary = context.getSummary();
        const history = context.getObservationHistory(300);
        const hypotheses = context.getHypotheses();
        const anomalies = context.getAnomalies();

        return NextResponse.json({
          ok: true,
          summary,
          observationCount: history.length,
          hypothesisCount: hypotheses.length,
          anomalyCount: anomalies.length,
          topHypothesis: context.getTopHypothesis(),
        });
      }

      case 'clear': {
        // Clear agent context (reset)
        const summary = context.getSummary();

        return NextResponse.json({
          ok: true,
          message: 'Agent context cleared',
          clearedStats: summary,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/agent/reasoning
 *
 * Get agent status and capabilities.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const tenantId = await getTenantId();

  try {
    const store = getGlobalSemanticStore(tenantId);
    const context = getAgentContext(userId, tenantId);
    const agent = new SemanticAgent(userId, context, store, tenantId);

    return NextResponse.json({
      ok: true,
      status: agent.getStatus(),
      capabilities: {
        perceive: 'Query entities by type, domain, disposition',
        orient: 'Infer threats, detect anomalies, discover relationships',
        decide:
          'Recommend actions based on threat assessment and goals',
        act: 'Execute decisions and record reasoning',
      },
      actions: [
        'cycle',
        'status',
        'add_goal',
        'complete_goal',
        'get_context',
        'clear',
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
