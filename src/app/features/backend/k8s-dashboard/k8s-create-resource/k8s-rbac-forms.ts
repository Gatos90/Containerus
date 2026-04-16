import { ResourceFormDef } from './k8s-resource-form.types';

export const RBAC_FORM_DEFS: ResourceFormDef[] = [
  {
    resourceType: 'serviceaccounts',
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-service-account', required: true },
        ],
      },
      {
        id: 'labels',
        title: 'Labels & Annotations',
        advanced: true,
        fields: [
          { key: 'labels', label: 'Labels', type: 'key-value' },
          { key: 'annotations', label: 'Annotations', type: 'key-value', helpText: 'e.g. eks.amazonaws.com/role-arn for IAM roles' },
        ],
      },
    ],
  },
  {
    resourceType: 'roles',
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-role', required: true },
        ],
      },
      {
        id: 'rules',
        title: 'Rules',
        fields: [
          { key: 'rbacApiGroups', label: 'API Groups', type: 'text', placeholder: '"" (core), apps, batch', helpText: 'Comma-separated. Use "" for core API group.' },
          { key: 'rbacResources', label: 'Resources', type: 'text', placeholder: 'pods, deployments, services', helpText: 'Comma-separated resource names' },
          { key: 'rbacVerbs', label: 'Verbs', type: 'text', placeholder: 'get, list, watch, create, delete', helpText: 'Comma-separated. Use * for all.' },
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
    resourceType: 'clusterroles',
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-clusterrole', required: true },
        ],
      },
      {
        id: 'rules',
        title: 'Rules',
        fields: [
          { key: 'rbacApiGroups', label: 'API Groups', type: 'text', placeholder: '"" (core), apps, batch', helpText: 'Comma-separated. Use "" for core API group.' },
          { key: 'rbacResources', label: 'Resources', type: 'text', placeholder: 'pods, deployments, services', helpText: 'Comma-separated resource names' },
          { key: 'rbacVerbs', label: 'Verbs', type: 'text', placeholder: 'get, list, watch, create, delete', helpText: 'Comma-separated. Use * for all.' },
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
    resourceType: 'rolebindings',
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-rolebinding', required: true },
        ],
      },
      {
        id: 'roleRef',
        title: 'Role Reference',
        fields: [
          {
            key: 'roleRefKind', label: 'Role Kind', type: 'select', defaultValue: 'Role',
            options: [
              { value: 'Role', label: 'Role' },
              { value: 'ClusterRole', label: 'ClusterRole' },
            ],
          },
          { key: 'roleRefName', label: 'Role Name', type: 'text', placeholder: 'my-role', required: true },
        ],
      },
      {
        id: 'subject',
        title: 'Subject',
        fields: [
          {
            key: 'subjectKind', label: 'Subject Kind', type: 'select', defaultValue: 'ServiceAccount',
            options: [
              { value: 'ServiceAccount', label: 'ServiceAccount' },
              { value: 'User', label: 'User' },
              { value: 'Group', label: 'Group' },
            ],
          },
          { key: 'subjectName', label: 'Subject Name', type: 'text', placeholder: 'my-service-account', required: true },
          { key: 'subjectNamespace', label: 'Subject Namespace', type: 'text', placeholder: 'default', helpText: 'Required for ServiceAccount subjects' },
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
    resourceType: 'clusterrolebindings',
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    sections: [
      {
        id: 'basic',
        title: 'Basic Configuration',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'my-clusterrolebinding', required: true },
        ],
      },
      {
        id: 'roleRef',
        title: 'Role Reference',
        fields: [
          { key: 'roleRefName', label: 'ClusterRole Name', type: 'text', placeholder: 'my-clusterrole', required: true },
        ],
      },
      {
        id: 'subject',
        title: 'Subject',
        fields: [
          {
            key: 'subjectKind', label: 'Subject Kind', type: 'select', defaultValue: 'ServiceAccount',
            options: [
              { value: 'ServiceAccount', label: 'ServiceAccount' },
              { value: 'User', label: 'User' },
              { value: 'Group', label: 'Group' },
            ],
          },
          { key: 'subjectName', label: 'Subject Name', type: 'text', placeholder: 'my-service-account', required: true },
          { key: 'subjectNamespace', label: 'Subject Namespace', type: 'text', placeholder: 'default', helpText: 'Required for ServiceAccount subjects' },
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
