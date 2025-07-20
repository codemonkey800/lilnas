#!/usr/bin/env bash
#
# Migrate Radarr data from Docker Compose to Kubernetes PVC
# Usage: ./migrate-data.sh
#
# This script helps migrate configuration data from the existing 
# Docker Compose setup to the new Kubernetes deployment.
#

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Configuration
readonly NAMESPACE="lilnas-media"
readonly SOURCE_DATA_PATH="/home/jeremy/lilnas/data/media/radarr"
readonly MIGRATION_POD_NAME="radarr-data-migration"

# Function to log messages
log() {
    local level="$1"
    shift
    local message="$*"
    
    case "$level" in
        "INFO")
            echo -e "${BLUE}[INFO]${NC} $message"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[SUCCESS]${NC} $message"
            ;;
        "WARNING")
            echo -e "${YELLOW}[WARNING]${NC} $message"
            ;;
        "ERROR")
            echo -e "${RED}[ERROR]${NC} $message"
            ;;
    esac
}

# Function to check prerequisites
check_prerequisites() {
    log "INFO" "Checking prerequisites..."
    
    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        log "ERROR" "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check if we can connect to the cluster
    if ! kubectl cluster-info &> /dev/null; then
        log "ERROR" "Cannot connect to Kubernetes cluster. Check your kubeconfig"
        exit 1
    fi
    
    # Check if source data exists
    if [[ ! -d "$SOURCE_DATA_PATH" ]]; then
        log "ERROR" "Source data path not found: $SOURCE_DATA_PATH"
        exit 1
    fi
    
    # Check if Radarr deployment exists
    if ! kubectl get deployment radarr -n "$NAMESPACE" &> /dev/null; then
        log "ERROR" "Radarr deployment not found. Please deploy the Helm chart first."
        log "INFO" "Run: ./deploy.sh"
        exit 1
    fi
    
    # Check if PVC exists
    if ! kubectl get pvc radarr-config -n "$NAMESPACE" &> /dev/null; then
        log "ERROR" "Radarr config PVC not found. Please deploy the Helm chart first."
        exit 1
    fi
    
    log "SUCCESS" "Prerequisites check passed"
}

# Function to create migration pod
create_migration_pod() {
    log "INFO" "Creating data migration pod..."
    
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $MIGRATION_POD_NAME
  namespace: $NAMESPACE
  labels:
    app: radarr-migration
spec:
  restartPolicy: Never
  containers:
  - name: migration
    image: busybox:latest
    command: ["sleep", "3600"]
    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
      limits:
        cpu: "500m"
        memory: "512Mi"
    volumeMounts:
    - name: config
      mountPath: /config
    - name: host-data
      mountPath: /source
      readOnly: true
  volumes:
  - name: config
    persistentVolumeClaim:
      claimName: radarr-config
  - name: host-data
    hostPath:
      path: $SOURCE_DATA_PATH
      type: Directory
  nodeSelector:
    # This assumes the data is on a specific node
    # Adjust as needed for your setup
    kubernetes.io/hostname: "$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')"
EOF

    # Wait for pod to be ready
    log "INFO" "Waiting for migration pod to be ready..."
    kubectl wait --for=condition=Ready pod/$MIGRATION_POD_NAME -n "$NAMESPACE" --timeout=120s
    
    log "SUCCESS" "Migration pod created and ready"
}

# Function to perform data migration
migrate_data() {
    log "INFO" "Starting data migration..."
    
    # List source files
    log "INFO" "Source files to migrate:"
    kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- find /source -type f -name "*.xml" -o -name "*.db" | head -10
    
    # Copy essential files
    log "INFO" "Copying configuration files..."
    
    # Create config directory if it doesn't exist
    kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- mkdir -p /config
    
    # Copy config.xml (main configuration)
    if kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- test -f /source/config.xml; then
        kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- cp /source/config.xml /config/
        log "SUCCESS" "Copied config.xml"
    else
        log "WARNING" "config.xml not found in source directory"
    fi
    
    # Copy database files
    for db_file in "radarr.db" "logs.db"; do
        if kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- test -f "/source/$db_file"; then
            kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- cp "/source/$db_file" /config/
            log "SUCCESS" "Copied $db_file"
        else
            log "WARNING" "$db_file not found in source directory"
        fi
    done
    
    # Set proper ownership (LinuxServer.io containers run as 1000:1000)
    log "INFO" "Setting proper file ownership..."
    kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- chown -R 1000:1000 /config
    
    # List migrated files
    log "INFO" "Files successfully migrated:"
    kubectl exec $MIGRATION_POD_NAME -n "$NAMESPACE" -- ls -la /config/
    
    log "SUCCESS" "Data migration completed"
}

# Function to cleanup migration pod
cleanup_migration_pod() {
    log "INFO" "Cleaning up migration pod..."
    kubectl delete pod $MIGRATION_POD_NAME -n "$NAMESPACE" --ignore-not-found=true
    log "SUCCESS" "Migration pod cleaned up"
}

# Function to restart Radarr deployment
restart_radarr() {
    log "INFO" "Restarting Radarr deployment to pick up migrated data..."
    kubectl rollout restart deployment/radarr -n "$NAMESPACE"
    kubectl rollout status deployment/radarr -n "$NAMESPACE"
    log "SUCCESS" "Radarr deployment restarted"
}

# Main migration function
main() {
    log "INFO" "Starting Radarr data migration..."
    log "INFO" "Source: $SOURCE_DATA_PATH"
    log "INFO" "Target: Kubernetes PVC radarr-config in namespace $NAMESPACE"
    
    echo
    log "WARNING" "This will copy data from the Docker Compose volume to Kubernetes PVC"
    log "WARNING" "Make sure the Radarr Helm chart has been deployed first"
    read -p "Do you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log "INFO" "Migration cancelled"
        exit 0
    fi
    
    # Perform migration steps
    check_prerequisites
    create_migration_pod
    
    # Trap to ensure cleanup happens even if script fails
    trap cleanup_migration_pod EXIT
    
    migrate_data
    cleanup_migration_pod
    trap - EXIT  # Remove trap since cleanup is done
    
    restart_radarr
    
    log "SUCCESS" "Migration completed successfully!"
    echo
    log "INFO" "Next steps:"
    log "INFO" "1. Check that Radarr is accessible at https://radarr.lilnas.io"
    log "INFO" "2. Verify your movie library is intact"
    log "INFO" "3. Test download client and indexer connections"
    log "INFO" "4. Original data is preserved at: $SOURCE_DATA_PATH"
}

# Execute main function
main "$@"