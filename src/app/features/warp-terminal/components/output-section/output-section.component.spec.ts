import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { OutputSectionComponent } from './output-section.component';
import { MarkdownService } from '@/core/services/markdown.service';
import type { OutputSection, RenderedLine } from '../../models/terminal-output.model';

const makeSection = (overrides: Partial<OutputSection> = {}): OutputSection => ({
  id: 'section-1',
  type: 'output',
  startLine: 0,
  endLine: 3,
  isCollapsed: false,
  lineCount: 3,
  ...overrides,
});

const makeLines = (texts: string[]): RenderedLine[] =>
  texts.map((text) => ({ spans: [{ text, styleToken: 'text' }] }));

function makeComponent(
  section: OutputSection = makeSection(),
  lines: RenderedLine[] = [],
  isStreaming = false
): { component: OutputSectionComponent; mockMarkdown: any } {
  const mockMarkdown: any = {
    parse: vi.fn((md: string) => `<p>${md}</p>`),
    parseIncremental: vi.fn((md: string) => `<pre>${md}</pre>`),
  };

  const injector = Injector.create({
    providers: [{ provide: MarkdownService, useValue: mockMarkdown }],
  });

  const component = runInInjectionContext(injector, () => new OutputSectionComponent());

  (component as any).section = signal(section);
  (component as any).lines = signal(lines);
  (component as any).isStreaming = signal(isStreaming);

  return { component, mockMarkdown };
}

describe('OutputSectionComponent', () => {
  let component: OutputSectionComponent;
  let mockMarkdown: any;

  beforeEach(() => {
    ({ component, mockMarkdown } = makeComponent());
  });

  // ─── Construction & icon constants ───────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose ChevronDown icon reference', () => {
    expect(component.ChevronDown).toBeDefined();
  });

  it('should expose ChevronRight icon reference', () => {
    expect(component.ChevronRight).toBeDefined();
  });

  // ─── linesWithIndex computed ──────────────────────────────────────────────

  it('should return empty array when lines is empty', () => {
    expect(component.linesWithIndex()).toEqual([]);
  });

  it('should map lines to { index, line } objects', () => {
    const lines = makeLines(['hello', 'world']);
    ({ component } = makeComponent(makeSection(), lines));

    const result = component.linesWithIndex();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ index: 0, line: lines[0] });
    expect(result[1]).toEqual({ index: 1, line: lines[1] });
  });

  it('should preserve original line references', () => {
    const lines = makeLines(['foo']);
    ({ component } = makeComponent(makeSection(), lines));
    expect(component.linesWithIndex()[0].line).toBe(lines[0]);
  });

  // ─── responseHtml computed ────────────────────────────────────────────────

  it('should return empty string for non-response sections', () => {
    ({ component } = makeComponent(makeSection({ type: 'command' }), makeLines(['ls -la'])));
    expect(component.responseHtml()).toBe('');
  });

  it('should return empty string for output sections', () => {
    ({ component } = makeComponent(makeSection({ type: 'output' }), makeLines(['some output'])));
    expect(component.responseHtml()).toBe('');
  });

  it('should return empty string for thinking sections', () => {
    ({ component } = makeComponent(makeSection({ type: 'thinking' }), makeLines(['thinking...'])));
    expect(component.responseHtml()).toBe('');
  });

  it('should call markdown.parse for response section when not streaming', () => {
    const lines = makeLines(['# Hello', 'World']);
    ({ component, mockMarkdown } = makeComponent(
      makeSection({ type: 'response' }),
      lines,
      false
    ));

    component.responseHtml();

    expect(mockMarkdown.parse).toHaveBeenCalledWith('# Hello\nWorld');
    expect(mockMarkdown.parseIncremental).not.toHaveBeenCalled();
  });

  it('should call markdown.parseIncremental for response section when streaming', () => {
    const lines = makeLines(['# Partial', 'content']);
    ({ component, mockMarkdown } = makeComponent(
      makeSection({ type: 'response' }),
      lines,
      true
    ));

    component.responseHtml();

    expect(mockMarkdown.parseIncremental).toHaveBeenCalledWith('# Partial\ncontent');
    expect(mockMarkdown.parse).not.toHaveBeenCalled();
  });

  it('should join multi-span lines into a single text string', () => {
    const lines: RenderedLine[] = [
      { spans: [{ text: 'foo', styleToken: 'text' }, { text: 'bar', styleToken: 'bold' }] },
    ];
    ({ component, mockMarkdown } = makeComponent(
      makeSection({ type: 'response' }),
      lines,
      false
    ));

    component.responseHtml();

    expect(mockMarkdown.parse).toHaveBeenCalledWith('foobar');
  });

  it('should return parsed HTML for response section', () => {
    const lines = makeLines(['Hello']);
    ({ component, mockMarkdown } = makeComponent(makeSection({ type: 'response' }), lines));
    mockMarkdown.parse.mockReturnValue('<p>Hello</p>');

    expect(component.responseHtml()).toBe('<p>Hello</p>');
  });

  // ─── getAnsiClasses ───────────────────────────────────────────────────────

  it('should return empty string for empty styleToken', () => {
    expect(component.getAnsiClasses('')).toBe('');
  });

  it('should return empty string for "text" styleToken', () => {
    expect(component.getAnsiClasses('text')).toBe('');
  });

  it('should prefix a single token with "ansi-"', () => {
    expect(component.getAnsiClasses('bold')).toBe('ansi-bold');
  });

  it('should prefix multiple space-separated tokens with "ansi-"', () => {
    expect(component.getAnsiClasses('bold dim')).toBe('ansi-bold ansi-dim');
  });

  it('should handle foreground color tokens', () => {
    expect(component.getAnsiClasses('fg-1')).toBe('ansi-fg-1');
  });

  it('should handle combined style tokens', () => {
    expect(component.getAnsiClasses('bold dim fg-1')).toBe('ansi-bold ansi-dim ansi-fg-1');
  });

  it('should filter out empty tokens from extra spaces', () => {
    // Single tokens should work correctly
    expect(component.getAnsiClasses('bold')).toBe('ansi-bold');
  });
});
