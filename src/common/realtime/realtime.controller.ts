import { Controller, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, interval, map, merge, of } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { RealtimeService } from './realtime.service';

// Server-Sent Events stream — the live wire into the app. The client opens one
// EventSource; the backend pushes scoped events (this user's notifications +
// the domain refreshes that touch them). A 25s heartbeat keeps proxies from
// closing an idle connection. Auth is enforced — a user only ever receives
// their own scoped stream, never a global broadcast.
@ApiTags('realtime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const events = this.realtime.streamFor(user.userId).pipe(
      map((e): MessageEvent => ({ data: e })),
    );
    const heartbeat = interval(25_000).pipe(
      map((): MessageEvent => ({ data: { type: 'heartbeat', at: Date.now() } })),
    );
    // Emit a single immediate "connected" event so the client flips its live indicator on.
    const hello = of<MessageEvent>({ data: { type: 'connected', at: Date.now() } });
    return merge(hello, events, heartbeat);
  }
}
