import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STATUSES,
  ACTIVE_PIPELINE_STATUSES,
  InvalidTransitionError,
  STATUS_META,
  SUBMITTED_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  eventTypeForTransition,
  isApplicationStatus,
  transitionsForActor,
  type ApplicationStatus,
} from '@/lib/applications/state';

describe('status registry', () => {
  it('has metadata for every declared status', () => {
    for (const s of APPLICATION_STATUSES) {
      expect(STATUS_META[s]).toBeDefined();
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
      expect(STATUS_META[s].description.length).toBeGreaterThan(0);
    }
  });

  it('recognises only declared statuses', () => {
    expect(isApplicationStatus('draft')).toBe(true);
    expect(isApplicationStatus('submitted_by_user')).toBe(true);
    expect(isApplicationStatus('definitely_applied')).toBe(false);
  });

  it('only treats genuine submission states as submitted', () => {
    expect(SUBMITTED_STATUSES).toContain('submitted_by_user');
    expect(SUBMITTED_STATUSES).toContain('submitted_by_connector');
    expect(SUBMITTED_STATUSES).not.toContain('approved');
    expect(SUBMITTED_STATUSES).not.toContain('opened_externally');
    expect(SUBMITTED_STATUSES).not.toContain('in_progress');
    expect(SUBMITTED_STATUSES).not.toContain('scheduled');
  });

  it('never lists a terminal status in the active pipeline', () => {
    for (const s of ACTIVE_PIPELINE_STATUSES) {
      expect(STATUS_META[s].terminal).toBe(false);
    }
  });
});

describe('transition graph', () => {
  it('permits the ordinary manual-application path', () => {
    const path: ApplicationStatus[] = [
      'draft',
      'ready_for_review',
      'approved',
      'opened_externally',
      'in_progress',
      'submitted_by_user',
      'interview',
      'offer',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('never allows a self-transition', () => {
    for (const s of APPLICATION_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('treats closed as fully terminal', () => {
    expect(allowedTransitions('closed')).toEqual([]);
    for (const s of APPLICATION_STATUSES) {
      expect(canTransition('closed', s)).toBe(false);
    }
  });

  it('lets a rejected or withdrawn application only be closed', () => {
    expect(allowedTransitions('rejected')).toEqual(['closed']);
    expect(allowedTransitions('withdrawn')).toEqual(['closed']);
  });

  it('cannot jump straight from draft to submitted', () => {
    expect(canTransition('draft', 'submitted_by_user')).toBe(false);
    expect(() => assertTransition('draft', 'submitted_by_user', 'user')).toThrow(InvalidTransitionError);
  });

  it('only references statuses that exist', () => {
    for (const from of APPLICATION_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(APPLICATION_STATUSES).toContain(to);
      }
    }
  });
});

describe('who may claim a submission', () => {
  it('allows submitted_by_user only for a direct user action', () => {
    expect(() => assertTransition('approved', 'submitted_by_user', 'user')).not.toThrow();

    for (const actor of ['system', 'assistant', 'connector'] as const) {
      expect(() => assertTransition('approved', 'submitted_by_user', actor)).toThrow(
        /confirmed user action/,
      );
    }
  });

  it('allows submitted_by_connector only for a connector', () => {
    expect(() => assertTransition('approved', 'submitted_by_connector', 'connector')).not.toThrow();

    for (const actor of ['user', 'system', 'assistant'] as const) {
      expect(() => assertTransition('approved', 'submitted_by_connector', actor)).toThrow(
        /authorised connector/,
      );
    }
  });

  it('refuses to record an outcome before submission', () => {
    // Reachable in the graph, but not meaningful: nothing was ever sent.
    expect(() => assertTransition('interview', 'offer', 'user')).not.toThrow();
    expect(() => assertTransition('opened_externally', 'submitted_by_user', 'user')).not.toThrow();

    // 'approved' is not a submitted state, so an interview cannot follow it.
    expect(canTransition('approved', 'interview')).toBe(false);
  });

  it('hides submission transitions from a scheduled system actor', () => {
    const systemOptions = transitionsForActor('approved', 'system');
    expect(systemOptions).not.toContain('submitted_by_user');
    expect(systemOptions).not.toContain('submitted_by_connector');
    // A background task may still prepare and schedule work.
    expect(systemOptions).toContain('scheduled');
  });

  it('offers the user the manual submission path', () => {
    const userOptions = transitionsForActor('approved', 'user');
    expect(userOptions).toContain('submitted_by_user');
    expect(userOptions).toContain('opened_externally');
    expect(userOptions).not.toContain('submitted_by_connector');
  });
});

describe('event naming', () => {
  it('maps notable transitions to specific audit event types', () => {
    expect(eventTypeForTransition('approved')).toBe('application.approved');
    expect(eventTypeForTransition('opened_externally')).toBe('application.external_portal_opened');
    expect(eventTypeForTransition('submitted_by_user')).toBe('application.marked_submitted');
    expect(eventTypeForTransition('withdrawn')).toBe('application.withdrawn');
    expect(eventTypeForTransition('interview')).toBe('application.status_changed');
  });
});
