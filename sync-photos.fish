#!/usr/bin/env fish

function sync_photos -a email
end

function print_help
  set script (status -f)

  echo "Usage: $script --email=<email> --src=<src> --dest=<dest>"
  echo
  echo 'Options:'
  echo '  --email=<email>  iCloud email address'
  echo '  --dest=<dest>    Destination directory'
end

function get_value
  echo (string split -- '=' "$argv")[2]
end

function main
  set email
  set dest

  for arg in $argv
    switch "$arg"
      case '--email=*'
        set email (get_value $arg)

      case '--dest=*'
        set dest (get_value $arg)

      case '--help'
        print_help
        return

      case '*'
        echo "Unknown option: $arg"
        echo
        print_help
        return -1
    end
  end

  if test "$email" = '' -o "$dest" = ''
    print_help
    return -1
  end

  do run -it --rm \
    --name icloudpd \
    -v $dest:/icloud \
    -e TZ=America/Los_Angeles \
    icloudpd/icloudpd \
    icloudpd --directory /icloud --username $email
end

main $argv
