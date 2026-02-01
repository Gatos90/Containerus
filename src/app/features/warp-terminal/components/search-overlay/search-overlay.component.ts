import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X, Search } from 'lucide-angular';
import type { SearchResult } from '../../models/terminal-block.model';

@Component({
  selector: 'app-search-overlay',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './search-overlay.component.html',
  styleUrl: './search-overlay.component.css',
})
export class SearchOverlayComponent {
  @Input() open = false;
  @Input() query = '';
  @Input() results: SearchResult[] = [];

  @Output() queryChange = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();
  @Output() selectResult = new EventEmitter<SearchResult>();

  readonly X = X;
  readonly Search = Search;

  updateQuery(value: string): void {
    this.queryChange.emit(value);
  }
}
