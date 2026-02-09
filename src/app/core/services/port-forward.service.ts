import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  CreatePortForwardRequest,
  PortForward,
} from '../models/port-forward.model';
import { BackendService } from './backend.service';

@Injectable({ providedIn: 'root' })
export class PortForwardService {
  constructor(private backend: BackendService) {}

  async createForward(request: CreatePortForwardRequest): Promise<PortForward> {
    // For backend systems, inject WebSocket tunnel URL + token
    const connId = this.backend.getBackendForSystem(request.systemId);
    if (connId) {
      const tunnel = this.backend.getTunnelWsUrl(connId, request.systemId);
      if (tunnel) {
        request = {
          ...request,
          tunnelWsUrl: tunnel.url,
          tunnelToken: tunnel.token,
        };
      }
    }
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
