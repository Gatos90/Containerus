import { ResourceFormDef } from './k8s-resource-form.types';

export const STORAGE_FORM_DEFS: ResourceFormDef[] = [
  {
    resourceType: 'persistentvolumes',
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-pv', required: true },
          { key: 'storageSize', label: 'Capacity', type: 'text', placeholder: '10Gi', required: true, helpText: 'e.g. 10Gi, 500Mi' },
          {
            key: 'accessMode', label: 'Access Mode', type: 'select', defaultValue: 'ReadWriteOnce',
            options: [
              { value: 'ReadWriteOnce', label: 'ReadWriteOnce' },
              { value: 'ReadOnlyMany', label: 'ReadOnlyMany' },
              { value: 'ReadWriteMany', label: 'ReadWriteMany' },
            ],
          },
          {
            key: 'reclaimPolicy', label: 'Reclaim Policy', type: 'select', defaultValue: 'Retain',
            options: [
              { value: 'Retain', label: 'Retain' },
              { value: 'Delete', label: 'Delete' },
              { value: 'Recycle', label: 'Recycle' },
            ],
          },
          { key: 'hostPath', label: 'Host Path', type: 'text', placeholder: '/data/my-pv', helpText: 'Path on the host node (for hostPath volumes)' },
          { key: 'storageClassName', label: 'Storage Class', type: 'text', placeholder: 'Leave empty for no class' },
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
    resourceType: 'storageclasses',
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-storage-class', required: true },
          { key: 'provisioner', label: 'Provisioner', type: 'text', placeholder: 'kubernetes.io/no-provisioner', required: true, helpText: 'e.g. kubernetes.io/aws-ebs, kubernetes.io/gce-pd' },
          {
            key: 'volumeBindingMode', label: 'Volume Binding Mode', type: 'select', defaultValue: 'WaitForFirstConsumer',
            options: [
              { value: 'WaitForFirstConsumer', label: 'WaitForFirstConsumer' },
              { value: 'Immediate', label: 'Immediate' },
            ],
          },
          {
            key: 'reclaimPolicy', label: 'Reclaim Policy', type: 'select', defaultValue: 'Delete',
            options: [
              { value: 'Delete', label: 'Delete' },
              { value: 'Retain', label: 'Retain' },
            ],
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
    resourceType: 'pvcs',
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          {
            key: 'name', label: 'Name', type: 'text',
            placeholder: 'my-pvc', required: true,
          },
          {
            key: 'storageSize', label: 'Storage Size', type: 'text',
            placeholder: '1Gi', required: true,
            helpText: 'e.g. 1Gi, 500Mi, 10Gi',
          },
          {
            key: 'accessMode', label: 'Access Mode', type: 'select', defaultValue: 'ReadWriteOnce',
            options: [
              { value: 'ReadWriteOnce', label: 'ReadWriteOnce' },
              { value: 'ReadOnlyMany', label: 'ReadOnlyMany' },
              { value: 'ReadWriteMany', label: 'ReadWriteMany' },
            ],
          },
          {
            key: 'storageClassName', label: 'Storage Class', type: 'text',
            placeholder: 'standard (leave empty for default)',
            helpText: 'Name of the StorageClass, leave empty for cluster default',
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
