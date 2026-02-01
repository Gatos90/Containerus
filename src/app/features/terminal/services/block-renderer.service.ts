import {
  Injectable,
  ApplicationRef,
  EnvironmentInjector,
  createComponent,
  ComponentRef,
  Type,
  inject,
} from '@angular/core';

/**
 * Service for dynamically mounting Angular components into DOM containers.
 *
 * Used by the BlockInjectorAddon to render Angular components inside
 * xterm decoration containers.
 */
@Injectable({ providedIn: 'root' })
export class BlockRendererService {
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);

  /** Registry of mounted components by block ID */
  private components = new Map<string, ComponentRef<unknown>>();

  /**
   * Mount an Angular component into a container element.
   *
   * @param id Unique identifier for this component instance
   * @param component The component class to instantiate
   * @param container The DOM element to render into
   * @param inputs Initial input values for the component
   * @returns The created ComponentRef
   */
  mountComponent<T>(
    id: string,
    component: Type<T>,
    container: HTMLElement,
    inputs: Record<string, unknown> = {}
  ): ComponentRef<T> {
    // Clean up any existing component with this ID
    if (this.components.has(id)) {
      this.destroyComponent(id);
    }

    // Create the component
    const componentRef = createComponent(component, {
      environmentInjector: this.injector,
      hostElement: container,
    });

    // Set input values
    for (const [key, value] of Object.entries(inputs)) {
      componentRef.setInput(key, value);
    }

    // Attach to application for change detection
    this.appRef.attachView(componentRef.hostView);

    // Store reference
    this.components.set(id, componentRef as ComponentRef<unknown>);

    return componentRef;
  }

  /**
   * Update inputs on an existing component.
   *
   * @param id The component's unique identifier
   * @param inputs New input values to set
   */
  updateInputs(id: string, inputs: Record<string, unknown>): void {
    const componentRef = this.components.get(id);
    if (!componentRef) {
      console.warn(`BlockRendererService: Component ${id} not found`);
      return;
    }

    for (const [key, value] of Object.entries(inputs)) {
      componentRef.setInput(key, value);
    }
  }

  /**
   * Destroy a mounted component and clean up.
   *
   * @param id The component's unique identifier
   */
  destroyComponent(id: string): void {
    const componentRef = this.components.get(id);
    if (!componentRef) {
      return;
    }

    // Detach from application
    this.appRef.detachView(componentRef.hostView);

    // Destroy the component
    componentRef.destroy();

    // Remove from registry
    this.components.delete(id);
  }

  /**
   * Check if a component with the given ID exists.
   *
   * @param id The component's unique identifier
   */
  hasComponent(id: string): boolean {
    return this.components.has(id);
  }

  /**
   * Get a component reference by ID.
   *
   * @param id The component's unique identifier
   */
  getComponent<T>(id: string): ComponentRef<T> | null {
    return (this.components.get(id) as ComponentRef<T>) ?? null;
  }

  /**
   * Destroy all mounted components.
   */
  destroyAll(): void {
    for (const [id] of this.components) {
      this.destroyComponent(id);
    }
  }

  /**
   * Get the count of mounted components.
   */
  get componentCount(): number {
    return this.components.size;
  }
}
