#!/usr/bin/env bash

set -euo pipefail

# Colors for error messages
RED='\033[0;31m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to print error messages to stderr
error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Function to print usage
usage() {
    cat << EOF
Usage: ./lilnas.sh <command> [options]

Commands:
    list                    List all services in the monorepo
    up                      Bring up services with docker-compose up -d
    down                    Bring down services with docker-compose down --rmi all -v

Options:
    --apps                  Target only package services (from packages/*)
    --services              Target only infrastructure services (from infra/*)

Examples:
    # List services
    ./lilnas.sh list
    ./lilnas.sh list --apps
    ./lilnas.sh list --services

    # Bring up services
    ./lilnas.sh up                          # All services
    ./lilnas.sh up --apps                   # All package services
    ./lilnas.sh up --services               # All infra services
    ./lilnas.sh up tdr-bot download         # Specific services

    # Bring down services
    ./lilnas.sh down                        # All services
    ./lilnas.sh down --apps                 # All package services
    ./lilnas.sh down --services             # All infra services
    ./lilnas.sh down tdr-bot download       # Specific services
EOF
    exit 0
}

# Function to extract services from a compose file
get_services_from_file() {
    local file=$1
    docker-compose -f "$file" config --services 2>/dev/null
}

# Function to list services from package deploy files
list_package_services() {
    local packages_dir="$SCRIPT_DIR/packages"

    if [[ ! -d "$packages_dir" ]]; then
        error "Packages directory not found: $packages_dir"
    fi

    for package_dir in "$packages_dir"/*; do
        if [[ -d "$package_dir" ]]; then
            local deploy_file="$package_dir/deploy.yml"
            if [[ -f "$deploy_file" ]]; then
                get_services_from_file "$deploy_file"
            fi
        fi
    done
}

# Function to list services from infra files
list_infra_services() {
    local infra_dir="$SCRIPT_DIR/infra"
    local compose_file="$SCRIPT_DIR/docker-compose.yml"

    if [[ ! -d "$infra_dir" ]]; then
        error "Infra directory not found: $infra_dir"
    fi

    if [[ ! -f "$compose_file" ]]; then
        error "docker-compose.yml not found: $compose_file"
    fi

    # Parse docker-compose.yml to get only the included infra files
    local included_files
    included_files=$(grep -A 20 '^include:' "$compose_file" | grep '^\s*-\s*\./infra/.*\.yml' | sed 's/^\s*-\s*//' | sed 's/^\.\///')

    # Iterate over only the included infra files
    while IFS= read -r infra_file; do
        local full_path="$SCRIPT_DIR/$infra_file"
        if [[ -f "$full_path" ]]; then
            get_services_from_file "$full_path"
        fi
    done <<< "$included_files"
}

# Function to get the compose file path
get_compose_file() {
    echo "$SCRIPT_DIR/docker-compose.yml"
}

# Main command handler
cmd_list() {
    local show_apps=false
    local show_services=false

    # Parse flags
    while [[ $# -gt 0 ]]; do
        case $1 in
            --apps)
                show_apps=true
                shift
                ;;
            --services)
                show_services=true
                shift
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done

    # If no flags specified, show both
    if [[ "$show_apps" == false && "$show_services" == false ]]; then
        show_apps=true
        show_services=true
    fi

    # List services based on flags
    if [[ "$show_apps" == true ]]; then
        list_package_services
    fi

    if [[ "$show_services" == true ]]; then
        list_infra_services
    fi
}

# Command handler for bringing services up
cmd_up() {
    local show_apps=false
    local show_services=false
    local specific_services=()

    # Parse flags and collect service names
    while [[ $# -gt 0 ]]; do
        case $1 in
            --apps)
                show_apps=true
                shift
                ;;
            --services)
                show_services=true
                shift
                ;;
            *)
                specific_services+=("$1")
                shift
                ;;
        esac
    done

    # Validate: can't mix flags with specific services
    if [[ ${#specific_services[@]} -gt 0 ]] && { [[ "$show_apps" == true ]] || [[ "$show_services" == true ]]; }; then
        error "Cannot specify both --apps/--services flags and specific service names"
    fi

    # Validate: can't use both --apps and --services
    if [[ "$show_apps" == true ]] && [[ "$show_services" == true ]]; then
        error "Cannot specify both --apps and --services flags"
    fi

    local compose_file
    compose_file=$(get_compose_file)

    local services_to_start=()

    # Determine which services to start
    if [[ "$show_apps" == true ]]; then
        mapfile -t services_to_start < <(list_package_services)
    elif [[ "$show_services" == true ]]; then
        mapfile -t services_to_start < <(list_infra_services)
    elif [[ ${#specific_services[@]} -gt 0 ]]; then
        services_to_start=("${specific_services[@]}")
    fi

    # Execute docker-compose up
    if [[ ${#services_to_start[@]} -gt 0 ]]; then
        echo "Bringing up services: ${services_to_start[*]}"
        docker-compose -f "$compose_file" up -d "${services_to_start[@]}"
    else
        echo "Bringing up all services"
        docker-compose -f "$compose_file" up -d
    fi
}

# Command handler for bringing services down
cmd_down() {
    local show_apps=false
    local show_services=false
    local specific_services=()

    # Parse flags and collect service names
    while [[ $# -gt 0 ]]; do
        case $1 in
            --apps)
                show_apps=true
                shift
                ;;
            --services)
                show_services=true
                shift
                ;;
            *)
                specific_services+=("$1")
                shift
                ;;
        esac
    done

    # Validate: can't mix flags with specific services
    if [[ ${#specific_services[@]} -gt 0 ]] && { [[ "$show_apps" == true ]] || [[ "$show_services" == true ]]; }; then
        error "Cannot specify both --apps/--services flags and specific service names"
    fi

    # Validate: can't use both --apps and --services
    if [[ "$show_apps" == true ]] && [[ "$show_services" == true ]]; then
        error "Cannot specify both --apps and --services flags"
    fi

    local compose_file
    compose_file=$(get_compose_file)

    local services_to_stop=()

    # Determine which services to stop
    if [[ "$show_apps" == true ]]; then
        mapfile -t services_to_stop < <(list_package_services)
    elif [[ "$show_services" == true ]]; then
        mapfile -t services_to_stop < <(list_infra_services)
    elif [[ ${#specific_services[@]} -gt 0 ]]; then
        services_to_stop=("${specific_services[@]}")
    fi

    # Execute docker-compose down
    if [[ ${#services_to_stop[@]} -gt 0 ]]; then
        echo "Bringing down services: ${services_to_stop[*]}"
        docker-compose -f "$compose_file" down --rmi all -v "${services_to_stop[@]}"
    else
        echo "Bringing down all services"
        docker-compose -f "$compose_file" down --rmi all -v
    fi
}

# Main entry point
main() {
    # Check for docker-compose
    if ! command -v docker-compose &> /dev/null; then
        error "docker-compose is not installed or not in PATH"
    fi

    # No arguments - show help
    if [[ $# -eq 0 ]]; then
        usage
    fi

    # Parse command
    local command=$1
    shift

    case $command in
        list)
            cmd_list "$@"
            ;;
        up)
            cmd_up "$@"
            ;;
        down)
            cmd_down "$@"
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            error "Unknown command: $command. Use --help for usage information."
            ;;
    esac
}

main "$@"
