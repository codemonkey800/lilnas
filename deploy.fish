#!/usr/bin/env fish

function down
  dc down --rmi all -v $argv
end

function up
  dc up -d $argv
end

function redeploy
  down $argv
  up $argv
end

function deploy
  switch $argv[1]
    case 'down' 'up' 'redeploy'
      $argv[1] $argv[2..-1]
    case '*'
      echo './deploy.fish [up|down|redeploy]'
      return
  end
end

deploy $argv
