import { ResourceFormDef } from './k8s-resource-form.types';

export const WORKLOAD_FORM_DEFS: ResourceFormDef[] = [
  {
    resourceType: 'deployments',
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-deployment', required: true,
            validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
          },
          {
            key: 'replicas', label: 'Replicas', type: 'number',
            defaultValue: 1, validation: { min: 0, max: 100 },
          },
        ],
      },
      {
        id: 'containers',
        title: 'Containers',
        fields: [
          { key: 'containers', label: 'Containers', type: 'container-list' },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value', helpText: 'Applied to deployment and pod template' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
      {
        id: 'strategy',
        title: 'Update Strategy',
        advanced: true,
        fields: [
          {
            key: 'strategyType', label: 'Strategy', type: 'select', defaultValue: 'RollingUpdate',
            options: [
              { value: 'RollingUpdate', label: 'Rolling Update' },
              { value: 'Recreate', label: 'Recreate' },
            ],
          },
          { key: 'maxUnavailable', label: 'Max Unavailable', type: 'text', placeholder: '25%', defaultValue: '25%' },
          { key: 'maxSurge', label: 'Max Surge', type: 'text', placeholder: '25%', defaultValue: '25%' },
        ],
      },
      {
        id: 'scheduling',
        title: 'Node Scheduling',
        advanced: true,
        fields: [
          { key: 'nodeSelector', label: 'Node Selector', type: 'key-value', helpText: 'Key-value pairs for node selection' },
        ],
      },
    ],
  },
  {
    resourceType: 'statefulsets',
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-statefulset', required: true,
            validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
          },
          { key: 'replicas', label: 'Replicas', type: 'number', defaultValue: 1, validation: { min: 0, max: 100 } },
          {
            key: 'serviceName', label: 'Service Name', type: 'text',
            placeholder: 'my-statefulset', required: true,
            helpText: 'Headless service that governs this StatefulSet',
          },
        ],
      },
      {
        id: 'containers',
        title: 'Containers',
        fields: [
          { key: 'containers', label: 'Containers', type: 'container-list' },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
      {
        id: 'scheduling',
        title: 'Node Scheduling',
        advanced: true,
        fields: [
          { key: 'nodeSelector', label: 'Node Selector', type: 'key-value' },
        ],
      },
    ],
  },
  {
    resourceType: 'daemonsets',
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-daemonset', required: true,
            validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
          },
        ],
      },
      {
        id: 'containers',
        title: 'Containers',
        fields: [
          { key: 'containers', label: 'Containers', type: 'container-list' },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
      {
        id: 'scheduling',
        title: 'Node Scheduling',
        advanced: true,
        fields: [
          { key: 'nodeSelector', label: 'Node Selector', type: 'key-value' },
        ],
      },
    ],
  },
  {
    resourceType: 'jobs',
    apiVersion: 'batch/v1',
    kind: 'Job',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-job', required: true,
          },
        ],
      },
      {
        id: 'containers',
        title: 'Containers',
        fields: [
          { key: 'containers', label: 'Containers', type: 'container-list' },
        ],
      },
      {
        id: 'job-settings',
        title: 'Job Settings',
        advanced: true,
        fields: [
          {
            key: 'restartPolicy', label: 'Restart Policy', type: 'select', defaultValue: 'Never',
            options: [
              { value: 'Never', label: 'Never' },
              { value: 'OnFailure', label: 'On Failure' },
            ],
          },
          { key: 'backoffLimit', label: 'Backoff Limit', type: 'number', defaultValue: 3, validation: { min: 0, max: 100 } },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
    ],
  },
  {
    resourceType: 'cronjobs',
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-cronjob', required: true,
          },
          {
            key: 'schedule', label: 'Schedule', type: 'text',
            placeholder: '*/5 * * * *', required: true,
            helpText: 'Cron expression (min hour dom month dow)',
          },
        ],
      },
      {
        id: 'containers',
        title: 'Job Container',
        fields: [
          { key: 'containers', label: 'Containers', type: 'container-list' },
        ],
      },
      {
        id: 'job-settings',
        title: 'Job Settings',
        advanced: true,
        fields: [
          {
            key: 'concurrencyPolicy', label: 'Concurrency Policy', type: 'select', defaultValue: 'Allow',
            options: [
              { value: 'Allow', label: 'Allow' },
              { value: 'Forbid', label: 'Forbid' },
              { value: 'Replace', label: 'Replace' },
            ],
          },
          {
            key: 'restartPolicy', label: 'Restart Policy', type: 'select', defaultValue: 'Never',
            options: [
              { value: 'Never', label: 'Never' },
              { value: 'OnFailure', label: 'On Failure' },
            ],
          },
          { key: 'backoffLimit', label: 'Backoff Limit', type: 'number', defaultValue: 3, validation: { min: 0, max: 100 } },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
    ],
  },
  {
    resourceType: 'pods',
    apiVersion: 'v1',
    kind: 'Pod',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-pod', required: true,
            validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
          },
          {
            key: 'restartPolicy', label: 'Restart Policy', type: 'select', defaultValue: 'Always',
            options: [
              { value: 'Always', label: 'Always' },
              { value: 'OnFailure', label: 'On Failure' },
              { value: 'Never', label: 'Never' },
            ],
          },
        ],
      },
      {
        id: 'containers',
        title: 'Containers',
        fields: [
          { key: 'containers', label: 'Containers', type: 'container-list' },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
      {
        id: 'scheduling',
        title: 'Node Scheduling',
        advanced: true,
        fields: [
          { key: 'nodeSelector', label: 'Node Selector', type: 'key-value', helpText: 'Key-value pairs for node selection' },
        ],
      },
    ],
  },
  {
    resourceType: 'horizontalpodautoscalers',
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-hpa', required: true },
        ],
      },
      {
        id: 'target',
        title: 'Scale Target',
        fields: [
          {
            key: 'scaleTargetKind', label: 'Target Kind', type: 'select', defaultValue: 'Deployment',
            options: [
              { value: 'Deployment', label: 'Deployment' },
              { value: 'StatefulSet', label: 'StatefulSet' },
            ],
          },
          { key: 'scaleTargetName', label: 'Target Name', type: 'text', placeholder: 'my-deployment', required: true },
          { key: 'minReplicas', label: 'Min Replicas', type: 'number', defaultValue: 1, validation: { min: 1, max: 100 } },
          { key: 'maxReplicas', label: 'Max Replicas', type: 'number', defaultValue: 10, validation: { min: 1, max: 1000 } },
          {
            key: 'targetCpuUtilization', label: 'Target CPU Utilization (%)', type: 'number',
            defaultValue: 80, validation: { min: 1, max: 100 },
            helpText: 'Average CPU utilization across all pods',
          },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
    ],
  },
  {
    resourceType: 'poddisruptionbudgets',
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-pdb', required: true },
          {
            key: 'minAvailable', label: 'Min Available', type: 'text', placeholder: '1',
            helpText: 'Number or percentage (e.g. "1" or "50%") of pods that must remain available',
          },
        ],
      },
      {
        id: 'selector',
        title: 'Pod Selector',
        fields: [
          {
            key: 'selector', label: 'Match Labels', type: 'key-value', required: true,
            helpText: 'Labels to match target pods',
          },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value' },
        ],
      },
    ],
  },
];
