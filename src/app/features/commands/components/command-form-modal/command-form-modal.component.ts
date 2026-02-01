import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  X,
  Plus,
  Trash2,
  Variable,
} from 'lucide-angular';
import {
  CommandTemplate,
  CommandCategory,
  TemplateVariable,
  CreateCommandTemplateRequest,
  UpdateCommandTemplateRequest,
  parseVariables,
  getCategoryLabel,
} from '../../../../core/models/command-template.model';
import { ContainerRuntime } from '../../../../core/models/container.model';
import { CommandTemplateState } from '../../../../state/command-template.state';

interface FormData {
  name: string;
  description: string;
  command: string;
  category: CommandCategory;
  tags: string;
  runtimes: { docker: boolean; podman: boolean; apple: boolean };
  isFavorite: boolean;
  variables: TemplateVariable[];
}

@Component({
  selector: 'app-command-form-modal',
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './command-form-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandFormModalComponent implements OnInit {
  readonly template = input<CommandTemplate | null>(null);

  readonly save = output<void>();
  readonly cancel = output<void>();

  readonly commandState = inject(CommandTemplateState);

  // Icons
  readonly X = X;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly Variable = Variable;

  readonly getCategoryLabel = getCategoryLabel;

  readonly detectedVariables = signal<string[]>([]);

  form: FormData = {
    name: '',
    description: '',
    command: '',
    category: 'custom',
    tags: '',
    runtimes: { docker: false, podman: false, apple: false },
    isFavorite: false,
    variables: [],
  };

  isEditing(): boolean {
    return this.template() !== null;
  }

  ngOnInit(): void {
    const t = this.template();
    if (t) {
      this.form = {
        name: t.name,
        description: t.description,
        command: t.command,
        category: t.category,
        tags: t.tags.join(', '),
        runtimes: {
          docker: t.compatibility.runtimes.includes('docker'),
          podman: t.compatibility.runtimes.includes('podman'),
          apple: t.compatibility.runtimes.includes('apple'),
        },
        isFavorite: t.isFavorite,
        variables: [...t.variables],
      };
      this.detectVariables();
    }
  }

  detectVariables(): void {
    const vars = parseVariables(this.form.command);
    this.detectedVariables.set(vars);

    // Sync variables array
    const newVariables: TemplateVariable[] = vars.map((name) => {
      const existing = this.form.variables.find((v) => v.name === name);
      return existing ?? {
        name,
        description: '',
        defaultValue: '',
        required: true,
      };
    });
    this.form.variables = newVariables;
  }

  isValid(): boolean {
    return (
      this.form.name.trim().length > 0 &&
      this.form.description.trim().length > 0 &&
      this.form.command.trim().length > 0
    );
  }

  async onSave(): Promise<void> {
    if (!this.isValid()) return;

    const runtimes: ContainerRuntime[] = [];
    if (this.form.runtimes.docker) runtimes.push('docker');
    if (this.form.runtimes.podman) runtimes.push('podman');
    if (this.form.runtimes.apple) runtimes.push('apple');

    const tags = this.form.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const t = this.template();
    if (t) {
      // Update existing
      const request: UpdateCommandTemplateRequest = {
        id: t.id,
        name: this.form.name.trim(),
        description: this.form.description.trim(),
        command: this.form.command.trim(),
        category: this.form.category,
        tags,
        variables: this.form.variables,
        compatibility: { runtimes },
        isFavorite: this.form.isFavorite,
      };
      await this.commandState.updateTemplate(request);
    } else {
      // Create new
      const request: CreateCommandTemplateRequest = {
        name: this.form.name.trim(),
        description: this.form.description.trim(),
        command: this.form.command.trim(),
        category: this.form.category,
        tags,
        variables: this.form.variables,
        compatibility: { runtimes },
        isFavorite: this.form.isFavorite,
      };
      await this.commandState.createTemplate(request);
    }

    this.save.emit();
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
