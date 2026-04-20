import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { Component } from '@angular/core';

import { ConfirmDialogComponent } from './confirm-dialog.component';

setupTestBed();

@Component({
  standalone: true,
  imports: [ConfirmDialogComponent],
  template: `
    <app-confirm-dialog
      [open]="true"
      title="Delete?"
      [message]="'Removing will:'"
      [consequences]="consequences"
      [note]="note"
    />
  `,
})
class HostComponent {
  consequences: string[] = ['break foo', 'clear bar', 'deny baz'];
  note: string | null = 'Some reassurance.';
}

describe('ConfirmDialogComponent a11y', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // The dialog portals inline, so document.body is the cleanest root to
    // query — the modal's fixed-position backdrop sits on document.
    return document.body;
  }

  it('wires aria-labelledby and aria-describedby to stable per-instance ids', () => {
    const root = render();
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).toBeTruthy();

    const labelId = dialog!.getAttribute('aria-labelledby');
    const descId = dialog!.getAttribute('aria-describedby');
    expect(labelId).toBeTruthy();
    expect(descId).toBeTruthy();
    // The title and description nodes both have to exist and their ids must
    // match — screen readers that look up the dialog's accessible description
    // resolve this id inside the document, so a dangling reference would be
    // silently ignored and the consequences list wouldn't be announced.
    expect(document.getElementById(labelId!)?.textContent?.trim()).toBe('Delete?');
    const desc = document.getElementById(descId!);
    expect(desc).toBeTruthy();
    expect(desc!.textContent).toContain('Removing will:');
    expect(desc!.textContent).toContain('break foo');
    expect(desc!.textContent).toContain('Some reassurance.');
  });

  it('renders consequences as a semantic <ul role="list">', () => {
    const root = render();
    const list = root.querySelector<HTMLElement>('[role="dialog"] ul[role="list"]');
    expect(list).toBeTruthy();
    const items = list!.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('break foo');
    expect(items[2].textContent).toContain('deny baz');
  });
});
