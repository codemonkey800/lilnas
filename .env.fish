nvm use

function get_root_dir
  dirname (status --current-filename)
end

function get_app_name
  set root_dir (get_root_dir)
  set app_name (string match -r "$root_dir/(.*)(/.*)?" (pwd))[2]

  echo $app_name
end

function sync-dev-files
  set root_dir (get_root_dir)
  set app_name (get_app_name)

  if test "$app_name" = ''
    echo "Could not determine app name"
    return 1
  end

  set ignore_files 'js,ts,jsx,tsx,json,yml'
  set copy_args "--delete --exclude .git --exclude node_modules $root_dir/$app_name/ lilnas.io:./dev/$app_name/"

  nodemon \
    --watch $root_dir \
    --ext $ignore_files \
    --exec "fish -c 'copy $copy_args'"
end
