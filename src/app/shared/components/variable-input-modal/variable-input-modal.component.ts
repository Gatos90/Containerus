import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  X,
  Play,
  Variable,
} from 'lucide-angular';
import {
  CommandTemplate,
  TemplateVariable,
  parseVariables,
  substituteVariables,
  getRuntimePrefix,
  VARIABLE_SUGGESTIONS,
} from '../../../core/models/command-template.model';
import { ContainerRuntime } from '../../../core/models/container.model';
import { ContainerState } from '../../../state/container.state';
import { ImageState } from '../../../state/image.state';
import { VolumeState } from '../../../state/volume.state';
import { NetworkState } from '../../../state/network.state';
import { SystemState } from '../../../state/system.state';

interface VariableInput {
  name: string;
  description: string;
  value: string;
  required: boolean;
  suggestions: string[];
}

@Component({
  selector: 'app-variable-input-modal',
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './variable-input-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onCancel()',
  },
})
export class VariableInputModalComponent implements OnInit {
  // Inputs
  readonly template = input.required<CommandTemplate>();
  readonly command = input.required<string>();
  readonly systemId = input<string | null>(null);

  // Outputs
  readonly execute = output<string>();
  readonly cancel = output<void>();

  @ViewChild('firstInput') firstInput!: ElementRef<HTMLInputElement>;

  // Injected state for suggestions
  readonly containerState = inject(ContainerState);
  readonly imageState = inject(ImageState);
  readonly volumeState = inject(VolumeState);
  readonly networkState = inject(NetworkState);
  readonly systemState = inject(SystemState);

  // Icons
  readonly X = X;
  readonly Play = Play;
  readonly Variable = Variable;

  readonly variables = signal<VariableInput[]>([]);

  // Computed preview of the command with substituted values
  readonly previewCommand = computed(() => {
    const values: Record<string, string> = {};
    for (const v of this.variables()) {
      if (v.value) {
        values[v.name] = v.value;
      }
    }
    return substituteVariables(this.command(), values);
  });

  readonly isValid = computed(() => {
    return this.variables().every((v) => !v.required || v.value.trim().length > 0);
  });

  ngOnInit(): void {
    this.initializeVariables();

    // Focus first input
    setTimeout(() => {
      this.firstInput?.nativeElement?.focus();
    }, 100);
  }

  private initializeVariables(): void {
    const varNames = parseVariables(this.command());
    const templateVars = this.template().variables;

    const inputs: VariableInput[] = varNames.map((name) => {
      const templateVar = templateVars.find((v) => v.name === name);
      // Auto-fill RUNTIME from connected system
      const defaultValue = name === 'RUNTIME'
        ? this.getDefaultRuntime()
        : (templateVar?.defaultValue ?? '');

      return {
        name,
        description: templateVar?.description ?? VARIABLE_SUGGESTIONS[name] ?? '',
        value: defaultValue,
        required: templateVar?.required ?? true,
        suggestions: this.getSuggestionsForVariable(name),
      };
    });

    this.variables.set(inputs);
  }

  /**
   * Get the current system based on systemId input or fallback to first connected
   */
  private getCurrentSystem() {
    const id = this.systemId();
    if (id) {
      return this.systemState.systems().find((s) => s.id === id) ?? null;
    }
    const connected = this.systemState.connectedSystems();
    return connected.length > 0 ? connected[0] : null;
  }

  /**
   * Get the default runtime from the current system
   */
  private getDefaultRuntime(): string {
    const system = this.getCurrentSystem();
    if (system) {
      return getRuntimePrefix(system.primaryRuntime);
    }
    // Default to docker if no system is available
    return 'docker';
  }

  private getSuggestionsForVariable(name: string): string[] {
    switch (name) {
      case 'CONTAINER_NAME':
      case 'CONTAINER_ID':
        return this.containerState.containers().map((c) => c.name || c.id.slice(0, 12));
      case 'IMAGE_NAME':
        return this.imageState.images().map((i) => `${i.repository}:${i.tag}`);
      case 'VOLUME_NAME':
        return this.volumeState.volumes().map((v) => v.name);
      case 'NETWORK_NAME':
        return this.networkState.networks().map((n) => n.name);
      case 'SYSTEM_ID':
        return this.systemState.connectedSystems().map((s) => s.id);
      case 'RUNTIME':
        // Suggest available runtimes from connected systems
        return this.getAvailableRuntimes();
      default:
        return [];
    }
  }

  /**
   * Get available runtimes from the current system
   */
  private getAvailableRuntimes(): string[] {
    const system = this.getCurrentSystem();
    if (system && system.availableRuntimes.length > 0) {
      return system.availableRuntimes.map((r) => getRuntimePrefix(r));
    }
    // If no system available, show default options
    return ['docker', 'podman'];
  }

  updateValue(index: number, value: string): void {
    this.variables.update((vars) => {
      const updated = [...vars];
      updated[index] = { ...updated[index], value };
      return updated;
    });
  }

  onExecute(): void {
    if (!this.isValid()) return;
    this.execute.emit(this.previewCommand());
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.onExecute();
    }
  }
}
