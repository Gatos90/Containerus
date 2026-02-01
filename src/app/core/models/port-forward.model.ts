export type PortForwardStatus = 'active' | 'stopped' | 'error';

export interface PortForward {
  id: string;
  systemId: string;
  containerId: string;
  containerPort: number;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  protocol: string;
  status: PortForwardStatus;
  createdAt: string;
}

export interface CreatePortForwardRequest {
  systemId: string;
  containerId: string;
  /** Container port (for tracking/display purposes) */
  containerPort: number;
  /** Host port on remote machine (the port Docker listens on - used for SSH tunnel) */
  hostPort: number;
  localPort?: number;
  protocol?: string;
  remoteHost?: string;
}
