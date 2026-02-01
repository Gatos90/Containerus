import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  CreatePortForwardRequest,
  PortForward,
} from '../models/port-forward.model';

@Injectable({ providedIn: 'root' })
export class PortForwardService {
  async createForward(request: CreatePortForwardRequest): Promise<PortForward> {
    return invoke<PortForward>('create_port_forward', { request });
  }

  async stopForward(forwardId: string): Promise<void> {
    return invoke('stop_port_forward', { forwardId });
  }

  async listForwards(
    systemId?: string,
    containerId?: string
  ): Promise<PortForward[]> {
    return invoke<PortForward[]>('list_port_forwards', {
      systemId,
      containerId,
    });
  }

  async getForward(forwardId: string): Promise<PortForward | null> {
    return invoke<PortForward | null>('get_port_forward', { forwardId });
  }

  async openInBrowser(forwardId: string): Promise<void> {
    return invoke('open_forwarded_port', { forwardId });
  }

  async isPortForwarded(
    containerId: string,
    containerPort: number
  ): Promise<boolean> {
    return invoke<boolean>('is_port_forwarded', { containerId, containerPort });
  }
}
