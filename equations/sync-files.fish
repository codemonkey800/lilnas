#!/usr/bin/env fish

function sync_files
  set ignore_files 'js,ts,jsx,tsx,json,yml'
  set copy_args '--delete --exclude .git --exclude node_modules . lilnas.io:./dev/equations/'

  nodemon \
    --watch . \
    --ext $ignore_files \
    --exec "fish -c 'copy $copy_args'"
end

sync_files
