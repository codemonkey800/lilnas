#!/usr/bin/env fish

function copy_files
  copy --exclude node_modules . lilnas:lilnas
end

function sync-with-server
  if test "$argv[1]" != '--watch'
    copy_files
    return
  end

  echo 'watching'
end

sync-with-server $argv

