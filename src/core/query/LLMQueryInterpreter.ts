/**
 * @file LLMQueryInterpreter.ts
 * @description Natural language query interpreter using Deepseek V4 flash via OpenRouter.
 * Converts natural language questions to structured query engine calls.
 */

import { PrismaClient } from '@/generated/prisma';
import { TemporalQueryEngine, TemporalQuery } from './TemporalQueryEngine';
import { PredictiveQueryEngine, PredictiveQuery } from './PredictiveQueryEngine';
import { FullTextSearchIndex } from '@/core/search/FullTextSearchIndex';
import { CorrelationQueryEngine, CorrelationQuery } from './CorrelationQueryEngine';

export interface LLMQuery {
  naturalLanguage: string;
  context?: {
    selectedEntityIds?: string[];
    timeRange?: [number, number];
    aggregation?: string;
  };
}

export interface InterpretedQuery {
  type: 'temporal' | 'predictive' | 'search' | 'correlation' | 'multi';
  confidence: number;
  structuredQueries: Array<{
    engine: string;
    query: any;
    rationale: string;
  }>;
  summary: string;
}

export interface LLMQueryResult {
  query: LLMQuery;
  interpretation: InterpretedQuery;
  results: any;
  executionTime: number;
  insights: string[];
}

export class LLMQueryInterpreter {
  private db: PrismaClient;
  private temporalEngine: TemporalQueryEngine;
  private predictiveEngine: PredictiveQueryEngine;
  private searchIndex: FullTextSearchIndex;
  private correlationEngine: CorrelationQueryEngine;
  private tenantId?: string;
  private openRouterApiKey: string;
  private openRouterModel = 'deepseek/deepseek-chat';

  constructor(
    db: PrismaClient,
    temporalEngine: TemporalQueryEngine,
    predictiveEngine: PredictiveQueryEngine,
    searchIndex: FullTextSearchIndex,
    correlationEngine: CorrelationQueryEngine,
    tenantId?: string,
  ) {
    this.db = db;
    this.temporalEngine = temporalEngine;
    this.predictiveEngine = predictiveEngine;
    this.searchIndex = searchIndex;
    this.correlationEngine = correlationEngine;
    this.tenantId = tenantId;
    this.openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
  }

  /**
   * Interpret and execute natural language query.
   */
  async interpret(q: LLMQuery): Promise<LLMQueryResult> {
    const startTime = Date.now();

    try {
      // Call LLM to interpret query
      const interpretation = await this.callLLM(q);

      // Execute structured queries
      const results = await this.executeInterpretedQueries(interpretation);

      // Generate insights
      const insights = this.generateInsights(interpretation, results);

      const executionTime = Date.now() - startTime;

      return {
        query: q,
        interpretation,
        results,
        executionTime,
        insights,
      };
    } catch (error) {
      console.error('LLMQueryInterpreter: Interpretation failed:', error);
      throw error;
    }
  }

  /**
   * Call Deepseek V4 flash via OpenRouter.
   */
  private async callLLM(q: LLMQuery): Promise<InterpretedQuery> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(q);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openRouterApiKey}`,
          'X-Title': 'Grond-Eye',
        },
        body: JSON.stringify({
          model: this.openRouterModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data: any = await response.json();
      const content = data.choices[0]?.message?.content || '';

      return this.parseInterpretation(content, q);
    } catch (error) {
      console.error('LLMQueryInterpreter: LLM call failed:', error);
      return this.fallbackInterpretation(q);
    }
  }

  /**
   * Build system prompt for query interpretation.
   */
  private buildSystemPrompt(): string {
    return `You are a threat intelligence query system. Your job is to convert natural language questions into structured queries.

Available query types:
1. TEMPORAL - analyze entities over time (query types: anomaly_timeline, behavior_change, threat_trend, alert_timeline)
2. PREDICTIVE - forecast future threats (query types: anomaly_forecast, threat_escalation, eta_resolution)
3. SEARCH - find entities/alerts (full-text search with filters)
4. CORRELATION - find relationships between entities (threat_correlation, temporal_alignment, spatial_proximity, entity_fusion)
5. MULTI - combine multiple query types

