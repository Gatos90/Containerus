import {
  Component,
  ElementRef,
  ViewChild,
  OnDestroy,
  AfterViewInit,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  effect,
  inject,
  NgZone,
} from '@angular/core';
import { CONTAINERUS_THEME } from './monaco-theme';

@Component({
  selector: 'app-monaco-editor',
  standalone: true,
  template: `<div #editorContainer class="h-full w-full"></div>`,
  styles: [`:host { display: block; overflow: hidden; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonacoEditorComponent implements AfterViewInit, OnDestroy {
  /** The editor content. Setting this replaces the model value. */
  content = input<string>('');

  /** Monaco language ID (e.g. 'yaml', 'json', 'typescript'). */
  language = input<string>('plaintext');

  /** Whether the editor is read-only. */
  readonly = input<boolean>(false);

  /** Emits the full content string on every change. */
  contentChange = output<string>();

  @ViewChild('editorContainer', { static: true })
  private containerRef!: ElementRef<HTMLDivElement>;

  private editor: any = null;
  /** Signal to let effects know the editor is ready */
  private editorReady = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private zone = inject(NgZone);

  /** Suppress external content sync while user is typing */
  private suppressExternalSync = false;

  private static monacoInstance: any = null;
  private static monacoPromise: Promise<any> | null = null;
  private static themeRegistered = false;

  constructor() {
    // React to content input changes (external updates)
    // Also re-runs when editorReady flips to true
    effect(() => {
      const newContent = this.content();
      const ready = this.editorReady();
      if (this.editor && ready && !this.suppressExternalSync) {
        const currentValue = this.editor.getValue();
        if (currentValue !== newContent) {
          this.editor.setValue(newContent);
        }
      }
    });

    // React to language changes
    effect(() => {
      const lang = this.language();
      const ready = this.editorReady();
      if (this.editor && ready && MonacoEditorComponent.monacoInstance) {
        const model = this.editor.getModel();
        if (model) {
          MonacoEditorComponent.monacoInstance.editor.setModelLanguage(model, lang);
        }
      }
    });

    // React to readonly changes
    effect(() => {
      const ro = this.readonly();
      const ready = this.editorReady();
      if (this.editor && ready) {
        this.editor.updateOptions({ readOnly: ro });
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const monaco = await this.loadMonaco();
    this.zone.runOutsideAngular(() => {
      this.createEditor(monaco);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.editor?.dispose();
    this.editor = null;
  }

  private async loadMonaco(): Promise<any> {
    if (MonacoEditorComponent.monacoInstance) {
      return MonacoEditorComponent.monacoInstance;
    }

    if (MonacoEditorComponent.monacoPromise) {
      return MonacoEditorComponent.monacoPromise;
    }

    MonacoEditorComponent.monacoPromise = (async () => {
      const loaderModule = await import('@monaco-editor/loader');
      const loader = loaderModule.default;
      loader.config({ paths: { vs: '/vs' } });
      const monaco = await loader.init();
      MonacoEditorComponent.monacoInstance = monaco;
      return monaco;
    })();

    return MonacoEditorComponent.monacoPromise;
  }

  private createEditor(monaco: any): void {
    if (!MonacoEditorComponent.themeRegistered) {
      monaco.editor.defineTheme('containerus-dark', CONTAINERUS_THEME);
      MonacoEditorComponent.themeRegistered = true;
    }

    this.editor = monaco.editor.create(this.containerRef.nativeElement, {
      value: this.content(),
      language: this.language(),
      theme: 'containerus-dark',
      readOnly: this.readonly(),
      automaticLayout: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      tabSize: 2,
      wordWrap: 'on',
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
    });

    // Content change listener
    this.editor.onDidChangeModelContent(() => {
      this.suppressExternalSync = true;
      this.zone.run(() => {
        this.contentChange.emit(this.editor.getValue());
      });
      // Allow external sync again after a microtask
      queueMicrotask(() => {
        this.suppressExternalSync = false;
      });
    });

    // ResizeObserver for layout
    this.resizeObserver = new ResizeObserver(() => {
      this.editor?.layout();
    });
    this.resizeObserver.observe(this.containerRef.nativeElement);

    // Signal that the editor is ready — this re-triggers the content/language/readonly effects
    this.zone.run(() => this.editorReady.set(true));
  }
}
