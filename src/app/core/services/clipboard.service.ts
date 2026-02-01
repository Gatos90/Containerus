import { Injectable } from '@angular/core';
import { PortMapping } from '../models/container.model';

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      console.error('Failed to copy to clipboard');
      return false;
    }
  }

  async copyMultiple(items: { label: string; value: string }[]): Promise<boolean> {
    const text = items.map((i) => `${i.label}: ${i.value}`).join('\n');
    return this.copy(text);
  }

  async copyEnvVars(envVars: Record<string, string>): Promise<boolean> {
    const text = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    return this.copy(text);
  }

  async copyPorts(ports: PortMapping[]): Promise<boolean> {
    const text = ports
      .map((p) => `${p.hostPort}:${p.containerPort}/${p.protocol}`)
      .join('\n');
    return this.copy(text);
  }

  async copyValue(value: string | number): Promise<boolean> {
    return this.copy(String(value));
  }
}
