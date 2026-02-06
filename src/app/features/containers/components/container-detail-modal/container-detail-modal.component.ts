import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  X,
  Terminal,
  FileText,
  FolderOpen,
} from 'lucide-angular';
import {
  Container,
  getDisplayName,
  getStatusText,
  isRunning,
} from '../../../../core/models/container.model';
import { ContainerDetailsComponent } from '../container-details/container-details.component';

@Component({
  selector: 'app-container-detail-modal',
  imports: [LucideAngularModule, RouterLink, ContainerDetailsComponent],
  templateUrl: './container-detail-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerDetailModalComponent {
  container = input.required<Container>();

  close = output<void>();
  viewLogs = output<void>();

  readonly X = X;
  readonly Terminal = Terminal;
  readonly FileText = FileText;
  readonly FolderOpen = FolderOpen;

  readonly getDisplayName = getDisplayName;
  readonly getStatusText = getStatusText;
  readonly isRunning = isRunning;

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }
}
