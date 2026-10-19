// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RelativeTime } from '../../../../main/resources/assets/js/components/ui/relative-time';

afterEach(() => {
  vi.useRealTimers();
});

describe('RelativeTime', () => {
  it('should say the time relative to now and keep the absolute date in its title', () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-12T12:05:00Z') });
    render(<RelativeTime iso="2026-09-12T12:00:00Z" />);

    const time = screen.getByText('5 minutes ago');
    expect(time).toHaveAttribute('dateTime', '2026-09-12T12:00:00Z');
    expect(time.getAttribute('title')).toContain('2026');
  });

  it('should move on as time passes without anything else rendering', () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-12T12:00:00Z') });
    render(<RelativeTime iso="2026-09-12T12:00:00Z" />);
    expect(screen.getByText('now')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument();
  });
});
