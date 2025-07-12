# Kubernetes Integration for Claude Code GitHub Action

This directory contains the Kubernetes RBAC manifests and documentation for enabling kubectl access in the Claude Code GitHub Action.

## Overview

The Claude Code GitHub Action can interact with your Kubernetes cluster using `kubectl` commands. This integration uses a dedicated service account with appropriate RBAC permissions for security.

## Prerequisites

- A running Kubernetes cluster
- `kubectl` configured to access your cluster
- Administrator access to the cluster
- GitHub repository with appropriate secrets configured

## Setup Instructions

### 1. Apply Kubernetes RBAC Manifests

Apply the service account and RBAC permissions:

```bash
# Apply the basic read-only permissions (recommended to start)
kubectl apply -f k8s/ci-cd/github-actions-rbac.yml

# Verify the service account was created
kubectl get serviceaccount github-actions -n default

# Verify the RBAC permissions
kubectl get clusterrole github-actions-reader
kubectl get clusterrolebinding github-actions-binding
```

### 2. Generate Service Account Token

Create a long-lived token for the service account:

```bash
# Create a long-lived token (valid for 1 year)
kubectl create token github-actions --duration=8760h

# Save this token - you'll need it for GitHub secrets
```

### 3. Extract Cluster Information

Get the cluster server URL and CA certificate from your kubeconfig:

```bash
# Get cluster info (replace 'your-cluster-name' with your actual cluster name)
kubectl config view --raw --minify --flatten

# Extract server URL (example output)
kubectl config view --raw --minify --flatten | grep server:

# Extract and encode CA certificate
kubectl config view --raw --minify --flatten | grep certificate-authority-data:
```

### 4. Configure GitHub Secrets

In your GitHub repository, go to `Settings > Secrets and variables > Actions` and add these secrets:

| Secret Name      | Description                           | Example                                   |
| ---------------- | ------------------------------------- | ----------------------------------------- |
| `KUBE_TOKEN`     | Service account token from step 2     | `eyJhbGciOiJSUzI1NiIsImtpZCI6...`         |
| `KUBE_SERVER`    | Kubernetes API server URL             | `https://kubernetes.example.com:6443`     |
| `KUBE_CA_CERT`   | Base64-encoded cluster CA certificate | `LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...` |
| `KUBE_NAMESPACE` | Default namespace (optional)          | `default`                                 |

#### Getting the CA Certificate

If you need to extract the CA certificate separately:

```bash
# Method 1: From kubeconfig
kubectl config view --raw --minify --flatten | grep certificate-authority-data | cut -d: -f2 | tr -d ' '

# Method 2: From cluster (if using a service account)
kubectl get secret $(kubectl get serviceaccount github-actions -o jsonpath='{.secrets[0].name}') -o jsonpath='{.data.ca\.crt}'
```

### 5. Test the Setup

Once configured, test the integration:

1. Create a test issue or PR comment with `@claude test kubectl connection`
2. Check the GitHub Actions workflow logs to verify kubectl is working
3. Look for the "Verify kubectl connection" step in the workflow

## Security Considerations

### Default Permissions (Read-Only)

The default RBAC configuration provides read-only access to:

- Pods, Services, ConfigMaps, PVCs, Nodes, Events
- Deployments, ReplicaSets, StatefulSets, DaemonSets
- Ingresses, NetworkPolicies
- Jobs, CronJobs
- Metrics

### Extended Permissions (Optional)

If you need write access, apply the extended RBAC:

```bash
# CAUTION: This provides write access to many resources
kubectl apply -f k8s/ci-cd/github-actions-rbac-extended.yml
```

Extended permissions include:

- Create, update, delete pods and deployments
- Scale deployments and statefulsets
- Manage configmaps and services
- Execute commands in pods (`kubectl exec`)

### Security Best Practices

1. **Principle of Least Privilege**: Start with read-only access
2. **Token Rotation**: Regularly rotate the service account token
3. **Namespace Scoping**: Consider using namespace-specific roles instead of cluster roles
4. **Audit Logging**: Enable Kubernetes audit logging to track actions
5. **Secret Management**: Use GitHub's encrypted secrets for sensitive data

## Common kubectl Commands for Claude Code

Once configured, Claude Code can use these kubectl commands:

```bash
# Cluster information
kubectl cluster-info
kubectl get nodes

# Pod management
kubectl get pods
kubectl describe pod <pod-name>
kubectl logs <pod-name>

# Deployment management
kubectl get deployments
kubectl describe deployment <deployment-name>
kubectl scale deployment <deployment-name> --replicas=3

# Service discovery
kubectl get services
kubectl get ingresses

# Troubleshooting
kubectl get events --sort-by=.metadata.creationTimestamp
kubectl top pods
kubectl top nodes
```

## Troubleshooting

### Common Issues

1. **"kubectl: command not found"**

   - The workflow installs kubectl automatically
   - Check the "Install kubectl" step in the workflow logs

2. **"Unable to connect to the server"**

   - Verify `KUBE_SERVER` secret contains the correct API server URL
   - Check if the server is accessible from GitHub Actions runners

3. **"Forbidden" or "Unauthorized" errors**

   - Verify `KUBE_TOKEN` secret contains a valid service account token
   - Check RBAC permissions with `kubectl auth can-i <verb> <resource> --as=system:serviceaccount:default:github-actions`

4. **"x509: certificate signed by unknown authority"**
   - Verify `KUBE_CA_CERT` secret contains the correct base64-encoded CA certificate
   - Ensure the certificate is properly formatted

### Verification Commands

Run these commands to verify your setup:

```bash
# Test service account permissions
kubectl auth can-i get pods --as=system:serviceaccount:default:github-actions
kubectl auth can-i create deployments --as=system:serviceaccount:default:github-actions

# Check token validity
kubectl --token=<your-token> get pods

# Verify RBAC
kubectl describe clusterrole github-actions-reader
kubectl describe clusterrolebinding github-actions-binding
```

## Maintenance

### Token Rotation

Service account tokens should be rotated regularly:

```bash
# Create a new token
kubectl create token github-actions --duration=8760h

# Update the GitHub secret with the new token
# The old token will automatically expire
```

### Monitoring Usage

Monitor kubectl usage in your GitHub Actions:

1. Check workflow logs for kubectl commands
2. Enable Kubernetes audit logging
3. Monitor cluster resource usage
4. Review RBAC permissions periodically

## Support

For issues with this integration:

1. Check the GitHub Actions workflow logs
2. Verify Kubernetes cluster connectivity
3. Test kubectl commands locally with the same credentials
4. Review the RBAC permissions and service account configuration

## Files in This Directory

- `github-actions-rbac.yml`: Basic read-only RBAC configuration
- `github-actions-rbac-extended.yml`: Extended RBAC with write permissions
- `README.md`: This documentation file
- `setup-service-account.sh`: Helper script for service account setup (if present)
