import { Component, Input, Output, EventEmitter, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, Plus, Trash2, Loader2, ChevronDown, ChevronRight, X, Code, FileText } from 'lucide-angular';
import { BackendService } from '../../../../core/services/backend.service';
import { K8sNamespace, K8sApiResource } from '../../../../core/models/backend.model';
import { MonacoEditorComponent } from '../../../../shared/components/monaco-editor/monaco-editor.component';
import {
  FormModel, ContainerModel, KeyValuePair, ServicePortModel, IngressRuleModel,
  FormSectionDef, FormFieldDef, ResourceFormDef,
  createDefaultFormModel, createDefaultContainer, hasFormDef, getFormDef,
} from './k8s-resource-form-defs';
import { formToYaml } from './k8s-form-to-yaml';
import { yamlToForm } from './k8s-yaml-to-form';
import { getResourceTemplate } from '../k8s-resource-templates';
import { AppModalDirective } from '../../../../shared/directives/app-modal.directive';

@Component({
  selector: 'app-k8s-create-resource-modal',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, LucideAngularModule, MonacoEditorComponent, AppModalDirective],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 cx-modal-backdrop"
      (click)="close.emit()"
    >
      <!-- Modal -->
      <div
        class="bg-zinc-900 rounded-xl border border-zinc-800 w-full max-w-2xl max-h-[85vh] flex flex-col cx-modal-panel"
        appModal
        aria-labelledby="k8s-create-resource-title"
        (modalClose)="close.emit()"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <h3 id="k8s-create-resource-title" class="text-lg font-medium text-zinc-100">Create {{ resourceLabel() }}</h3>
          <div class="flex items-center gap-2">
            @if (hasForm()) {
              <div class="flex bg-zinc-800 rounded-lg p-0.5">
                <button
                  (click)="switchToForm()"
                  class="px-3 py-1 text-xs rounded-md transition-colors flex items-center gap-1"
                  [class]="mode() === 'form' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-300'"
                >
                  <lucide-icon [img]="FileTextIcon" [size]="12" />
                  Form
                </button>
                <button
                  (click)="switchToYaml()"
                  class="px-3 py-1 text-xs rounded-md transition-colors flex items-center gap-1"
                  [class]="mode() === 'yaml' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-300'"
                >
                  <lucide-icon [img]="CodeIcon" [size]="12" />
                  YAML
                </button>
              </div>
            }
            <button (click)="close.emit()" class="text-zinc-400 hover:text-zinc-300 p-1">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          @if (mode() === 'form' && hasForm()) {
            <!-- Namespace dropdown -->
            <div>
              <label class="block text-xs text-zinc-400 mb-1">Namespace</label>
              <select
                [ngModel]="selectedNamespace"
                (ngModelChange)="selectedNamespace = $event"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                @for (ns of namespaces; track ns.name) {
                  <option [value]="ns.name">{{ ns.name }}</option>
                }
              </select>
            </div>

            <!-- Basic sections -->
            @for (section of basicSections(); track section.id) {
              <fieldset class="space-y-3">
                <legend class="text-sm font-medium text-zinc-300">{{ section.title }}</legend>
                @for (field of section.fields; track field.key) {
                  <ng-container *ngTemplateOutlet="fieldTpl; context: { $implicit: field }" />
                }
              </fieldset>
            }

            <!-- Show Advanced toggle -->
            @if (advancedSections().length > 0) {
              <button
                (click)="showAdvanced.set(!showAdvanced())"
                class="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                <lucide-icon [img]="showAdvanced() ? ChevronDownIcon : ChevronRightIcon" [size]="14" />
                {{ showAdvanced() ? 'Hide' : 'Show' }} Advanced Options
              </button>
              @if (showAdvanced()) {
                <div class="space-y-4 bg-zinc-800/30 rounded-lg p-4 border border-zinc-800/50">
                  @for (section of advancedSections(); track section.id) {
                    <fieldset class="space-y-3">
                      <legend class="text-sm font-medium text-zinc-300">{{ section.title }}</legend>
                      @for (field of section.fields; track field.key) {
                        <ng-container *ngTemplateOutlet="fieldTpl; context: { $implicit: field }" />
                      }
                    </fieldset>
                  }
                </div>
              }
            }
          } @else {
            <!-- YAML editor mode -->
            @if (yamlParseWarning()) {
              <div class="text-yellow-400 text-xs bg-yellow-950/30 rounded-lg px-3 py-2">
                {{ yamlParseWarning() }}
              </div>
            }
            <div class="h-[400px] rounded-lg border border-zinc-700 overflow-hidden">
              <app-monaco-editor
                [content]="yamlContent"
                language="yaml"
                (contentChange)="yamlContent = $event"
                class="h-full"
              />
            </div>
          }
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-zinc-800 shrink-0 flex items-center gap-3 justify-end">
          @if (error()) {
            <span class="text-red-400 text-sm flex-1">{{ error() }}</span>
          }
          @if (success()) {
            <span class="text-green-400 text-sm flex-1">Resource created successfully</span>
          }
          <button (click)="close.emit()" class="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-sm">
            Cancel
          </button>
          <button
            (click)="apply()"
            [disabled]="creating() || !isValid()"
            class="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-lg px-4 py-2 flex items-center gap-1.5 transition-colors"
          >
            @if (creating()) {
              <lucide-icon [img]="Loader2Icon" [size]="14" class="animate-spin" />
            }
            Create
          </button>
        </div>
      </div>
    </div>

    <!-- Field template -->
    <ng-template #fieldTpl let-field>
      @switch (field.type) {
        @case ('text') {
          <div>
            <label class="block text-xs text-zinc-400 mb-1">
              {{ field.label }}
              @if (field.required) { <span class="text-red-400">*</span> }
            </label>
            <input
              type="text"
              [ngModel]="getFieldValue(field.key)"
              (ngModelChange)="setFieldValue(field.key, $event)"
              [placeholder]="field.placeholder ?? ''"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            @if (field.helpText) {
              <p class="text-[11px] text-zinc-500 mt-0.5">{{ field.helpText }}</p>
            }
          </div>
        }
        @case ('number') {
          <div>
            <label class="block text-xs text-zinc-400 mb-1">{{ field.label }}</label>
            <input
              type="number"
              [ngModel]="getFieldValue(field.key)"
              (ngModelChange)="setFieldValue(field.key, +$event)"
              [min]="field.validation?.min"
              [max]="field.validation?.max"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        }
        @case ('select') {
          <div>
            <label class="block text-xs text-zinc-400 mb-1">{{ field.label }}</label>
            <select
              [ngModel]="getFieldValue(field.key)"
              (ngModelChange)="setFieldValue(field.key, $event)"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              @for (opt of field.options; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </div>
        }
        @case ('key-value') {
          <div class="space-y-1.5">
            <label class="block text-xs text-zinc-400">
              {{ field.label }}
              @if (field.required) { <span class="text-red-400">*</span> }
            </label>
            @if (field.helpText) {
              <p class="text-[11px] text-zinc-500">{{ field.helpText }}</p>
            }
            @for (pair of getKvPairs(field.key); track $index; let i = $index) {
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  [(ngModel)]="pair.key"
                  (ngModelChange)="touchForm()"
                  placeholder="Key"
                  class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  [(ngModel)]="pair.value"
                  (ngModelChange)="touchForm()"
                  placeholder="Value"
                  class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button (click)="removeKvPair(field.key, i)" class="text-zinc-500 hover:text-red-400 p-1 transition-colors">
                  <lucide-icon [img]="Trash2Icon" [size]="13" />
                </button>
              </div>
            }
            <button
              (click)="addKvPair(field.key)"
              class="text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              <lucide-icon [img]="PlusIcon" [size]="12" /> Add entry
            </button>
          </div>
        }
        @case ('container-list') {
          <div class="space-y-3">
            @for (container of formModel().containers; track $index; let i = $index) {
              <div class="bg-zinc-800/50 rounded-lg border border-zinc-700 p-3 space-y-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-zinc-300 font-medium">Container {{ i + 1 }}</span>
                  @if (formModel().containers.length > 1) {
                    <button (click)="removeContainer(i)" class="text-zinc-500 hover:text-red-400 p-1 transition-colors">
                      <lucide-icon [img]="Trash2Icon" [size]="13" />
                    </button>
                  }
                </div>
                <!-- Name -->
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-0.5">Name</label>
                  <input
                    type="text"
                    [(ngModel)]="container.name"
                    (ngModelChange)="touchForm()"
                    placeholder="main"
                    class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <!-- Image -->
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-0.5">
                    Image <span class="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    [(ngModel)]="container.image"
                    (ngModelChange)="touchForm()"
                    placeholder="nginx:latest"
                    class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <!-- Command -->
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-0.5">Command (optional)</label>
                  <input
                    type="text"
                    [(ngModel)]="container.command"
                    (ngModelChange)="touchForm()"
                    placeholder="e.g. echo Hello"
                    class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <!-- Ports -->
                <div class="space-y-1">
                  <span class="text-[11px] text-zinc-500">Ports</span>
                  @for (port of container.ports; track $index; let j = $index) {
                    <div class="flex items-center gap-2">
                      <input
                        type="number"
                        [(ngModel)]="port.containerPort"
                        (ngModelChange)="touchForm()"
                        placeholder="80"
                        class="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <select
                        [(ngModel)]="port.protocol"
                        (ngModelChange)="touchForm()"
                        class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="TCP">TCP</option>
                        <option value="UDP">UDP</option>
                      </select>
                      <button (click)="removeContainerPort(i, j)" class="text-zinc-500 hover:text-red-400 p-0.5 transition-colors">
                        <lucide-icon [img]="Trash2Icon" [size]="11" />
                      </button>
                    </div>
                  }
                  <button
                    (click)="addContainerPort(i)"
                    class="text-[11px] text-zinc-400 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                  >
                    <lucide-icon [img]="PlusIcon" [size]="10" /> Add Port
                  </button>
                </div>
                <!-- Env vars (collapsible) -->
                <div>
                  <button
                    (click)="toggleContainerSection(i, 'env')"
                    class="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
                  >
                    <lucide-icon [img]="isContainerSectionOpen(i, 'env') ? ChevronDownIcon : ChevronRightIcon" [size]="11" />
                    Environment Variables ({{ container.env.length }})
                  </button>
                  @if (isContainerSectionOpen(i, 'env')) {
                    <div class="mt-1.5 space-y-1 pl-3">
                      @for (ev of container.env; track $index; let k = $index) {
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            [(ngModel)]="ev.name"
                            (ngModelChange)="touchForm()"
                            placeholder="VAR_NAME"
                            class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            [(ngModel)]="ev.value"
                            (ngModelChange)="touchForm()"
                            placeholder="value"
                            class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button (click)="removeContainerEnv(i, k)" class="text-zinc-500 hover:text-red-400 p-0.5 transition-colors">
                            <lucide-icon [img]="Trash2Icon" [size]="11" />
                          </button>
                        </div>
                      }
                      <button
                        (click)="addContainerEnv(i)"
                        class="text-[11px] text-zinc-400 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                      >
                        <lucide-icon [img]="PlusIcon" [size]="10" /> Add Variable
                      </button>
                    </div>
                  }
                </div>
                <!-- Resource limits (collapsible) -->
                <div>
                  <button
                    (click)="toggleContainerSection(i, 'resources')"
                    class="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
                  >
                    <lucide-icon [img]="isContainerSectionOpen(i, 'resources') ? ChevronDownIcon : ChevronRightIcon" [size]="11" />
                    Resource Limits
                  </button>
                  @if (isContainerSectionOpen(i, 'resources')) {
                    <div class="mt-1.5 grid grid-cols-2 gap-2 pl-3">
                      <div>
                        <label class="block text-[10px] text-zinc-500 mb-0.5">CPU Request</label>
                        <input
                          type="text"
                          [(ngModel)]="container.cpuRequest"
                          (ngModelChange)="touchForm()"
                          placeholder="100m"
                          class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label class="block text-[10px] text-zinc-500 mb-0.5">CPU Limit</label>
                        <input
                          type="text"
                          [(ngModel)]="container.cpuLimit"
                          (ngModelChange)="touchForm()"
                          placeholder="500m"
                          class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label class="block text-[10px] text-zinc-500 mb-0.5">Memory Request</label>
                        <input
                          type="text"
                          [(ngModel)]="container.memRequest"
                          (ngModelChange)="touchForm()"
                          placeholder="128Mi"
                          class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label class="block text-[10px] text-zinc-500 mb-0.5">Memory Limit</label>
                        <input
                          type="text"
                          [(ngModel)]="container.memLimit"
                          (ngModelChange)="touchForm()"
                          placeholder="256Mi"
                          class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
            <button
              (click)="addContainer()"
              class="text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              <lucide-icon [img]="PlusIcon" [size]="12" /> Add Container
            </button>
          </div>
        }
        @case ('port-list') {
          <div class="space-y-1.5">
            <label class="block text-xs text-zinc-400">{{ field.label }}</label>
            @for (port of formModel().ports; track $index; let i = $index) {
              <div class="flex items-center gap-2 flex-wrap">
                <div class="flex items-center gap-1">
                  <label class="text-[10px] text-zinc-500">Port</label>
                  <input
                    type="number"
                    [(ngModel)]="port.port"
                    (ngModelChange)="touchForm()"
                    placeholder="80"
                    class="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div class="flex items-center gap-1">
                  <label class="text-[10px] text-zinc-500">Target</label>
                  <input
                    type="number"
                    [(ngModel)]="port.targetPort"
                    (ngModelChange)="touchForm()"
                    placeholder="80"
                    class="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  [(ngModel)]="port.protocol"
                  (ngModelChange)="touchForm()"
                  class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                </select>
                <input
                  type="text"
                  [(ngModel)]="port.name"
                  (ngModelChange)="touchForm()"
                  placeholder="Name (optional)"
                  class="flex-1 min-w-[80px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button (click)="removeServicePort(i)" class="text-zinc-500 hover:text-red-400 p-0.5 transition-colors">
                  <lucide-icon [img]="Trash2Icon" [size]="13" />
                </button>
              </div>
            }
            <button
              (click)="addServicePort()"
              class="text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              <lucide-icon [img]="PlusIcon" [size]="12" /> Add Port
            </button>
          </div>
        }
        @case ('ingress-rules') {
          <div class="space-y-2">
            <label class="block text-xs text-zinc-400">{{ field.label }}</label>
            @if (field.helpText) {
              <p class="text-[11px] text-zinc-500">{{ field.helpText }}</p>
            }
            @for (rule of formModel().ingressRules; track $index; let i = $index) {
              <div class="bg-zinc-800/50 rounded-lg border border-zinc-700 p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-zinc-400 font-medium">Rule {{ i + 1 }}</span>
                  @if (formModel().ingressRules.length > 1) {
                    <button (click)="removeIngressRule(i)" class="text-zinc-500 hover:text-red-400 p-0.5 transition-colors">
                      <lucide-icon [img]="Trash2Icon" [size]="11" />
                    </button>
                  }
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] text-zinc-500 mb-0.5">Host</label>
                    <input
                      type="text"
                      [(ngModel)]="rule.host"
                      (ngModelChange)="touchForm()"
                      placeholder="example.com"
                      class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label class="block text-[10px] text-zinc-500 mb-0.5">Path</label>
                    <input
                      type="text"
                      [(ngModel)]="rule.path"
                      (ngModelChange)="touchForm()"
                      placeholder="/"
                      class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label class="block text-[10px] text-zinc-500 mb-0.5">Service Name</label>
                    <input
                      type="text"
                      [(ngModel)]="rule.serviceName"
                      (ngModelChange)="touchForm()"
                      placeholder="my-service"
                      class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label class="block text-[10px] text-zinc-500 mb-0.5">Service Port</label>
                    <input
                      type="number"
                      [(ngModel)]="rule.servicePort"
                      (ngModelChange)="touchForm()"
                      placeholder="80"
                      class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] text-zinc-500 mb-0.5">Path Type</label>
                  <select
                    [(ngModel)]="rule.pathType"
                    (ngModelChange)="touchForm()"
                    class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Prefix">Prefix</option>
                    <option value="Exact">Exact</option>
                    <option value="ImplementationSpecific">ImplementationSpecific</option>
                  </select>
                </div>
              </div>
            }
            <button
              (click)="addIngressRule()"
              class="text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              <lucide-icon [img]="PlusIcon" [size]="12" /> Add Rule
            </button>
          </div>
        }
      }
    </ng-template>
  `,
})
export class K8sCreateResourceModalComponent implements OnInit {
  @Input() resourceType!: string;
  @Input() namespace!: string;
  @Input() namespaces: K8sNamespace[] = [];
  @Input() connectionId!: string;
  @Input() clusterId!: string;
  @Input() activeCrd: K8sApiResource | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() created = new EventEmitter<void>();

  private backend = BackendService.prototype; // placeholder, set in ngOnInit

  readonly PlusIcon = Plus;
  readonly Trash2Icon = Trash2;
  readonly Loader2Icon = Loader2;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly XIcon = X;
  readonly CodeIcon = Code;
  readonly FileTextIcon = FileText;

  mode = signal<'form' | 'yaml'>('form');
  formModel = signal<FormModel>(createDefaultFormModel());
  yamlContent = '';
  selectedNamespace = 'default';
  showAdvanced = signal(false);
  creating = signal(false);
  error = signal<string | null>(null);
  success = signal(false);
  yamlParseWarning = signal<string | null>(null);

  // Track which container sub-sections are open
  private openContainerSections = new Map<string, boolean>();

  private formDef = signal<ResourceFormDef | null>(null);

  hasForm = computed(() => this.formDef() !== null);
  basicSections = computed(() => this.formDef()?.sections.filter(s => !s.advanced) ?? []);
  advancedSections = computed(() => this.formDef()?.sections.filter(s => s.advanced) ?? []);

  resourceLabel = computed(() => {
    const def = this.formDef();
    if (def) return def.kind;
    if (this.activeCrd) return this.activeCrd.kind;
    return this.resourceType;
  });

  constructor(private backendService: BackendService) {
    this.backend = backendService;
  }

  ngOnInit(): void {
    this.selectedNamespace = this.namespace || 'default';
    const def = getFormDef(this.resourceType);
    this.formDef.set(def ?? null);

    if (def) {
      this.mode.set('form');
      this.formModel.set(createDefaultFormModel());
    } else {
      // No form definition — go straight to YAML
      this.mode.set('yaml');
      this.yamlContent = getResourceTemplate(this.resourceType, this.selectedNamespace);
    }
  }

  // ============================================================================
  // Form/YAML toggle
  // ============================================================================

  switchToYaml(): void {
    if (this.mode() === 'yaml') return;
    this.yamlContent = formToYaml(this.resourceType, this.formModel(), this.selectedNamespace);
    this.yamlParseWarning.set(null);
    this.mode.set('yaml');
  }

  switchToForm(): void {
    if (this.mode() === 'form') return;
    const result = yamlToForm(this.resourceType, this.yamlContent, this.formModel());
    if (result) {
      this.formModel.set(result);
      this.yamlParseWarning.set(null);
      this.mode.set('form');
    } else {
      this.yamlParseWarning.set('Could not parse YAML back to form. Staying in YAML mode.');
    }
  }

  // ============================================================================
  // Field accessors (used by template)
  // ============================================================================

  getFieldValue(key: string): any {
    return (this.formModel() as any)[key];
  }

  setFieldValue(key: string, value: any): void {
    this.formModel.update(m => ({ ...m, [key]: value }));
  }

  touchForm(): void {
    // Force signal update for mutable sub-object changes
    this.formModel.update(m => ({ ...m }));
  }

  // Key-value pairs
  getKvPairs(key: string): KeyValuePair[] {
    return (this.formModel() as any)[key] ?? [];
  }

  addKvPair(key: string): void {
    this.formModel.update(m => {
      const arr = [...((m as any)[key] ?? []), { key: '', value: '' }];
      return { ...m, [key]: arr };
    });
  }

  removeKvPair(key: string, index: number): void {
    this.formModel.update(m => {
      const arr = [...((m as any)[key] ?? [])];
      arr.splice(index, 1);
      return { ...m, [key]: arr };
    });
  }

  // Containers
  addContainer(): void {
    this.formModel.update(m => ({
      ...m,
      containers: [...m.containers, createDefaultContainer()],
    }));
  }

  removeContainer(index: number): void {
    this.formModel.update(m => {
      const containers = [...m.containers];
      containers.splice(index, 1);
      return { ...m, containers };
    });
  }

  addContainerPort(containerIndex: number): void {
    const model = this.formModel();
    model.containers[containerIndex].ports.push({ containerPort: 0, protocol: 'TCP' });
    this.touchForm();
  }

  removeContainerPort(containerIndex: number, portIndex: number): void {
    const model = this.formModel();
    model.containers[containerIndex].ports.splice(portIndex, 1);
    this.touchForm();
  }

  addContainerEnv(containerIndex: number): void {
    const model = this.formModel();
    model.containers[containerIndex].env.push({ name: '', value: '' });
    this.touchForm();
  }

  removeContainerEnv(containerIndex: number, envIndex: number): void {
    const model = this.formModel();
    model.containers[containerIndex].env.splice(envIndex, 1);
    this.touchForm();
  }

  toggleContainerSection(containerIndex: number, section: string): void {
    const key = `${containerIndex}-${section}`;
    this.openContainerSections.set(key, !this.openContainerSections.get(key));
  }

  isContainerSectionOpen(containerIndex: number, section: string): boolean {
    return this.openContainerSections.get(`${containerIndex}-${section}`) ?? false;
  }

  // Service ports
  addServicePort(): void {
    this.formModel.update(m => ({
      ...m,
      ports: [...m.ports, { name: '', port: 0, targetPort: 0, protocol: 'TCP' }],
    }));
  }

  removeServicePort(index: number): void {
    this.formModel.update(m => {
      const ports = [...m.ports];
      ports.splice(index, 1);
      return { ...m, ports };
    });
  }

  // Ingress rules
  addIngressRule(): void {
    this.formModel.update(m => ({
      ...m,
      ingressRules: [...m.ingressRules, { host: '', path: '/', pathType: 'Prefix', serviceName: '', servicePort: 80 }],
    }));
  }

  removeIngressRule(index: number): void {
    this.formModel.update(m => {
      const rules = [...m.ingressRules];
      rules.splice(index, 1);
      return { ...m, ingressRules: rules };
    });
  }

  // ============================================================================
  // Validation
  // ============================================================================

  isValid(): boolean {
    if (this.mode() === 'yaml') {
      return this.yamlContent.trim().length > 0;
    }
    const m = this.formModel();
    if (!m.name.trim()) return false;
    // Resource-type-specific validation
    const workloadTypes = ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs'];
    if (workloadTypes.includes(this.resourceType)) {
      return m.containers.some(c => c.image.trim() !== '');
    }
    if (this.resourceType === 'services') {
      return m.selector.some(p => p.key.trim() !== '');
    }
    if (this.resourceType === 'ingresses') {
      return m.ingressRules.some(r => r.serviceName.trim() !== '');
    }
    if (this.resourceType === 'horizontalpodautoscalers') {
      return m.scaleTargetName.trim() !== '';
    }
    if (this.resourceType === 'poddisruptionbudgets') {
      return m.selector.some(p => p.key.trim() !== '');
    }
    if (this.resourceType === 'networkpolicies') {
      return m.netpolPodSelector.some(p => p.key.trim() !== '');
    }
    if (this.resourceType === 'storageclasses') {
      return m.provisioner.trim() !== '';
    }
    if (this.resourceType === 'rolebindings' || this.resourceType === 'clusterrolebindings') {
      return m.roleRefName.trim() !== '' && m.subjectName.trim() !== '';
    }
    if (this.resourceType === 'roles' || this.resourceType === 'clusterroles') {
      return m.rbacResources.trim() !== '';
    }
    return true;
  }

  // ============================================================================
  // Apply
  // ============================================================================

  async apply(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);
    this.success.set(false);

    try {
      let yamlStr: string;
      if (this.mode() === 'form') {
        yamlStr = formToYaml(this.resourceType, this.formModel(), this.selectedNamespace);
      } else {
        yamlStr = this.yamlContent;
      }

      if (this.activeCrd) {
        await this.backend.applyCustomResourceFor(
          this.connectionId, this.clusterId,
          this.activeCrd.group, this.activeCrd.version, this.activeCrd.plural,
          yamlStr,
          this.activeCrd.scope === 'Namespaced' ? this.selectedNamespace : undefined,
        );
      } else {
        const clusterScoped = CLUSTER_SCOPED_TABS.has(this.resourceType);
        await this.backend.applyYamlFor(
          this.connectionId, this.clusterId, yamlStr,
          clusterScoped ? undefined : this.selectedNamespace,
        );
      }

      this.success.set(true);
      setTimeout(() => {
        this.created.emit();
        this.close.emit();
      }, 800);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to create resource');
    } finally {
      this.creating.set(false);
    }
  }
}

const CLUSTER_SCOPED_TABS = new Set([
  'nodes', 'persistentvolumes', 'storageclasses',
  'clusterroles', 'clusterrolebindings', 'ingressclasses', 'namespaces',
]);
