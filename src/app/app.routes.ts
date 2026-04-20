import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/containers', pathMatch: 'full' },
  {
    path: 'containers',
    loadComponent: () =>
      import('./features/containers/container-list/container-list.component').then(
        (m) => m.ContainerListComponent
      ),
  },
  {
    path: 'images',
    loadComponent: () =>
      import('./features/images/image-list/image-list.component').then(
        (m) => m.ImageListComponent
      ),
  },
  {
    path: 'volumes',
    loadComponent: () =>
      import('./features/volumes/volume-list/volume-list.component').then(
        (m) => m.VolumeListComponent
      ),
  },
  {
    path: 'networks',
    loadComponent: () =>
      import('./features/networks/network-list/network-list.component').then(
        (m) => m.NetworkListComponent
      ),
  },
  {
    path: 'systems',
    loadComponent: () =>
      import('./features/systems/system-list/system-list.component').then(
        (m) => m.SystemListComponent
      ),
  },
  {
    path: 'commands',
    loadComponent: () =>
      import('./features/commands/command-list/command-list.component').then(
        (m) => m.CommandListComponent
      ),
  },
  {
    path: 'files',
    loadComponent: () =>
      import('./features/file-browser/file-browser-view/file-browser-view.component').then(
        (m) => m.FileBrowserViewComponent
      ),
  },
  {
    path: 'files/:systemId',
    loadComponent: () =>
      import('./features/file-browser/file-browser-view/file-browser-view.component').then(
        (m) => m.FileBrowserViewComponent
      ),
  },
  {
    path: 'files/:systemId/:containerId',
    loadComponent: () =>
      import('./features/file-browser/file-browser-view/file-browser-view.component').then(
        (m) => m.FileBrowserViewComponent
      ),
  },
  {
    path: 'terminal',
    loadComponent: () =>
      import('./features/terminal/terminal-view/terminal-view.component').then(
        (m) => m.TerminalViewComponent
      ),
  },
  {
    path: 'warp-terminal',
    loadComponent: () =>
      import('./features/warp-terminal/warp-terminal-view/warp-terminal-view.component').then(
        (m) => m.WarpTerminalViewComponent
      ),
  },
  {
    path: 'terminal/:systemId',
    loadComponent: () =>
      import('./features/terminal/terminal-view/terminal-view.component').then(
        (m) => m.TerminalViewComponent
      ),
  },
  {
    path: 'terminal/:systemId/:containerId',
    loadComponent: () =>
      import('./features/terminal/terminal-view/terminal-view.component').then(
        (m) => m.TerminalViewComponent
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/pages/settings-page/settings-page.component').then(
        (m) => m.SettingsPageComponent
      ),
  },
  {
    path: 'compose',
    loadComponent: () =>
      import('./features/compose-projects/compose-list/compose-list.component').then(
        (m) => m.ComposeListComponent
      ),
  },
  // Backend routes
  {
    path: 'backends',
    loadComponent: () =>
      import('./features/backend/backend-view/backend-view.component').then(
        (m) => m.BackendViewComponent
      ),
  },
  {
    path: 'backends/:connectionId',
    loadComponent: () =>
      import('./features/backend/project-list/project-list.component').then(
        (m) => m.ProjectListComponent
      ),
  },
  {
    path: 'backends/:connectionId/projects/:projectId',
    loadComponent: () =>
      import('./features/backend/project-detail/project-detail.component').then(
        (m) => m.ProjectDetailComponent
      ),
  },
  {
    path: 'backends/:connectionId/projects/:projectId/environments/:envId',
    loadComponent: () =>
      import('./features/backend/environment-detail/environment-detail.component').then(
        (m) => m.EnvironmentDetailComponent
      ),
  },
  {
    path: 'backend-connect',
    loadComponent: () =>
      import('./features/backend/connect/backend-connect.component').then(
        (m) => m.BackendConnectComponent
      ),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/backend/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: 'k8s',
    loadComponent: () =>
      import('./features/backend/k8s-dashboard/k8s-dashboard.component').then(
        (m) => m.K8sDashboardComponent
      ),
  },
  {
    path: 'k8s/overview',
    loadComponent: () =>
      import('./features/backend/k8s-overview/k8s-overview-page.component').then(
        (m) => m.K8sOverviewPageComponent
      ),
  },
  {
    path: 'audit-log',
    loadComponent: () =>
      import('./features/backend/audit-log/audit-log.component').then(
        (m) => m.AuditLogComponent
      ),
  },
  {
    path: 'audit/project',
    loadComponent: () =>
      import('./features/backend/project-audit/project-audit.component').then(
        (m) => m.ProjectAuditComponent
      ),
  },
  {
    path: 'admin/roles',
    loadComponent: () =>
      import('./features/backend/role-manager/role-manager.component').then(
        (m) => m.RoleManagerComponent
      ),
  },
  {
    path: 'access/people',
    loadComponent: () =>
      import('./features/backend/people/people.component').then(
        (m) => m.PeopleComponent
      ),
  },
  {
    path: 'access/resources',
    loadComponent: () =>
      import('./features/backend/resource-access/resource-access.component').then(
        (m) => m.ResourceAccessComponent
      ),
  },
  {
    path: 'a11y-devshell',
    loadComponent: () =>
      import('./shared/components/a11y/devshell/a11y-devshell.component').then(
        (m) => m.A11yDevshellComponent
      ),
  },
];
