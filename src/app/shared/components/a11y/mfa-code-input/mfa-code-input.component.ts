import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * One-time-code / TOTP entry. Deliberately a SINGLE `<input>` with the right
 * HTML hints rather than six split boxes.
 *
 * Why single-input:
 * - `autocomplete="one-time-code"` is how browsers, iOS, and password managers
 *   autofill TOTP codes. Six split inputs never see that fill event.
 * - Split inputs break paste, backspace across boxes, clipboard recovery,
 *   and screen-reader announcement (AT reads "edit 1" … "edit 2" instead of
 *   one coherent field). Single input solves all four by construction.
 * - `inputmode="numeric"` brings up the numeric keypad on mobile;
 *   `pattern="[0-9]{6}"` gates non-numeric chars.
 *
 * Labelling: callers should pass `inputId` and pair it with a visible
 * `<label for="…">` so the visible text becomes the accessible name. If no
 * `inputId` is provided we fall back to the `label` input as `aria-label`,
 * which covers in-context uses where a visible label would be redundant.
 */
@Component({
  selector: 'app-mfa-code-input',
  standalone: true,
  templateUrl: './mfa-code-input.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaCodeInputComponent {
  readonly length = input<number>(6);
  readonly label = input<string>('One-time code');
  readonly invalid = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  /** Optional id linked to an error message for `aria-describedby`. */
  readonly describedById = input<string | null>(null);
  /**
   * Optional id assigned to the inner `<input>`. When set, a paired
   * `<label for="…">` outside the component owns the accessible name and
   * the `aria-label` fallback is suppressed so the visible text wins.
   */
  readonly inputId = input<string | null>(null);
  /**
   * `'totp'` (default) accepts digits only and auto-submits when `length` is
   * reached — matches the 6-digit authenticator-app UX. `'mixed'` accepts
   * alphanumerics (upper-cased) so the same input can take either a TOTP or
   * a 10-char backup code during MFA disable, where the server tries TOTP
   * first and falls back to backup-code consumption.
   */
  readonly mode = input<'totp' | 'mixed'>('totp');

  /** Accessible name: defer to a paired `<label for>` when `inputId` is set. */
  readonly ariaLabelAttr = computed(() =>
    this.inputId() ? null : this.label(),
  );

  readonly codeEntered = output<string>();
  readonly valueChanged = output<string>();

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  readonly value = signal('');
  readonly pattern = computed(() =>
    this.mode() === 'totp'
      ? `[0-9]{${this.length()}}`
      : `[A-Z0-9]{1,${this.length()}}`,
  );
  readonly inputModeAttr = computed(() =>
    this.mode() === 'totp' ? 'numeric' : 'text',
  );
  readonly isComplete = computed(() => this.value().length === this.length());

  /**
   * Sanitize incoming keystrokes / paste:
   * - strip disallowed characters (digits-only in `'totp'`, alphanumerics in
   *   `'mixed'` — the latter upper-cases to match the backup-code display
   *   format, which the server normalises the same way)
   * - truncate to `length`
   * - auto-submit when full, so the user doesn't have to hit Enter after the
   *   last keystroke (matches Apple / Google authenticator UX, and lets a
   *   pasted backup code like "ABCDE-FGHIJ" submit the disable flow without
   *   an extra click)
   */
  onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const cleaned =
      this.mode() === 'totp'
        ? raw.replace(/\D/g, '').slice(0, this.length())
        : raw
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, this.length());
    this.value.set(cleaned);
    const el = this.inputRef()?.nativeElement;
    if (el && el.value !== cleaned) {
      el.value = cleaned;
    }
    this.valueChanged.emit(cleaned);
    if (cleaned.length === this.length()) {
      this.codeEntered.emit(cleaned);
    }
  }

  /** Clear the field programmatically — e.g. after a failed submit. */
  clear(): void {
    this.value.set('');
    const el = this.inputRef()?.nativeElement;
    if (el) {
      el.value = '';
      el.focus();
    }
  }

  focusInput(): void {
    this.inputRef()?.nativeElement.focus();
  }
}
