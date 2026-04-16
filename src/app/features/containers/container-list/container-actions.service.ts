import { Injectable, inject } from '@angular/core';
import { Container, ContainerAction, getDisplayName } from '../../../core/models/container.model';
import { ContainerState } from '../../../state/container.state';
import { ToastState } from '../../../state/toast.state';

/**
 * Handles container action execution with confirmation flow.
 * Used by ContainerListComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class ContainerActionsService {
  private readonly containerState = inject(ContainerState);
  private readonly toast = inject(ToastState);

  isDestructiveAction(action: ContainerAction): boolean {
    return ['stop', 'remove'].includes(action);
  }

  async executeAction(container: Container, action: ContainerAction): Promise<void> {
    const name = getDisplayName(container);
    const success = await this.containerState.performAction(container, action);
    if (success) {
      this.toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)}${action.endsWith('e') ? 'd' : 'ed'} ${name}`);
    } else {
      this.toast.error(`Failed to ${action} ${name}`);
    }
  }
}
