#!/usr/bin/env fish

# Script directory - use realpath for proper resolution
set -g SCRIPT_DIR (dirname (realpath (status --current-filename)))

# Function to print error messages to stderr
function error
    set_color red
    echo "Error: $argv[1]" >&2
    set_color normal
    exit 1
end

# Function to print usage
function usage
    echo "Usage: ./lilnas.fish <command> [options]

Commands:
    list                    List all services in the monorepo
    up                      Bring up services with docker-compose up -d
    down                    Bring down services with docker-compose down --rmi all -v

Options:
    --apps                  Target only package services (from packages/*)
    --services              Target only infrastructure services (from infra/*)

Examples:
    # List services
    ./lilnas.fish list
    ./lilnas.fish list --apps
    ./lilnas.fish list --services

    # Bring up services
    ./lilnas.fish up                          # All services
    ./lilnas.fish up --apps                   # All package services
    ./lilnas.fish up --services               # All infra services
    ./lilnas.fish up tdr-bot download         # Specific services

    # Bring down services
    ./lilnas.fish down                        # All services
    ./lilnas.fish down --apps                 # All package services
    ./lilnas.fish down --services             # All infra services
    ./lilnas.fish down tdr-bot download       # Specific services"
    exit 0
end

# Function to extract services from a compose file
function get_services_from_file
    set -l file $argv[1]
    docker-compose -f "$file" config --services 2>/dev/null
end

# Function to list services from package deploy files
function list_package_services
    set -l packages_dir "$SCRIPT_DIR/packages"

    if not test -d "$packages_dir"
        error "Packages directory not found: $packages_dir"
    end

    for package_dir in $packages_dir/*
        if test -d "$package_dir"
            set -l deploy_file "$package_dir/deploy.yml"
            if test -f "$deploy_file"
                get_services_from_file "$deploy_file"
            end
        end
    end
end

# Function to list services from infra files
function list_infra_services
    set -l infra_dir "$SCRIPT_DIR/infra"
    set -l compose_file "$SCRIPT_DIR/docker-compose.yml"

    if not test -d "$infra_dir"
        error "Infra directory not found: $infra_dir"
    end

    if not test -f "$compose_file"
        error "docker-compose.yml not found: $compose_file"
    end

    # Parse docker-compose.yml to get only the included infra files
    set -l included_files (grep -A 20 '^include:' "$compose_file" | grep '^\s*-\s*\./infra/.*\.yml' | sed 's/^\s*-\s*//' | sed 's/^\.\///')

    # Iterate over only the included infra files
    for infra_file in $included_files
        set -l full_path "$SCRIPT_DIR/$infra_file"
        if test -f "$full_path"
            get_services_from_file "$full_path"
        end
    end
end

# Function to get the compose file path
function get_compose_file
    echo "$SCRIPT_DIR/docker-compose.yml"
end

# Main command handler for list
function cmd_list
    argparse 'apps' 'services' -- $argv
    or begin
        error "Invalid options for list command"
    end

    set -l show_apps false
    set -l show_services false

    if set -q _flag_apps
        set show_apps true
    end

    if set -q _flag_services
        set show_services true
    end

    # If no flags specified, show both
    if test "$show_apps" = false -a "$show_services" = false
        set show_apps true
        set show_services true
    end

    # List services based on flags
    if test "$show_apps" = true
        list_package_services
    end

    if test "$show_services" = true
        list_infra_services
    end
end

# Command handler for bringing services up
function cmd_up
    argparse 'apps' 'services' -- $argv
    or begin
        error "Invalid options for up command"
    end

    set -l show_apps false
    set -l show_services false
    set -l specific_services $argv

    if set -q _flag_apps
        set show_apps true
    end

    if set -q _flag_services
        set show_services true
    end

    # Validate: can't mix flags with specific services
    if test (count $specific_services) -gt 0 -a \( "$show_apps" = true -o "$show_services" = true \)
        error "Cannot specify both --apps/--services flags and specific service names"
    end

    # Validate: can't use both --apps and --services
    if test "$show_apps" = true -a "$show_services" = true
        error "Cannot specify both --apps and --services flags"
    end

    set -l compose_file (get_compose_file)
    set -l services_to_start

    # Determine which services to start
    if test "$show_apps" = true
        set services_to_start (list_package_services)
    else if test "$show_services" = true
        set services_to_start (list_infra_services)
    else if test (count $specific_services) -gt 0
        set services_to_start $specific_services
    end

    # Execute docker-compose up
    if test (count $services_to_start) -gt 0
        echo "Bringing up services: $services_to_start"
        docker-compose -f "$compose_file" up -d $services_to_start
    else
        echo "Bringing up all services"
        docker-compose -f "$compose_file" up -d
    end
end

# Command handler for bringing services down
function cmd_down
    argparse 'apps' 'services' -- $argv
    or begin
        error "Invalid options for down command"
    end

    set -l show_apps false
    set -l show_services false
    set -l specific_services $argv

    if set -q _flag_apps
        set show_apps true
    end

    if set -q _flag_services
        set show_services true
    end

    # Validate: can't mix flags with specific services
    if test (count $specific_services) -gt 0 -a \( "$show_apps" = true -o "$show_services" = true \)
        error "Cannot specify both --apps/--services flags and specific service names"
    end

    # Validate: can't use both --apps and --services
    if test "$show_apps" = true -a "$show_services" = true
        error "Cannot specify both --apps and --services flags"
    end

    set -l compose_file (get_compose_file)
    set -l services_to_stop

    # Determine which services to stop
    if test "$show_apps" = true
        set services_to_stop (list_package_services)
    else if test "$show_services" = true
        set services_to_stop (list_infra_services)
    else if test (count $specific_services) -gt 0
        set services_to_stop $specific_services
    end

    # Execute docker-compose down
    if test (count $services_to_stop) -gt 0
        echo "Bringing down services: $services_to_stop"
        docker-compose -f "$compose_file" down --rmi all -v $services_to_stop
    else
        echo "Bringing down all services"
        docker-compose -f "$compose_file" down --rmi all -v
    end
end

# Main entry point
function main
    # Check for docker-compose
    if not command -v docker-compose &>/dev/null
        error "docker-compose is not installed or not in PATH"
    end

    # No arguments - show help
    if test (count $argv) -eq 0
        usage
    end

    # Parse command
    set -l command $argv[1]
    set -e argv[1]

    switch $command
        case list
            cmd_list $argv
        case up
            cmd_up $argv
        case down
            cmd_down $argv
        case -h --help help
            usage
        case '*'
            error "Unknown command: $command. Use --help for usage information."
    end
end

main $argv
