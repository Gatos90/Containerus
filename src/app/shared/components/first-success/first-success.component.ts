import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X, Check, Rocket, ArrowRight } from 'lucide-angular';
import { RouterModule } from '@angular/router';

export interface NextStep {
  label: string;
  description: string;
  route: string;
}

@Component({
  selector: 'app-first-success',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterModule],
  templateUrl: './first-success.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onDismiss()',
  },
})
export class FirstSuccessComponent implements OnInit {
  readonly systemName = input.required<string>();
  readonly dismiss = output<void>();

  readonly X = X;
  readonly Check = Check;
  readonly Rocket = Rocket;
  readonly ArrowRight = ArrowRight;

  readonly animateBadge = signal(false);

  readonly nextSteps: NextStep[] = [
    {
      label: 'Containers',
      description: 'Browse and manage running containers',
      route: '/containers',
    },
    {
      label: 'Images',
      description: 'Inspect and pull container images',
      route: '/images',
    },
    {
      label: 'Terminal',
      description: 'Open an AI-assisted terminal session',
      route: '/terminal',
    },
  ];

  ngOnInit(): void {
    // Trigger badge animation after a short delay so the CSS transition fires
    setTimeout(() => this.animateBadge.set(true), 50);
  }

  onDismiss(): void {
    this.dismiss.emit();
  }

  onNavigate(): void {
    this.dismiss.emit();
  }
}
