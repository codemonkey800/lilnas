#!/usr/bin/env fish

function sync_files
  set repo_dir (gr)
  set watch false

  for arg in $argv
    switch $arg
      case '-w' '--watch'
        set watch true
        break
    end
  end

  if $watch
    nodemon -e '*' -x "fish -c 'copy $repo_dir/ lilnas.io:./lilnas/'"
    return
  end

  copy $repo_dir/ lilnas.io:./lilnas/
end

sync_files $argv
