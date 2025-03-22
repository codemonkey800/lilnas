nvm use

function lilnas
  set repo_dir (git rev-parse --show-toplevel)

  tsx \
    --tsconfig $repo_dir/packages/cli/tsconfig.json \
    $repo_dir/packages/cli/src/main \
    $argv
end
