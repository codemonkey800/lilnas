# Fish shell completions for the lilnas CLI
# Install: lilnas completions --install
# Uninstall: lilnas completions --uninstall

# Disable file completions globally for lilnas
complete -c lilnas -f

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

# Returns all service names (app + infra) from the monorepo
function __lilnas_services
    lilnas list 2>/dev/null
end

# Returns app-only service names
function __lilnas_app_services
    lilnas list --apps 2>/dev/null
end

# Returns infra-only service names
function __lilnas_infra_services
    lilnas list --services 2>/dev/null
end

# True when no subcommand has been given yet
function __lilnas_no_subcommand
    not __fish_seen_subcommand_from \
        build dev down list ls logs ps redeploy up remote completions help
end

# All remote subcommands
set -l remote_subcommands build down logs ps redeploy up mounts

# True when we're completing a remote subcommand (i.e. "remote" was seen but no
# remote subcommand has been seen yet)
function __lilnas_completing_remote_sub
    __fish_seen_subcommand_from remote
    and not __fish_seen_subcommand_from $remote_subcommands
end

# True when inside a remote service command (remote + one of its subcommands
# that accepts service names)
function __lilnas_in_remote_service_cmd
    __fish_seen_subcommand_from remote
    and __fish_seen_subcommand_from build down logs ps redeploy up
end

# ---------------------------------------------------------------------------
# Top-level commands
# ---------------------------------------------------------------------------

complete -c lilnas -n __lilnas_no_subcommand -a build       -d "Build Docker images for services"
complete -c lilnas -n __lilnas_no_subcommand -a dev         -d "Start the dev server for the current app"
complete -c lilnas -n __lilnas_no_subcommand -a down        -d "Bring down services"
complete -c lilnas -n __lilnas_no_subcommand -a list        -d "List all services in the monorepo"
complete -c lilnas -n __lilnas_no_subcommand -a ls          -d "List all services (alias for list)"
complete -c lilnas -n __lilnas_no_subcommand -a logs        -d "Follow logs for services"
complete -c lilnas -n __lilnas_no_subcommand -a ps          -d "Show service status"
complete -c lilnas -n __lilnas_no_subcommand -a redeploy    -d "Redeploy services (down then up)"
complete -c lilnas -n __lilnas_no_subcommand -a up          -d "Bring up services"
complete -c lilnas -n __lilnas_no_subcommand -a remote      -d "Run commands on the remote server"
complete -c lilnas -n __lilnas_no_subcommand -a completions -d "Manage fish shell completions"
complete -c lilnas -n __lilnas_no_subcommand -a help        -d "Show help"

# ---------------------------------------------------------------------------
# remote subcommands
# ---------------------------------------------------------------------------

complete -c lilnas -n __lilnas_completing_remote_sub -a build    -d "Build Docker images on the remote server"
complete -c lilnas -n __lilnas_completing_remote_sub -a down     -d "Bring down services on the remote server"
complete -c lilnas -n __lilnas_completing_remote_sub -a logs     -d "Follow logs on the remote server"
complete -c lilnas -n __lilnas_completing_remote_sub -a ps       -d "Show service status on the remote server"
complete -c lilnas -n __lilnas_completing_remote_sub -a redeploy -d "Redeploy services on the remote server"
complete -c lilnas -n __lilnas_completing_remote_sub -a up       -d "Bring up services on the remote server"
complete -c lilnas -n __lilnas_completing_remote_sub -a mounts   -d "List or manage storage mounts on the remote server"

# ---------------------------------------------------------------------------
# Flags: service commands (build, down, logs, ps, redeploy, up)
# ---------------------------------------------------------------------------

set -l service_cmds build down logs ps redeploy up

complete -c lilnas -n "__fish_seen_subcommand_from $service_cmds; and not __fish_seen_subcommand_from remote" \
    -l apps -d "Target only app services (apps/*/deploy.yml)"
complete -c lilnas -n "__fish_seen_subcommand_from $service_cmds; and not __fish_seen_subcommand_from remote" \
    -l services -d "Target only infrastructure services (infra/*.yml)"
complete -c lilnas -n "__fish_seen_subcommand_from $service_cmds; and not __fish_seen_subcommand_from remote" \
    -l dry-run -d "Print the command without executing it"

# ---------------------------------------------------------------------------
# Flags: remote service commands (remote build, remote down, …)
# ---------------------------------------------------------------------------

complete -c lilnas -n __lilnas_in_remote_service_cmd \
    -l apps -d "Target only app services (apps/*/deploy.yml)"
complete -c lilnas -n __lilnas_in_remote_service_cmd \
    -l services -d "Target only infrastructure services (infra/*.yml)"
complete -c lilnas -n __lilnas_in_remote_service_cmd \
    -l dry-run -d "Print the SSH command without executing it"

# ---------------------------------------------------------------------------
# Flags: remote mounts
# ---------------------------------------------------------------------------

complete -c lilnas -n "__fish_seen_subcommand_from remote; and __fish_seen_subcommand_from mounts" \
    -l delete -d "Host path of the mount directory to delete on the remote server" -r
complete -c lilnas -n "__fish_seen_subcommand_from remote; and __fish_seen_subcommand_from mounts" \
    -l yes -s y -d "Skip confirmation prompt when deleting"
complete -c lilnas -n "__fish_seen_subcommand_from remote; and __fish_seen_subcommand_from mounts" \
    -l dry-run -d "Print the SSH commands without executing them"

# ---------------------------------------------------------------------------
# Flags: list / ls
# ---------------------------------------------------------------------------

complete -c lilnas -n "__fish_seen_subcommand_from list ls; and not __fish_seen_subcommand_from remote" \
    -l apps -d "List only app services"
complete -c lilnas -n "__fish_seen_subcommand_from list ls; and not __fish_seen_subcommand_from remote" \
    -l services -d "List only infrastructure services"

# ---------------------------------------------------------------------------
# Flags: completions
# ---------------------------------------------------------------------------

complete -c lilnas -n "__fish_seen_subcommand_from completions" \
    -l install -d "Install completions to ~/.config/fish/completions/"
complete -c lilnas -n "__fish_seen_subcommand_from completions" \
    -l uninstall -d "Remove installed completions"

# ---------------------------------------------------------------------------
# Dynamic service name completions
# ---------------------------------------------------------------------------

# Local service commands: complete positional args with service names
complete -c lilnas \
    -n "__fish_seen_subcommand_from $service_cmds; and not __fish_seen_subcommand_from remote" \
    -a "(__lilnas_services)"

# Remote service commands: complete positional args with service names
complete -c lilnas \
    -n __lilnas_in_remote_service_cmd \
    -a "(__lilnas_services)"

# ---------------------------------------------------------------------------
# Global flags (all commands)
# ---------------------------------------------------------------------------

complete -c lilnas -l help    -s h -d "Show help"
complete -c lilnas -l version -s v -d "Show CLI version"
