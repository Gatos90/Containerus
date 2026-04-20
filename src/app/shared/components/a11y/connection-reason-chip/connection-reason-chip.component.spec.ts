import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import {
  ConnectionReasonChipComponent,
  CONNECTION_REASON_DESCRIPTORS,
} from './connection-reason-chip.component';

setupTestBed();

function render(
  reason: keyof typeof CONNECTION_REASON_DESCRIPTORS,
  label: string,
): ComponentFixture<ConnectionReasonChipComponent> {
  TestBed.configureTestingModule({
    imports: [ConnectionReasonChipComponent],
  });
  const fixture = TestBed.createComponent(ConnectionReasonChipComponent);
  fixture.componentRef.setInput('reason', reason);
  fixture.componentRef.setInput('connectionLabel', label);
  fixture.detectChanges();
  return fixture;
}

describe('ConnectionReasonChipComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the descriptor label as chip text', () => {
    const f = render('refresh_token_expired', 'prod-east');
    const chip = f.nativeElement as HTMLElement;
    expect(chip.textContent).toContain('Refresh token');
  });

  it('contains no focusable descendant (listbox option ARIA constraint)', () => {
    const f = render('refresh_token_expired', 'prod-east');
    const host = f.nativeElement as HTMLElement;
    const focusable = host.querySelectorAll(
      'button, a, input, select, textarea, [tabindex]',
    );
    expect(focusable.length).toBe(0);
  });

  it('hint aria-label includes the connection name for refresh_token_expired', () => {
    const f = render('refresh_token_expired', 'prod-east');
    const hint = (f.nativeElement as HTMLElement).querySelector('[aria-label]')!;
    expect(hint.getAttribute('aria-label')).toBe('Re-login to prod-east');
  });

  it('hint aria-label includes the connection name for server_unreachable', () => {
    const f = render('server_unreachable', 'staging');
    const hint = (f.nativeElement as HTMLElement).querySelector('[aria-label]')!;
    expect(hint.getAttribute('aria-label')).toBe('Retry connection to staging');
  });

  it('hint aria-label includes the connection name for rejected_by_server', () => {
    const f = render('rejected_by_server', 'eu-west');
    const hint = (f.nativeElement as HTMLElement).querySelector('[aria-label]')!;
    expect(hint.getAttribute('aria-label')).toBe('View connection details for eu-west');
  });

  it('hint aria-label includes the connection name for trust_required', () => {
    const f = render('trust_required', 'dev-box');
    const hint = (f.nativeElement as HTMLElement).querySelector('[aria-label]')!;
    expect(hint.getAttribute('aria-label')).toBe('Open trust modal for dev-box');
  });

  it('visible hint text is aria-hidden so SR reads the aria-label only', () => {
    const f = render('refresh_token_expired', 'prod-east');
    const host = f.nativeElement as HTMLElement;
    const hint = host.querySelector('[aria-label="Re-login to prod-east"]')!;
    const visibleHint = hint.querySelector('[aria-hidden="true"]');
    expect(visibleHint?.textContent).toContain('Enter to re-login');
  });
});
