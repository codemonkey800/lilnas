nvm use

function __get_root_dir
  dirname (status --current-filename)
end

function __get_app_name
  set root_dir (get_root_dir)
  set app_name (string match -r "$root_dir/(.*)(/.*)?" (pwd))[2]

  echo $app_name
end

function sync-dev-files
  set root_dir (__get_root_dir)
  set app_name (__get_app_name)
  set watch false

  for arg in $argv
    switch $arg
      case '-w' '--watch'
        set watch true
    end
  end

  if test "$app_name" = ''
    echo "Could not determine app name"
    return 1
  end

  set watch_files 'js,ts,jsx,tsx,json,yml'
  set copy_args "--delete --exclude .git --exclude node_modules $root_dir/$app_name/ lilnas.io:./dev/$app_name/"

  if not $watch
    fish -c "copy $copy_args"
    return
  end

  nodemon \
    --watch $root_dir \
    --ext $watch_files \
    --exec "fish -c 'copy $copy_args'"
end
