-- Backfill: derive `videos` rows and `jobs.media_id` from the legacy wide
-- `jobs` row (plan §2.3). `job_video_key` computes the natural-key
-- expression exactly once; both statements below join through it rather
-- than repeating the expression, so the two can't drift out of sync.
CREATE TEMP VIEW job_video_key AS
SELECT
  id,
  url,
  time_range,
  title,
  description,
  download_urls,
  created_at,
  updated_at,
  url || '#' || COALESCE(json_extract(time_range, '$.start'), '')
      || '-' || COALESCE(json_extract(time_range, '$.end'), '') AS natural_key
FROM jobs
WHERE type = 'video';
--> statement-breakpoint
-- One videos row per distinct (url, time range). Two jobs that downloaded
-- the same clip collapse onto one row; created_at is the earliest job's.
INSERT INTO videos (id, natural_key, source_url, time_range, title, overview, download_urls, created_at, updated_at)
SELECT
  lower(hex(randomblob(12))),
  natural_key,
  MIN(url),
  MAX(time_range),
  COALESCE(MAX(title), MIN(url)), -- title is NOT NULL
  MAX(description),
  MAX(download_urls),
  MIN(created_at),
  MAX(updated_at)
FROM job_video_key
GROUP BY natural_key;
--> statement-breakpoint
UPDATE jobs SET media_id = CASE type
  WHEN 'movie' THEN 'tmdb:' || substr(url, length('radarr://tmdb/') + 1)
  WHEN 'show'  THEN 'tvdb:' || substr(url, length('sonarr://tvdb/') + 1)
  ELSE (
    SELECT 'video:' || v.id
    FROM job_video_key jvk
    JOIN videos v ON v.natural_key = jvk.natural_key
    WHERE jvk.id = jobs.id
  )
END;
--> statement-breakpoint
DROP VIEW job_video_key;
