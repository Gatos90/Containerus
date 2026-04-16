import { Injectable } from '@angular/core';
import {
  AuthTokens,
  LoginRequest,
  RegisterRequest,
  UserProfile,
} from '../models/backend.model';
import { BackendService } from './backend.service';

/**
 * Handles per-connection authentication: login, register, logout, and token refresh.
 * Delegates connection-state mutations to BackendService.
 */
@Injectable({ providedIn: 'root' })
export class BackendAuthService {
  constructor(private backend: BackendService) {}

  async loginToBackend(connectionId: string, req: LoginRequest): Promise<void> {
    this.backend._userLoggedOut.delete(connectionId);
    this.backend.updateConnection(connectionId, { status: 'connecting' });
    try {
      const data = await this.backend.requestFor<AuthTokens & { user: UserProfile }>(
        connectionId, 'POST', '/api/auth/login', req
      );
      this.backend.updateConnection(connectionId, {
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
        user: data.user,
        status: 'connected',
      });
      this.backend.persistConnections();
      await this.backend.loadProjectsFor(connectionId);
    } catch (e) {
      this.backend.updateConnection(connectionId, { status: 'error' });
      throw e;
    }
  }

  async registerOnBackend(connectionId: string, req: RegisterRequest): Promise<void> {
    this.backend._userLoggedOut.delete(connectionId);
    this.backend.updateConnection(connectionId, { status: 'connecting' });
    try {
      const data = await this.backend.requestFor<AuthTokens & { user: UserProfile }>(
        connectionId, 'POST', '/api/auth/register', req
      );
      this.backend.updateConnection(connectionId, {
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
        user: data.user,
        status: 'connected',
      });
      this.backend.persistConnections();
      await this.backend.loadProjectsFor(connectionId);
    } catch (e) {
      this.backend.updateConnection(connectionId, { status: 'error' });
      throw e;
    }
  }

  logoutFrom(connectionId: string): void {
    this.backend._userLoggedOut.add(connectionId);
    for (const [sysId, connId] of this.backend._systemOwnership) {
      if (connId === connectionId) this.backend._systemOwnership.delete(sysId);
    }
    this.backend.updateConnection(connectionId, {
      tokens: null,
      user: null,
      projects: [],
      projectPermissions: {},
      status: 'disconnected',
    });
    this.backend.persistConnections();
  }

  async refreshTokenFor(connectionId: string): Promise<void> {
    return this.backend.refreshTokenFor(connectionId);
  }
}
