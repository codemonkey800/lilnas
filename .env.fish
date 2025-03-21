nvm use

function lilnas
  tsx \
    --tsconfig packages/cli/tsconfig.json \
    packages/cli/src/main \
    $argv
end
