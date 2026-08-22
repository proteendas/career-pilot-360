/**
 * Application status state machine. Pure, dependency-free, unit-tested.
 *
 * Two rules encode the product's core promise:
 *
 *  1. `submitted_by_user` is reachable ONLY through an explicit user
 *     confirmation (`canTransition` allows it, but `assertTransition` requires
 *     an actor of 'user'), and `submitted_by_connector` ONLY from a connector.
 *     Nothing else may claim an application was submitted.
 *
 *  2. Terminal statuses cannot silently reopen. Reopening is possible, but only
 *     along explicitly declared edges, so it always shows up as a real event in
 *     the timeline.
 */

export const APPLICATION_STATUSES = [
  'draft',
  'ready_for_review',
  'approved',
  'scheduled',
  'opened_externally',
  'in_progress',
  'submitted_by_user',
  'submitted_by_connector',
  'needs_user_input',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'closed',
  'failed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type ActorType = 'user' | 'system' | 'assistant' | 'connector';

export interface StatusMeta {
  label: string;
  description: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** True once the employer has actually received the application. */
  submitted: boolean;
  terminal: boolean;
}

export const STATUS_META: Record<ApplicationStatus, StatusMeta> = {
  draft: {
    label: 'Draft',
    description: 'A packet is being prepared. Nothing has been shown to an employer.',
    tone: 'neutral',
    submitted: false,
    terminal: false,
  },
  ready_for_review: {
    label: 'Ready for review',
    description: 'The packet is complete and waiting for you to read it.',
    tone: 'accent',
    submitted: false,
    terminal: false,
  },
  approved: {
    label: 'Approved by you',
    description: 'You have reviewed the packet and approved its contents.',
    tone: 'info',
    submitted: false,
    terminal: false,
  },
  scheduled: {
    label: 'Scheduled',
    description: 'Queued for preparation at a later time. Scheduling never submits.',
    tone: 'info',
    submitted: false,
    terminal: false,
  },
  opened_externally: {
    label: 'Opened externally',
    description: 'You opened the official application portal in a new tab.',
    tone: 'info',
    submitted: false,
    terminal: false,
  },
  in_progress: {
    label: 'In progress',
    description: 'You are part-way through the employer’s own application form.',
    tone: 'warning',
    submitted: false,
    terminal: false,
  },
  submitted_by_user: {
    label: 'Submitted by you',
    description: 'You confirmed that you submitted this application.',
    tone: 'success',
    submitted: true,
    terminal: false,
  },
  submitted_by_connector: {
    label: 'Submitted by connector',
    description: 'An authorised API connector returned a successful submission.',
    tone: 'success',
    submitted: true,
    terminal: false,
  },
  needs_user_input: {
    label: 'Needs your input',
    description: 'Something could not be answered safely without you.',
    tone: 'warning',
    submitted: false,
    terminal: false,
  },
  interview: {
    label: 'Interview',
    description: 'You have an interview stage in progress.',
    tone: 'accent',
    submitted: true,
    terminal: false,
  },
  offer: {
    label: 'Offer',
    description: 'An offer has been extended.',
    tone: 'success',
    submitted: true,
    terminal: false,
  },
  rejected: {
    label: 'Rejected',
    description: 'The employer declined to proceed.',
    tone: 'danger',
    submitted: true,
    terminal: true,
  },
  withdrawn: {
    label: 'Withdrawn',
    description: 'You withdrew from the process.',
    tone: 'neutral',
    submitted: false,
    terminal: true,
  },
  closed: {
    label: 'Closed',
    description: 'The role closed, or you stopped tracking it.',
    tone: 'neutral',
    submitted: false,
    terminal: true,
  },
  failed: {
    label: 'Failed',
    description: 'A step could not be completed. Nothing was sent.',
    tone: 'danger',
    submitted: false,
    terminal: false,
  },
};

/** Statuses that represent live, in-flight work for the pipeline widget. */
export const ACTIVE_PIPELINE_STATUSES: ApplicationStatus[] = [
  'ready_for_review',
  'approved',
  'scheduled',
  'opened_externally',
  'in_progress',
  'submitted_by_user',
  'submitted_by_connector',
  'needs_user_input',
  'interview',
  'offer',
];

/** Statuses meaning "the employer has it". */
export const SUBMITTED_STATUSES: ApplicationStatus[] = APPLICATION_STATUSES.filter(
  (s) => STATUS_META[s].submitted,
);

const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['ready_for_review', 'needs_user_input', 'withdrawn', 'closed', 'failed'],
  ready_for_review: ['approved', 'draft', 'needs_user_input', 'withdrawn', 'closed', 'failed'],
  approved: [
    'scheduled',
    'opened_externally',
    'submitted_by_user',
    'submitted_by_connector',
    'in_progress',
    'ready_for_review',
    'needs_user_input',
    'withdrawn',
    'closed',
    'failed',
  ],
  scheduled: ['approved', 'opened_externally', 'in_progress', 'needs_user_input', 'withdrawn', 'closed', 'failed'],
  opened_externally: [
    'in_progress',
    'submitted_by_user',
    'needs_user_input',
    'withdrawn',
    'closed',
    'failed',
    'approved',
  ],
  in_progress: ['submitted_by_user', 'needs_user_input', 'withdrawn', 'closed', 'failed', 'opened_externally'],
  submitted_by_user: ['interview', 'offer', 'rejected', 'withdrawn', 'closed'],
  submitted_by_connector: ['interview', 'offer', 'rejected', 'withdrawn', 'closed'],
  needs_user_input: ['draft', 'ready_for_review', 'approved', 'withdrawn', 'closed'],
  interview: ['offer', 'rejected', 'withdrawn', 'closed', 'interview'],
  offer: ['closed', 'rejected', 'withdrawn'],
  // Terminal: reopening is possible only along these explicit edges.
  rejected: ['closed'],
  withdrawn: ['closed'],
  closed: [],
  failed: ['draft', 'ready_for_review', 'approved', 'withdrawn', 'closed'],
};

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function allowedTransitions(from: ApplicationStatus): ApplicationStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export class InvalidTransitionError extends Error {
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;
  constructor(from: ApplicationStatus, to: ApplicationStatus, reason?: string) {
    super(reason ?? `An application cannot move from “${STATUS_META[from].label}” to “${STATUS_META[to].label}”.`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Validate a transition, including who is allowed to perform it.
 *
 * The submission statuses are gated on the actor: this is the mechanism that
 * makes "never claim an application was submitted" enforceable rather than
 * aspirational.
 */
export function assertTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  actor: ActorType = 'user',
): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);

  if (to === 'submitted_by_user' && actor !== 'user') {
    throw new InvalidTransitionError(
      from,
      to,
      'Only a direct, confirmed user action can mark an application as submitted.',
    );
  }
  if (to === 'submitted_by_connector' && actor !== 'connector') {
    throw new InvalidTransitionError(
      from,
      to,
      'Only an authorised connector reporting a successful submission can set this status.',
    );
  }
  if ((to === 'interview' || to === 'offer' || to === 'rejected') && !STATUS_META[from].submitted) {
    throw new InvalidTransitionError(
      from,
      to,
      'An outcome cannot be recorded before the application has actually been submitted.',
    );
  }
}

/** Statuses an actor may move to, for rendering menus. */
export function transitionsForActor(from: ApplicationStatus, actor: ActorType): ApplicationStatus[] {
  return allowedTransitions(from).filter((to) => {
    try {
      assertTransition(from, to, actor);
      return true;
    } catch {
      return false;
    }
  });
}

/** Event type recorded in `application_events` for a status change. */
export function eventTypeForTransition(to: ApplicationStatus): string {
  switch (to) {
    case 'approved':
      return 'application.approved';
    case 'opened_externally':
      return 'application.external_portal_opened';
    case 'submitted_by_user':
      return 'application.marked_submitted';
    case 'submitted_by_connector':
      return 'application.connector_submitted';
    case 'withdrawn':
      return 'application.withdrawn';
    default:
      return 'application.status_changed';
  }
}
