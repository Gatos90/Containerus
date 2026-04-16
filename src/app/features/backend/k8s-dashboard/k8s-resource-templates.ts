/**
 * Pre-filled YAML templates for quick-creating Kubernetes resources.
 * Each template uses placeholder values that users can edit before applying.
 */

export function getResourceTemplate(kind: string, namespace: string): string {
  const fn = TEMPLATES[kind];
  return fn ? fn(namespace) : defaultTemplate(kind, namespace);
}

const TEMPLATES: Record<string, (ns: string) => string> = {
  pods: (ns) => `apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  namespace: ${ns}
spec:
  containers:
    - name: main
      image: nginx:latest
      ports:
        - containerPort: 80`,

  deployments: (ns) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-deployment
  template:
    metadata:
      labels:
        app: my-deployment
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80`,

  statefulsets: (ns) => `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-statefulset
  namespace: ${ns}
spec:
  replicas: 1
  serviceName: my-statefulset
  selector:
    matchLabels:
      app: my-statefulset
  template:
    metadata:
      labels:
        app: my-statefulset
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80`,

  daemonsets: (ns) => `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-daemonset
  namespace: ${ns}
spec:
  selector:
    matchLabels:
      app: my-daemonset
  template:
    metadata:
      labels:
        app: my-daemonset
    spec:
      containers:
        - name: main
          image: nginx:latest`,

  jobs: (ns) => `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: ${ns}
spec:
  template:
    spec:
      containers:
        - name: worker
          image: busybox:latest
          command: ["echo", "Hello from job"]
      restartPolicy: Never
  backoffLimit: 3`,

  cronjobs: (ns) => `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: ${ns}
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: worker
              image: busybox:latest
              command: ["echo", "Hello from cron"]
          restartPolicy: Never`,

  services: (ns) => `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: ${ns}
spec:
  type: ClusterIP
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP`,

  ingresses: (ns) => `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: ${ns}
spec:
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-service
                port:
                  number: 80`,

  configmaps: (ns) => `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-configmap
  namespace: ${ns}
data:
  key1: value1
  key2: value2`,

  secrets: (ns) => `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: ${ns}
type: Opaque
stringData:
  username: admin
  password: changeme`,

  pvcs: (ns) => `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: ${ns}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi`,

  networkpolicies: (ns) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-network-policy
  namespace: ${ns}
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 80`,

  resourcequotas: (ns) => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: my-quota
  namespace: ${ns}
spec:
  hard:
    pods: "10"
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi`,

  limitranges: (ns) => `apiVersion: v1
kind: LimitRange
metadata:
  name: my-limits
  namespace: ${ns}
spec:
  limits:
    - default:
        cpu: 500m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      type: Container`,

  serviceaccounts: (ns) => `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
  namespace: ${ns}`,

  roles: (ns) => `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-role
  namespace: ${ns}
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]`,

  rolebindings: (ns) => `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-rolebinding
  namespace: ${ns}
subjects:
  - kind: ServiceAccount
    name: my-service-account
    namespace: ${ns}
roleRef:
  kind: Role
  name: my-role
  apiGroup: rbac.authorization.k8s.io`,

  horizontalpodautoscalers: (ns) => `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-hpa
  namespace: ${ns}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-deployment
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80`,

  poddisruptionbudgets: (ns) => `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-pdb
  namespace: ${ns}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: my-app`,

  // Cluster-scoped resources (namespace ignored)
  persistentvolumes: () => `apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /data/my-pv`,

  storageclasses: () => `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: my-storage-class
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer`,

  clusterroles: () => `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: my-clusterrole
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]`,

  clusterrolebindings: () => `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: my-clusterrolebinding
subjects:
  - kind: ServiceAccount
    name: my-service-account
    namespace: default
roleRef:
  kind: ClusterRole
  name: my-clusterrole
  apiGroup: rbac.authorization.k8s.io`,

  ingressclasses: () => `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: my-ingress-class
spec:
  controller: k8s.io/ingress-nginx`,

  nodes: () => `# Nodes are managed by the cluster and cannot be created via YAML.
# Use this tab to view, cordon, uncordon, or drain nodes.`,

  namespaces: () => `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace`,
};

function defaultTemplate(kind: string, namespace: string): string {
  return `# No template available for "${kind}".
# Write your YAML manifest here and click Apply.
apiVersion: v1
kind: ${kind}
metadata:
  name: my-resource
  namespace: ${namespace}`;
}
