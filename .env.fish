nvm use >/dev/null 2>&1

function lilnas
    set -l root_dir (git rev-parse --show-toplevel 2>/dev/null)
    set -l lilnas_script $root_dir/lilnas.fish
    $lilnas_script $argv
end
