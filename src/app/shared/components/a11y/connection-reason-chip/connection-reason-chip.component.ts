import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConnectionErrorReason } from '../../../../core/models/backend.model';
import { StatusChipComponent } from '../status-chip/status-chip.component';

export interface ReasonDescriptor {
  readonly reason: ConnectionErrorReason;
  /** Short, human-readable sentence for the chip body. */
  readonly label: string;
  /** Short action phrase used in the "press Enter to …" hint. */
  readonly ctaText: string;
  /** Full sentence used inside the hint's `aria-label`, with `{name}` replaced by connection label. */
  readonly ctaAriaTemplate: string;
}

/**
 * CON-126 §3.1: text-first named reason chip. The chip is purely
 * presentational — no interactive descendants — because it lives inside a
 * `role="option"` within the connection switcher's listbox, where
 * ARIA 1.2 forbids focusable children. Enter-on-errored-row is handled by
 * the parent switcher's keydown router, which reads the same descriptor
 * to know which action to invoke.
 */
export const CONNECTION_REASON_DESCRIPTORS: Record<ConnectionErrorReason, ReasonDescriptor> = {
  refresh_token_expired: {
    reason: 'refresh_token_expired',
    label: 'Refresh token',
    ctaText: 're-login',
    ctaAriaTemplate: 'Re-login to {name}',
  },
  server_unreachable: {
    reason: 'server_unreachable',
    label: 'Unreachable',
    ctaText: 'retry',
    ctaAriaTemplate: 'Retry connection to {name}',
  },
  rejected_by_server: {
    reason: 'rejected_by_server',
    label: 'Rejected',
    ctaText: 'view details',
    ctaAriaTemplate: 'View connection details for {name}',
  },
  trust_required: {
    reason: 'trust_required',
    label: 'Trust required',
    ctaText: 'open trust modal',
    ctaAriaTemplate: 'Open trust modal for {name}',
  },
};

@Component({
  selector: 'app-connection-reason-chip',
  standalone: true,
  imports: [StatusChipComponent],
  templateUrl: './connection-reason-chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionReasonChipComponent {
  readonly reason = input.required<ConnectionErrorReason>();
  readonly connectionLabel = input.required<string>();

  readonly descriptor = computed<ReasonDescriptor>(
    () => CONNECTION_REASON_DESCRIPTORS[this.reason()],
  );

  readonly ctaAriaLabel = computed<string>(() =>
    this.descriptor().ctaAriaTemplate.replace('{name}', this.connectionLabel()),
  );
}
