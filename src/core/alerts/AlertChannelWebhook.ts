/**
 * @file AlertChannelWebhook.ts
 * @description Generic HTTP webhook integration for alert routing.
 */

export interface WebhookAlert {
  severity: string;
  title: string;
  description: string;
  entityId: string;
  enrichedContext: Record<string, any>;
  timestamp?: number;
}

/**
 * Generic webhook channel for alert delivery.
 */
export class AlertChannelWebhook {
  private webhookUrl: string;
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  private maxRetries = 3;
  private retryDelays = [1000, 2000, 5000]; // ms

  constructor(webhookUrl: string, headers?: Record<string, string>) {
    this.webhookUrl = webhookUrl;
    if (headers) {
      this.headers = { ...this.headers, ...headers };
    }
  }

  /**
   * Send alert via webhook.
   */
  async send(alertId: string, alert: WebhookAlert): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const payload = this.formatPayload(alertId, alert);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          // Try to extract message ID from response if available
          let messageId = alertId;
          try {
            const responseData = (await response.json()) as any;
            messageId = responseData.id || responseData.messageId || alertId;
          } catch {
            // Ignore parse errors, use alert ID as fallback
          }

          return {
            success: true,
            messageId,
          };
        }

        // Retry on rate limit or server errors
        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, this.retryDelays[attempt]));
            continue;
          }
        }

        return {
          success: false,
          error: `Webhook error: ${response.status} ${response.statusText}`,
        };
      } catch (error) {
        if (attempt < this.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelays[attempt]));
          continue;
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
    };
  }

  private formatPayload(alertId: string, alert: WebhookAlert): Record<string, any> {
    return {
      alert: {
        id: alertId,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        entityId: alert.entityId,
        timestamp: alert.timestamp ?? Date.now(),
      },
      context: {
        threatLevel: alert.enrichedContext.threatLevel,
        hostilityScore: alert.enrichedContext.hostilityScore,
        indicators: alert.enrichedContext.indicators,
        relatedEntities: alert.enrichedContext.relatedEntities,
        entityType: alert.enrichedContext.entityType,
        disposition: alert.enrichedContext.disposition,
      },
      links: {
        dashboard: process.env.DASHBOARD_URL ? `${process.env.DASHBOARD_URL}/ops/alerts/${alertId}` : null,
      },
      metadata: {
        source: 'grond-eye',
        version: '2.25.0',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Verify webhook endpoint is accessible.
   */
  async verify(): Promise<boolean> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          type: 'test',
          message: 'Grond-Eye webhook verification',
        }),
        signal: AbortSignal.timeout(5000),
      });

      return response.ok || response.status === 201 || response.status === 202;
    } catch {
      return false;
    }
  }

  /**
   * Update webhook URL.
   */
  setWebhookUrl(url: string): void {
    this.webhookUrl = url;
  }

  /**
   * Update custom headers.
   */
  setHeaders(headers: Record<string, string>): void {
    this.headers = { 'Content-Type': 'application/json', ...headers };
  }

  /**
   * Get webhook configuration.
   */
  getConfig(): { webhookUrl: string; headers: Record<string, string> } {
    return {
      webhookUrl: this.webhookUrl,
      headers: { ...this.headers },
    };
  }
}
