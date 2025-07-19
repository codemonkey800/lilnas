# SABnzbd Init Container Cleanup Plan

## Background

The SABnzbd Helm chart currently includes an init container that was added to fix the hostname check issue. The init container modifies the `sabnzbd.ini` file to add `sabnzbd.lilnas.io` to the hostname whitelist, preventing connection refusal errors.

## Current Status

✅ **Issue Resolved**: The hostname check problem is permanently fixed  
✅ **Configuration Persists**: The hostname `sabnzbd.lilnas.io` is now stored in `/config/sabnzbd.ini` on the PVC  
✅ **Service Operational**: SABnzbd web interface is accessible at https://sabnzbd.lilnas.io

### Current Configuration
```
host_whitelist = sabnzbd-599c47797b-bh2l7,sabnzbd.lilnas.io,
```

## Analysis: Why Remove Init Container?

### The Init Container Has Served Its Purpose
1. **One-time fix**: The hostname whitelist modification was a one-time configuration change
2. **Persistent storage**: Configuration is stored on PVC and survives pod restarts
3. **Problem solved**: No more hostname refusal errors in logs

### Current Init Container Behavior
The init container runs on every pod restart and checks:
```bash
if echo "$CURRENT" | grep -q "$HOSTNAME"; then
    echo "Hostname $HOSTNAME already in whitelist"  # ← Always true now
```

Since `sabnzbd.lilnas.io` is already in the whitelist, the init container **does nothing** on subsequent runs.

### Arguments for Removal

**✅ Configuration Persists**: The fix is permanent in the PVC  
**✅ Unnecessary Overhead**: Init container runs but performs no work  
**✅ Resource Efficiency**: Saves CPU/memory resources (32Mi-64Mi, 50m-100m CPU)  
**✅ Faster Startup**: Eliminates ~2-3 second init container delay  
**✅ Simpler Deployment**: Reduces chart complexity and maintenance  

## Cleanup Plan

### Step 1: Remove Init Container Configuration

Remove the `initContainers` section from `values.yaml`:

```yaml
# REMOVE THIS SECTION:
initContainers:
  # Fix hostname whitelist for ingress access
  - name: fix-hostname-whitelist
    image: busybox:1.35
    command: ['sh', '-c']
    resources:
      requests:
        memory: "32Mi"
        cpu: "50m"
      limits:
        memory: "64Mi"
        cpu: "100m"
    args:
      - |
        # ... (entire script)
    volumeMounts:
      - name: data
        mountPath: /config

# REPLACE WITH:
initContainers: []
```

### Step 2: Test Template Rendering

```bash
cd /home/jeremy/lilnas/k8s/charts/sabnzbd
./test-render.sh
```

Verify that:
- No init containers appear in the deployment template
- All other resources render correctly

### Step 3: Deploy Updated Chart

```bash
./deploy.sh -e dev --dry-run  # Test first
./deploy.sh -e dev           # Deploy
```

### Step 4: Verification

After deployment, verify:

```bash
# Check that no init containers exist
kubectl get pods -n lilnas-apps -l app.kubernetes.io/name=sabnzbd -o jsonpath='{.items[*].spec.initContainers}' && echo "Init containers found!" || echo "No init containers (good!)"

# Verify hostname whitelist is still intact
kubectl exec -n lilnas-apps deployment/sabnzbd -- grep "host_whitelist" /config/sabnzbd.ini

# Test hostname access still works
kubectl exec -n lilnas-apps deployment/sabnzbd -- wget -q --timeout=10 --spider --header="Host: sabnzbd.lilnas.io" http://localhost:8080/ && echo "Hostname check still works!"

# Check for hostname refusal errors (should be none)
kubectl logs -n lilnas-apps deployment/sabnzbd --since=5m | grep -i "refused.*hostname" || echo "No hostname refusal errors"
```

## Expected Results

### Before Cleanup
```yaml
spec:
  template:
    spec:
      initContainers:
        - name: fix-hostname-whitelist
          image: busybox:1.35
          # ... configuration
```

### After Cleanup
```yaml
spec:
  template:
    spec:
      # No initContainers section
      containers:
        - name: sabnzbd
          # ... main container only
```

## Benefits of Cleanup

| Aspect | Before | After |
|--------|--------|-------|
| **Pod Startup Time** | ~5-8 seconds (including init) | ~3-5 seconds (main container only) |
| **Resource Usage** | +32Mi-64Mi memory, +50m-100m CPU | Resource savings |
| **Chart Complexity** | 50+ lines of init container config | Simple, clean configuration |
| **Maintenance** | Complex script to maintain | No init container logic |
| **Functionality** | Same (hostname check works) | Same (hostname check works) |

## Rollback Plan

If any issues occur, the init container can be restored by reverting the `values.yaml` changes:

```bash
git checkout values.yaml  # If committed
# OR manually re-add the initContainers section
```

## Conclusion

The init container successfully resolved the hostname check issue and created a permanent configuration change. Since the fix persists in the PVC, the init container is no longer needed and can be safely removed to simplify the deployment and improve resource efficiency.

The cleanup is **safe** and **recommended** because:
- ✅ Configuration is permanent (stored in PVC)
- ✅ Issue is resolved (no more hostname errors)  
- ✅ Functionality remains unchanged (web interface still accessible)
- ✅ Deployment becomes simpler and more efficient