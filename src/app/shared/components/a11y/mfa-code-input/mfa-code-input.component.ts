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
 * The caller is expected to provide a label via `aria-label` since MFA codes
 * are usually shown in-context and don't need a visible `<label>`.
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

  readonly codeEntered = output<string>();
  readonly valueChanged = output<string>();

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  readonly value = signal('');
  readonly pattern = computed(() => `[0-9]{${this.length()}}`);
  readonly isComplete = computed(() => this.value().length === this.length());

  /**
   * Sanitize incoming keystrokes / paste:
   * - strip non-digits
   * - truncate to `length`
   * - auto-submit when full, so the user doesn't have to hit Enter after the
   *   sixth keystroke (matches Apple / Google authenticator UX)
   */
  onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const cleaned = raw.replace(/\D/g, '').slice(0, this.length());
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
