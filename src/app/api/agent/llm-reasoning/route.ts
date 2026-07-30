/**
 * @file src/app/api/agent/llm-reasoning/route.ts
 * @description LLM-enhanced agent reasoning endpoint.
 * Uses OpenRouter Deepseek V4 flash for intelligent threat assessment and decision-making.
 *
 * POST: Trigger LLM-powered reasoning cycle
 * GET: Get LLM agent status and statistics
 */

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantId } from '@/lib/ops/session';
import { getGlobalSemanticStore } from '@/core/semantic';
import { getAgentContext } from '@/core/semantic/agentContext';
import { LLMSemanticAgent } from '@/core/semantic/llmAgent';

/**
 * POST /api/agent/llm-reasoning
 *
 * Trigger an LLM-enhanced reasoning cycle.
 *
 * Body:
 * {
 *   "action": "cycle" | "status" | "stats",
 *   "withLLM"?: boolean (default: true)
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
    const agent = new LLMSemanticAgent(userId, context, store, tenantId);

    switch (action) {
      case 'cycle': {
        // Execute one LLM-enhanced reasoning cycle
        const result = await agent.cycleLLM();
        const llmStats = agent.getLLMStats();

        return NextResponse.json({
          ok: true,
          result,
          llmStats,
          status: agent.getStatus(),
        });
      }

      case 'status': {
        // Get agent status
        const status = agent.getStatus();
        const decisions = context.getDecisionHistory(10);
        const threats = context.getActivethreats();
        const llmStats = agent.getLLMStats();

        return NextResponse.json({
          ok: true,
          status,
          recentDecisions: decisions,
          activethreats: threats.map((t) => ({
            entityId: t.entityId,
            threatLevel: t.threatLevel,
            confidence: t.confidenceScore,
            llmEnhanced: !!t.threatFactors.llmReasoning,
          })),
          llmStats,
        });
      }

      case 'stats': {
        // Get LLM statistics
        const llmStats = agent.getLLMStats();

        return NextResponse.json({
          ok: true,
          llmStats,
          model: 'deepseek/deepseek-chat',
          message:
            'LLM-enhanced agent provides reasoning for threat assessment and decision-making',
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
 * GET /api/agent/llm-reasoning
 *
 * Get LLM agent capabilities and configuration.
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
    const agent = new LLMSemanticAgent(userId, context, store, tenantId);

    return NextResponse.json({
      ok: true,
      status: agent.getStatus(),
      model: 'deepseek/deepseek-chat',
      capabilities: {
        perceive: 'Query entities by type, domain, disposition',
        orient: 'LLM-enhanced threat inference, anomaly detection, hypothesis generation',
        decide: 'LLM-powered decision-making with reasoning',
        act: 'Execute decisions and record reasoning',
      },
      features: [
        'Rules-based threat scoring (fast)',
        'LLM-enhanced threat assessment (sophisticated)',
        'Deepseek V4 flash reasoning',
        'Blended scoring (60% rules, 40% LLM)',
        'Token usage tracking',
      ],
      actions: ['cycle', 'status', 'stats'],
      llmStats: agent.getLLMStats(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
