/**
 * @file ThreatCorrelationPanel.test.tsx
 * @description The "Threat Timeline" chart was 61 buckets of
 * Math.floor(Math.random() * 10) drawn as bar heights next to honestly computed
 * stats. There is no threat history in the semantic store to chart, so the
 * panel has to say so.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  getGlobalSemanticStore,
  resetGlobalSemanticStore,
} from '@/core/semantic/semanticStore';

import { ThreatCorrelationPanel } from './ThreatCorrelationPanel';

describe('ThreatCorrelationPanel', () => {
  beforeEach(() => {
    resetGlobalSemanticStore();
  });

  it('renders an explicit no-history state instead of a chart', () => {
    const store = getGlobalSemanticStore();
    store.setEntity('radar', 'contact-1', { latitude: 40, longitude: -74 });
    store.setThreatAssessment('radar', 'contact-1', 'critical', 0.9, 0.5);

    const { container } = render(<ThreatCorrelationPanel />);

    expect(screen.getByText(/no threat history available/i)).toBeDefined();

    // No bar chart: nothing is sized from a fabricated count.
    const sized = container.querySelectorAll('[style*="height"]');
    expect(sized).toHaveLength(0);
  });

  it('renders threat counts from the store', () => {
    const store = getGlobalSemanticStore();
    store.setEntity('radar', 'contact-1', { latitude: 40, longitude: -74 });
    store.setEntity('radar', 'contact-2', { latitude: 41, longitude: -74 });
    store.setThreatAssessment('radar', 'contact-1', 'critical', 0.9, 0.5);

    render(<ThreatCorrelationPanel />);

    expect(screen.getByText('2 entities')).toBeDefined();
    // contact-1 critical, contact-2 unassessed -> unknown.
    const critical = screen.getByText('Critical').parentElement;
    expect(critical?.textContent).toContain('1');
    const unknown = screen.getByText('Unknown').parentElement;
    expect(unknown?.textContent).toContain('1');
  });
});
