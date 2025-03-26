function main
  set index 0
  for i in range

  # yt-dlp -f bestvideo+bestaudio $argv
  set video_files (find . -type f -iregex '.*\.\(mp4\|webm\|mkv\)' -exec echo {} \;)

  if test (count $video_files) -eq 0
    echo "No video files found"
    exit 1
  end

  set index 0
  for file in $video_files
    echo $file
  end
end

main $argv
