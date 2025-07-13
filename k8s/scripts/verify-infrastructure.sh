#!/usr/bin/env bash
#
# Comprehensive infrastructure verification script
# Validates all k8s manifests and infrastructure components
#
# Usage: verify-infrastructure.sh [options]
#
# Options:
#   -h, --help        Show this help message
#   -v, --verbose     Enable verbose output
#   -d, --dry-run     Show what would be done without executing
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$SCRIPT_DIR")"

# Source common functions
source "${SCRIPT_DIR}/lib/common.sh"

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test results
declare -a FAILED_TEST_NAMES=()

# Portable timeout function
portable_timeout() {
    local timeout_duration="$1"
    local command="$2"
    
    if command -v timeout &> /dev/null; then
        timeout "$timeout_duration" bash -c "$command"
    elif command -v gtimeout &> /dev/null; then
        gtimeout "$timeout_duration" bash -c "$command"
    else
        # Fallback without timeout
        bash -c "$command"
    fi
}

# Override log functions from common.sh to include test counters
log_success() {
    echo -e "${COLOR_GREEN}✅ $1${COLOR_RESET}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
}

log_error() {
    echo -e "${COLOR_RED}❌ $1${COLOR_RESET}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    FAILED_TEST_NAMES+=("$1")
}

log_section() {
    echo -e "\n${COLOR_CYAN}🔍 $1${COLOR_RESET}"
    echo "================================="
}

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    info "Testing: $test_name"
    
    # Add timeout to prevent hanging
    if portable_timeout 10 "$test_command" &> /dev/null; then
        log_success "$test_name"
        return 0
    else
        log_error "$test_name"
        return 1
    fi
}

# Verification functions
verify_prerequisites() {
    log_section "Prerequisites Check"
    
    # Check required commands
    local required_commands=("kubectl" "grep" "wc" "find")
    for cmd in "${required_commands[@]}"; do
        check_command "$cmd" || return 1
    done
    
    run_test "kubectl is installed" "command -v kubectl"
    
    # Use common function for kubectl check
    check_kubectl || return 1
    
    run_test "kubectl can list nodes" "kubectl get nodes"
    
    # Check if k3s is running
    if kubectl get nodes | grep -q "k3s"; then
        log_success "k3s cluster detected"
    else
        log_warning "Non-k3s cluster detected"
    fi
}

