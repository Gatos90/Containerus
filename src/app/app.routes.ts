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
];
