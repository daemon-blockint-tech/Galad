import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LLMQueryInterpreter } from '@/core/query/LLMQueryInterpreter';
import { TemporalQueryEngine } from '@/core/query/TemporalQueryEngine';
import { PredictiveQueryEngine } from '@/core/query/PredictiveQueryEngine';
import { FullTextSearchIndex } from '@/core/search/FullTextSearchIndex';
import { CorrelationQueryEngine } from '@/core/query/CorrelationQueryEngine';
import { AnomalyDetectionEngine } from '@/core/ml/AnomalyDetectionEngine';
import { SemanticStore } from '@/core/semantic/semanticStore';
import { getOpsUserId } from '@/lib/ops/session';

const semanticStore = new SemanticStore();
const anomalyEngine = new AnomalyDetectionEngine(semanticStore);
const temporalEngine = new TemporalQueryEngine(prisma, anomalyEngine, semanticStore);
const predictiveEngine = new PredictiveQueryEngine(prisma, anomalyEngine);
const searchIndex = new FullTextSearchIndex(prisma);
const correlationEngine = new CorrelationQueryEngine(prisma, undefined, semanticStore);
const llmInterpreter = new LLMQueryInterpreter(
  prisma,
  temporalEngine,
  predictiveEngine,
  searchIndex,
  correlationEngine,
);

/**
 * POST /api/ops/query
 * Execute natural language query and get structured results.
 */
export async function POST(request: NextRequest) {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { naturalLanguage, context } = body;

    if (!naturalLanguage || typeof naturalLanguage !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid naturalLanguage query' },
        { status: 400 },
      );
    }

    const result = await llmInterpreter.interpret({
      naturalLanguage,
      context: context || {},
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Query API error:', error);
    return NextResponse.json(
      { error: 'Query execution failed' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ops/query/suggestions
 * Get example query suggestions.
 */
export async function GET() {
  const userId = await getOpsUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const suggestions = await llmInterpreter.getSuggestions();

    return NextResponse.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    console.error('Suggestions API error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve suggestions' },
      { status: 500 },
    );
  }
}