verify_yaml_syntax() {
    log_section "YAML Syntax Validation"
    
    # Find all YAML files
    local yaml_files=()
    while IFS= read -r -d '' file; do
        yaml_files+=("$file")
    done < <(find "$K8S_DIR" -name "*.yaml" -print0)
    
    if [ ${#yaml_files[@]} -eq 0 ]; then
        log_warning "No YAML files found in $K8S_DIR"
        return 0
    fi
    
    # Process each YAML file
    for file in "${yaml_files[@]}"; do
        local filename=$(basename "$file")
        run_test "YAML syntax: $filename" "kubectl apply --dry-run=client -f \"$file\" > /dev/null 2>&1"
    done
}

verify_namespaces() {
    log_section "Namespace Validation"
    
    local namespace_file="$K8S_DIR/namespaces/lilnas-namespaces.yaml"
    
    if [ ! -f "$namespace_file" ]; then
        log_error "Namespace file not found: $namespace_file"
        return 1
    fi
    
    # Test namespace creation (dry-run)
    run_test "Namespace manifest validation" "kubectl apply --dry-run=client -f \"$namespace_file\""
    
    # Check each namespace individually
    local namespaces=("lilnas-core" "lilnas-apps" "lilnas-media" "lilnas-monitoring" "lilnas-dev")
    for ns in "${namespaces[@]}"; do
        if kubectl get namespace "$ns" &> /dev/null; then
            log_success "Namespace exists: $ns"
        else
            log_error "Namespace missing: $ns"
        fi
    done
}

verify_storage() {
    log_section "Storage Validation"
    
    local storage_classes_file="$K8S_DIR/storage/storage-classes.yaml"
    local persistent_volumes_file="$K8S_DIR/storage/persistent-volumes.yaml"
    
    # Test storage class manifest
    if [ -f "$storage_classes_file" ]; then
        run_test "Storage classes manifest validation" "kubectl apply --dry-run=client -f \"$storage_classes_file\""
    else
        log_error "Storage classes file not found: $storage_classes_file"
    fi
    
    # Test persistent volumes manifest
    if [ -f "$persistent_volumes_file" ]; then
        run_test "Persistent volumes manifest validation" "kubectl apply --dry-run=client -f \"$persistent_volumes_file\""
    else
        log_error "Persistent volumes file not found: $persistent_volumes_file"
    fi
    
    # Check existing storage classes
    local storage_classes=("hdd-storage" "hdd-media-storage" "ssd-storage" "ssd-photos-storage")
    for sc in "${storage_classes[@]}"; do
        if kubectl get storageclass "$sc" &> /dev/null; then
            log_success "Storage class exists: $sc"
        else
            log_error "Storage class missing: $sc"
        fi
    done
    
    # Check persistent volumes count
    local pv_count=$(kubectl get pv --no-headers | wc -l)
    if [ "$pv_count" -ge 12 ]; then
        log_success "Persistent volumes count: $pv_count"
    else
        log_error "Expected at least 12 persistent volumes, found: $pv_count"
    fi
}

verify_secrets() {
    log_section "Secret Validation"
    
    local secret_template="$K8S_DIR/secrets/ghcr-secret-template.yaml"
    local deploy_script="$K8S_DIR/secrets/deploy-ghcr-secret.sh"
    
    # Check template file
    if [ -f "$secret_template" ]; then
        log_success "GHCR secret template exists"
    else
        log_error "GHCR secret template not found: $secret_template"
    fi
    
    # Check deploy script
    if [ -f "$deploy_script" ] && [ -x "$deploy_script" ]; then
        log_success "GHCR deploy script exists and is executable"
    else
        log_error "GHCR deploy script not found or not executable: $deploy_script"
    fi
    
    # Check existing secrets
    local namespaces=("default" "lilnas-apps" "lilnas-core" "lilnas-dev" "lilnas-media" "lilnas-monitoring")
    for ns in "${namespaces[@]}"; do
        if kubectl get secret ghcr-secret -n "$ns" &> /dev/null; then
            log_success "GHCR secret exists in namespace: $ns"
        else
            log_error "GHCR secret missing in namespace: $ns"
        fi
    done
}

verify_cert_manager() {
    log_section "cert-manager Validation"
    
    local clusterissuer_file="$K8S_DIR/cert-manager/letsencrypt-issuers.yaml"
    
    # Check ClusterIssuer manifest
    if [ -f "$clusterissuer_file" ]; then
        run_test "ClusterIssuer manifest validation" "kubectl apply --dry-run=client -f \"$clusterissuer_file\""
    else
        log_error "ClusterIssuer file not found: $clusterissuer_file"
    fi
    
    # Check cert-manager installation
    if kubectl get namespace cert-manager &> /dev/null; then
        log_success "cert-manager namespace exists"
    else
        log_error "cert-manager namespace missing"
    fi
    
    # Check cert-manager pods
    local cert_manager_pods=$(kubectl get pods -n cert-manager --no-headers | grep -c "Running" || echo "0")
    if [ "$cert_manager_pods" -ge 3 ]; then
        log_success "cert-manager pods running: $cert_manager_pods"
    else
        log_error "cert-manager pods not running properly: $cert_manager_pods"
    fi
    
    # Check ClusterIssuers
    local clusterissuers=("letsencrypt-prod" "letsencrypt-staging")
    for ci in "${clusterissuers[@]}"; do
        if kubectl get clusterissuer "$ci" &> /dev/null; then
            log_success "ClusterIssuer exists: $ci"
        else
            log_error "ClusterIssuer missing: $ci"
        fi
    done
}

verify_traefik() {
    log_section "Traefik Validation"
    
    # Check Traefik deployment
    if kubectl get pods -n kube-system | grep -q "traefik"; then
        log_success "Traefik pods found in kube-system"
    else
        log_error "Traefik pods not found in kube-system"
    fi
    
    # Check Traefik service
    if kubectl get svc -n kube-system | grep -q "traefik"; then
        log_success "Traefik service found in kube-system"
    else
        log_error "Traefik service not found in kube-system"
    fi
}

verify_integration() {
    log_section "Integration Tests"
    
    # Test PVC creation against storage classes
    log_info "Testing PVC creation against storage classes..."
    
    local test_pvc_yaml=$(cat <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc-verification
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: hdd-storage
EOF
)
    
    if echo "$test_pvc_yaml" | kubectl apply --dry-run=client -f - &> /dev/null; then
        log_success "PVC creation test (dry-run)"
    else
        log_error "PVC creation test failed"
    fi
    
    # Test secret structure
    if kubectl get secret ghcr-secret -n default -o jsonpath='{.type}' 2>/dev/null | grep -q "kubernetes.io/dockerconfigjson"; then
        log_success "GHCR secret has correct type"
    else
        log_error "GHCR secret type validation failed"
    fi
}

compare_with_cluster() {
    log_section "Cluster State Comparison"
    
    log_info "Comparing manifests with cluster state..."
    
    # Compare namespace count
    local manifest_ns_count=$(grep -c "kind: Namespace" "$K8S_DIR/namespaces/lilnas-namespaces.yaml" 2>/dev/null || echo "0")
    local cluster_ns_count=$(kubectl get namespaces | grep -c "lilnas-" || echo "0")
    
    if [ "$manifest_ns_count" -eq "$cluster_ns_count" ]; then
        log_success "Namespace count matches: $manifest_ns_count"
    else
        log_warning "Namespace count mismatch - Manifest: $manifest_ns_count, Cluster: $cluster_ns_count"
    fi
    
    # Compare storage class count  
    local manifest_sc_count=$(grep -c "kind: StorageClass" "$K8S_DIR/storage/storage-classes.yaml" 2>/dev/null || echo "0")
    local cluster_sc_count=$(kubectl get storageclass | grep -c -E "(hdd|ssd)" || echo "0")
    
    if [ "$manifest_sc_count" -eq "$cluster_sc_count" ]; then
        log_success "Storage class count matches: $manifest_sc_count"
    else
        log_warning "Storage class count mismatch - Manifest: $manifest_sc_count, Cluster: $cluster_sc_count"
    fi
    
    # Compare PV count
    local manifest_pv_count=$(grep -c "kind: PersistentVolume" "$K8S_DIR/storage/persistent-volumes.yaml" 2>/dev/null || echo "0")
    local cluster_pv_count=$(kubectl get pv --no-headers | wc -l)
    
    if [ "$manifest_pv_count" -eq "$cluster_pv_count" ]; then
        log_success "Persistent volume count matches: $manifest_pv_count"
    else
        log_warning "Persistent volume count mismatch - Manifest: $manifest_pv_count, Cluster: $cluster_pv_count"
    fi
}

generate_report() {
    log_section "Verification Report"
    
    echo -e "${COLOR_BLUE}📊 Test Summary${COLOR_RESET}"
    echo "Total Tests: $TOTAL_TESTS"
    echo -e "${COLOR_GREEN}Passed: $PASSED_TESTS${COLOR_RESET}"
    echo -e "${COLOR_RED}Failed: $FAILED_TESTS${COLOR_RESET}"
    
    if [ $TOTAL_TESTS -gt 0 ]; then
        local success_rate=$(( PASSED_TESTS * 100 / TOTAL_TESTS ))
        echo "Success Rate: $success_rate%"
    else
        echo "Success Rate: N/A (no tests run)"
    fi
    
    if [ $FAILED_TESTS -gt 0 ]; then
        echo -e "\n${COLOR_RED}Failed Tests:${COLOR_RESET}"
        for test_name in "${FAILED_TEST_NAMES[@]}"; do
            echo "  - $test_name"
        done
    fi
    
    echo -e "\n${COLOR_BLUE}Next Steps:${COLOR_RESET}"
    if [ $FAILED_TESTS -eq 0 ]; then
        echo "🎉 All tests passed! Infrastructure is properly configured."
        echo "You can proceed with application deployments."
    else
        echo "❗ Some tests failed. Please review the errors above."
        echo ""
        echo "Common troubleshooting steps:"
        echo "1. Ensure kubectl is properly configured and can connect to your cluster"
        echo "2. Check if required namespaces exist: kubectl get namespaces"
        echo "3. Verify storage classes are deployed: kubectl get storageclass"
        echo "4. Check cert-manager installation: kubectl get pods -n cert-manager"
        echo "5. Ensure GHCR secrets are deployed in all namespaces"
        echo ""
        echo "For detailed troubleshooting, check the README files in each subdirectory."
    fi
}

# Show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [options]

Comprehensive infrastructure verification script that validates all k8s manifests
and infrastructure components.

Options:
  -h, --help        Show this help message
  -v, --verbose     Enable verbose output
  -d, --dry-run     Show what would be done without executing

Examples:
  # Run standard verification
  $(basename "$0")
  
  # Run with verbose output
  $(basename "$0") -v

EOF
    show_common_flags_help
}

# Parse arguments
parse_args() {
    local remaining_args
    remaining_args=$(parse_common_flags "$@") || { show_usage; exit 0; }
    set -- $remaining_args
    
    if [[ $# -gt 0 ]]; then
        error "Unknown arguments: $*"
        show_usage
        exit 1
    fi
}

# Main execution
main() {
    echo -e "${COLOR_CYAN}🔍 lilnas Infrastructure Verification${COLOR_RESET}"
    echo "========================================"
    echo "Verifying all infrastructure components..."
    echo
    
    verify_prerequisites
    verify_yaml_syntax
    verify_namespaces
    verify_storage
    verify_secrets
    verify_cert_manager
    verify_traefik
    verify_integration
    compare_with_cluster
    
    echo
    generate_report
    
    # Exit with appropriate code
    if [ $FAILED_TESTS -eq 0 ]; then
        exit 0
    else
        exit 1
    fi
}

# Parse arguments and run main function
parse_args "$@"
main