For each query type, extract:
- Entity IDs (if specific entities mentioned)
- Time window (if temporal/predictive)
- Aggregation mode (raw, hourly, daily) for temporal
- Correlation type and threshold
- Search terms and filters

Respond ONLY with valid JSON in this exact format:
{
  "type": "temporal|predictive|search|correlation|multi",
  "confidence": 0.0-1.0,
  "structuredQueries": [
    {
      "engine": "temporal|predictive|search|correlation",
      "query": {...},
      "rationale": "explanation of why this query matches the user intent"
    }
  ],
  "summary": "brief summary of interpreted intent"
}`;
  }

  /**
   * Build user prompt from natural language query.
   */
  private buildUserPrompt(q: LLMQuery): string {
    let prompt = `User question: "${q.naturalLanguage}"`;

    if (q.context?.selectedEntityIds) {
      prompt += `\nSelected entities: ${q.context.selectedEntityIds.join(', ')}`;
    }

    if (q.context?.timeRange) {
      const [start, end] = q.context.timeRange;
      prompt += `\nTime range: ${new Date(start).toISOString()} to ${new Date(end).toISOString()}`;
    }

    if (q.context?.aggregation) {
      prompt += `\nPreferred aggregation: ${q.context.aggregation}`;
    }

    prompt += '\n\nProvide structured query interpretation as JSON only.';

    return prompt;
  }

  /**
   * Parse LLM response into InterpretedQuery.
   */
  private parseInterpretation(content: string, q: LLMQuery): InterpretedQuery {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      return {
        type: parsed.type || 'search',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        structuredQueries: (parsed.structuredQueries || []).map((sq: any) => ({
          engine: sq.engine,
          query: sq.query,
          rationale: sq.rationale || 'No rationale provided',
        })),
        summary: parsed.summary || 'Query interpretation',
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      return this.fallbackInterpretation(q);
    }
  }

  /**
   * Fallback interpretation for LLM failures.
   */
  private fallbackInterpretation(q: LLMQuery): InterpretedQuery {
    const query = q.naturalLanguage.toLowerCase();

    // Simple heuristic-based interpretation
    if (query.includes('threat') && query.includes('over time')) {
      return {
        type: 'temporal',
        confidence: 0.6,
        structuredQueries: [
          {
            engine: 'temporal',
            query: {
              type: 'threat_trend',
              timeRange: q.context?.timeRange || [Date.now() - 24 * 60 * 60 * 1000, Date.now()],
              aggregation: q.context?.aggregation || 'hourly',
            },
            rationale: 'Matched threat + time pattern',
          },
        ],
        summary: 'Analyzing threat trends over time',
      };
    }

    if (query.includes('forecast') || query.includes('predict')) {
      return {
        type: 'predictive',
        confidence: 0.6,
        structuredQueries: [
          {
            engine: 'predictive',
            query: {
              type: 'threat_escalation',
              entityIds: q.context?.selectedEntityIds || [],
              horizon: 24 * 60 * 60 * 1000,
            },
            rationale: 'Matched prediction intent',
          },
        ],
        summary: 'Generating threat forecasts',
      };
    }

    if (query.includes('related') || query.includes('correlated') || query.includes('connected')) {
      return {
        type: 'correlation',
        confidence: 0.6,
        structuredQueries: [
          {
            engine: 'correlation',
            query: {
              type: 'threat_correlation',
              entityIds: q.context?.selectedEntityIds || [],
              threshold: 0.6,
            },
            rationale: 'Matched correlation intent',
          },
        ],
        summary: 'Finding correlated entities',
      };
    }

    // Default to search
    return {
      type: 'search',
      confidence: 0.5,
      structuredQueries: [
        {
          engine: 'search',
          query: {
            query: q.naturalLanguage,
            limit: 50,
          },
          rationale: 'Defaulting to full-text search',
        },
      ],
      summary: 'Performing full-text search',
    };
  }

  /**
   * Execute interpreted queries against appropriate engines.
   */
  private async executeInterpretedQueries(interpretation: InterpretedQuery): Promise<any> {
    const results: any = {};

    for (const sq of interpretation.structuredQueries) {
      try {
        switch (sq.engine) {
          case 'temporal':
            results[sq.engine] = await this.temporalEngine.query(sq.query as TemporalQuery);
            break;

          case 'predictive':
            results[sq.engine] = await this.predictiveEngine.query(sq.query as PredictiveQuery);
            break;

          case 'search':
            results[sq.engine] = await this.searchIndex.advancedSearch(
              sq.query.query,
              sq.query.filters || {},
              sq.query.limit || 50,
            );
            break;

          case 'correlation':
            results[sq.engine] = await this.correlationEngine.query(sq.query as CorrelationQuery);
            break;

          default:
            console.warn(`Unknown query engine: ${sq.engine}`);
        }
      } catch (error) {
        console.error(`Error executing ${sq.engine} query:`, error);
        results[sq.engine] = { error: String(error) };
      }
    }

    return results;
  }

  /**
   * Generate natural language insights from results.
   */
  private generateInsights(interpretation: InterpretedQuery, results: any): string[] {
    const insights: string[] = [];

    // Temporal insights
    if (results.temporal) {
      const temporalResults = Array.isArray(results.temporal) ? results.temporal : [results.temporal];
      for (const result of temporalResults) {
        if (result.summary) {
          if (result.summary.trend === 'increasing') {
            insights.push(`⚠️ Threat level is increasing over time (trend: ${result.summary.trend})`);
          } else if (result.summary.trend === 'decreasing') {
            insights.push(`✅ Threat level is improving (trend: ${result.summary.trend})`);
          }

          if (result.summary.maxValue > 0.8) {
            insights.push(`🔴 Peak threat detected: ${(result.summary.maxValue * 100).toFixed(1)}%`);
          }
        }
      }
    }

    // Predictive insights
    if (results.predictive) {
      const predictiveResults = Array.isArray(results.predictive) ? results.predictive : [results.predictive];
      for (const result of predictiveResults) {
        if (result.riskLevel === 'critical') {
          insights.push(`🚨 CRITICAL risk predicted: ${result.recommendations[0] || 'Immediate action required'}`);
        } else if (result.riskLevel === 'high') {
          insights.push(`⚠️ High risk prediction: ${result.recommendations[0] || 'Escalation recommended'}`);
        }

        if (result.trend === 'degrading') {
          insights.push(`📈 Threat trend is degrading - escalation likely`);
        }
      }
    }

    // Search insights
    if (results.search && Array.isArray(results.search)) {
      insights.push(`Found ${results.search.length} matching alerts/entities`);

      const critical = results.search.filter((r: any) => r.metadata?.severity === 'critical').length;
      if (critical > 0) {
        insights.push(`${critical} critical severity matches found`);
      }
    }

    // Correlation insights
    if (results.correlation && Array.isArray(results.correlation)) {
      const veryStrong = results.correlation.filter((r: any) => r.strength === 'very_strong').length;
      const strong = results.correlation.filter((r: any) => r.strength === 'strong').length;

      if (veryStrong > 0) {
        insights.push(`🔗 ${veryStrong} very strong correlation(s) detected - possible coordinated activity`);
      }

      if (strong > 0) {
        insights.push(`🔗 ${strong} strong correlation(s) - investigate for relationships`);
      }
    }

    if (insights.length === 0) {
      insights.push('No significant threats or anomalies detected');
    }

    return insights;
  }

  /**
   * Get query suggestions based on common patterns.
   */
  async getSuggestions(): Promise<string[]> {
    return [
      'Show me threat trends over the last 24 hours',
      'Which entities are most correlated?',
      'Forecast threat levels for the next 7 days',
      'Find all critical alerts in the last hour',
      'Show entities with similar behavior patterns',
      'Estimate time to resolve active incidents',
      'Which entities are in close proximity?',
      'Are there coordinated anomalies across entities?',
      'What is the current threat trajectory?',
      'Find potential duplicate entities',
    ];
  }

  /**
   * Validate LLM API configuration.
   */
  async validateConfiguration(): Promise<boolean> {
    if (!this.openRouterApiKey) {
      console.warn('OPENROUTER_API_KEY not configured');
      return false;
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${this.openRouterApiKey}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to validate OpenRouter API:', error);
      return false;
    }
  }
}
