import { Component, inject, signal, effect, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X, Save, FileText, AlertTriangle } from 'lucide-angular';
import { FileBrowserState } from '../../../../state/file-browser.state';

@Component({
  selector: 'app-file-editor-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './file-editor-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileEditorModalComponent {
  readonly state = inject(FileBrowserState);
  readonly close = output<void>();

  readonly X = X;
  readonly Save = Save;
  readonly FileText = FileText;
  readonly AlertTriangle = AlertTriangle;

  editableContent = signal('');

  constructor() {
    effect(() => {
      const content = this.state.editorContent();
      if (content) {
        this.editableContent.set(content.content);
      }
    });
  }

  onContentChange(value: string): void {
    this.editableContent.set(value);
    const original = this.state.editorContent()?.content ?? '';
    this.state.setEditorDirty(value !== original);
  }

  async save(): Promise<void> {
    await this.state.saveFile(this.editableContent());
  }

  closeEditor(): void {
    this.state.closeEditor();
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeEditor();
    }
  }

  getFileName(): string {
    const path = this.state.editorContent()?.path ?? '';
    return path.split('/').pop() ?? path;
  }
}
