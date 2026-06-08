import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

// A live operational event pushed to one or more users' SSE streams.
//   type        — the domain event name ("AccountantPaymentPaid") or "notification"
//   subjectKind — the entity kind the change touched (Activity, School, …)
//   subjectId   — that entity's id, so the client can patch the right record
//   at          — server timestamp (ms)
//   meta        — small extra payload (title, status, count delta)
export interface LiveEvent {
  type: string;
  subjectKind?: string;
  subjectId?: string;
  at: number;
  meta?: Record<string, unknown>;
}

// In-process pub/sub for real-time delivery. One rxjs Subject per user; the SSE
// controller subscribes, the DomainEventService publishes. Single-process is
// fine for the current deployment — swapping in Redis pub/sub later only
// changes this class, not its callers (publish / streamFor stay the same).
@Injectable()
export class RealtimeService {
  private readonly streams = new Map<string, Subject<LiveEvent>>();

  /** The live event stream for a user (created on first subscribe). */
  streamFor(userId: string): Observable<LiveEvent> {
    return this.subjectFor(userId).asObservable();
  }

  /** Push an event to a single user's stream (no-op if they're not connected). */
  publish(userId: string, event: LiveEvent): void {
    this.streams.get(userId)?.next(event);
  }

  /** Push the same event to many users (deduped). */
  publishMany(userIds: Array<string | undefined | null>, event: LiveEvent): void {
    for (const u of new Set(userIds.filter((x): x is string => !!x))) this.publish(u, event);
  }

  /** Connected-stream count — surfaced by system-health. */
  connectionCount(): number {
    return [...this.streams.values()].reduce((n, s) => n + (s.observed ? 1 : 0), 0);
  }

  private subjectFor(userId: string): Subject<LiveEvent> {
    let s = this.streams.get(userId);
    if (!s) {
      s = new Subject<LiveEvent>();
      this.streams.set(userId, s);
    }
    return s;
  }
}
