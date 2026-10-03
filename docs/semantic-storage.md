# Storage Architecture

This document describes the semantic storage layout used by the lilnas server. Every alias under `/storage/` names what is inside it, and (except `files`) points at the root of one drive.

## Layout

All data drives are single-device btrfs filesystems mounted at `/mnt/<drive>` via `/etc/fstab`. Each `/storage/<alias>` is a symlink to a drive root, e.g. `/storage/tv -> /mnt/hdd2`.

| Alias                 | Drive  | Size | Contents                                                     | Backup class                     |
| --------------------- | ------ | ---- | ------------------------------------------------------------ | -------------------------------- |
| `/storage/movies`     | `hdd1` | 19T  | Movies (one folder per title, at the drive root)             | Replaceable                      |
| `/storage/tv`         | `hdd2` | 19T  | TV series (one folder per series, at the drive root)         | Replaceable                      |
| `/storage/backups`    | `hdd3` | 22T  | Plain copies of `photos` (and later `app-data`)              | Backup target                    |
| `/storage/snapshots`  | `hdd4` | 22T  | Reserved for btrfs snapshot history (btrbk). Empty today     | Backup target                    |
| `/storage/archive`    | `hdd5` | 22T  | Game-server backups, second copy of recordings, iCloud tools | Archive                          |
| `/storage/spare-1`    | `hdd6` | 5.5T | Empty                                                        | None                             |
| `/storage/spare-2`    | `hdd7` | 5.5T | Empty                                                        | None                             |
| `/storage/recordings` | `hdd8` | 22T  | Gameplay captures (`win1/`, `win3/`)                         | Irreplaceable, copy in `archive` |
| `/storage/photos`     | `ssd1` | 3.7T | Photo libraries and Immich state                             | Irreplaceable, copy in `backups` |
| `/storage/app-data`   | `ssd2` | 1.9T | One folder per service, including MinIO (`minio/`)           | Important                        |
| `/storage/downloads`  | `ssd3` | 3.7T | `active/` and `completed/` download folders                  | None (temporary)                 |
| `/storage/workspace`  | `ssd4` | 3.7T | Fast scratch area for edits and re-encodes. Empty today      | None (disposable)                |

`/storage/files` is the exception: a real directory on the root NVMe, served by copyparty at `files.lilnas.io`. It is not a drive alias.

## Conventions

- **One alias = one drive = one dataset**, and the alias points at the drive root. `/etc/fstab` is never touched, so drives keep their `/mnt/hddN` / `/mnt/ssdN` identity. `backups` and `archive` intentionally hold several named folders.
- **Container paths never change.** Only the host side of a `volumes:` line names an alias. Sonarr, Radarr, Emby and the download app all see `/tv` and `/movies`, so renaming or moving a drive needs no app reconfiguration.
- **Names say what is inside**: lowercase, hyphenated, no tier numbers. An unassigned drive is `spare-N` and gets renamed with one `ln -sfn` the day it gets a job.
- **Operate on `/mnt/<drive>` paths when copying or deleting**, never through `/storage/<alias>`. `rm -rf /storage/x/` follows the symlink into the drive, and `rm /storage/x` removes the link.
- **Docker resolves the symlink when a container is created.** Repointing a symlink does nothing for a running container; change the compose path and recreate it.

## Aliases

### Application state

#### `/storage/app-data/` (`ssd2`)

- **Purpose:** Configuration, databases and runtime data, one folder per service
- **Access pattern:** High-frequency read/write
- **Used by:** MinIO (`minio/`), Traefik/Let's Encrypt (`letsencrypt/`), forward auth (`lilnas-auth/`), Sonarr, Radarr, Emby, SABnzbd, the download app, tdr-bot and its database, Prometheus, Grafana, Loki, Promtail, Yacht, RustDesk, and the game servers (Minecraft, Palworld, Valheim, L4D2)

#### `/storage/workspace/` (`ssd4`)

- **Purpose:** Fast, fully disposable working space (for example re-encoding the recordings)
- **Used by:** Nothing yet. Never put state here that is not reproducible

### Media

#### `/storage/movies/` (`hdd1`) and `/storage/tv/` (`hdd2`)

- **Purpose:** The movie and TV libraries, each alone on its own drive
- **Access pattern:** Read-heavy, sequential
- **Used by:** Emby (`/tv`, `/movies`), Sonarr (`/tv`), Radarr (`/movies`), and the download app (both, read-only)
- **Note:** Sonarr and Radarr store container paths (`/tv/…`, `/movies/…`), so keep the container side of these mounts unchanged

#### `/storage/downloads/` (`ssd3`)

- **Purpose:** Download management
- **Structure:** `active/` (in progress, mounted as `/incomplete-downloads`) and `completed/` (mounted as `/downloads`)
- **Used by:** SABnzbd, Sonarr, Radarr

### Photos

#### `/storage/photos/` (`ssd1`)

- **Purpose:** Photo and video libraries
- **Structure:** `icloud/`, `icloud-mom/`, `google-photos/`, `home-movies/`, `insta-go-3/`, and `immich/` (`upload/`, `model-cache/`, `db/`)
- **Used by:** Immich (server, machine learning, database). The four original-library folders are mounted read-only

### Recordings

#### `/storage/recordings/` (`hdd8`)

- **Purpose:** Gameplay captures (`win1/`, `win3/`, ~2.4 TB)
- **Access pattern:** Written rarely, read for editing
- **Used by:** Nothing mounts it. A second verified copy lives at `/storage/archive/recordings/`

### File sharing

#### `/storage/files/` (root NVMe)

- **Purpose:** User-uploaded files served by copyparty
- **Used by:** copyparty (`files.lilnas.io`)

### Backups and archive

#### `/storage/backups/` (`hdd3`)

- **Purpose:** Plain copies of datasets that live on SSDs
- **Contents today:** `photos/`, a manual copy of `/storage/photos` that is behind the live data. There is no `app-data` copy yet
- **Planned:** refresh `photos/` on a schedule and add an `app-data` copy

#### `/storage/snapshots/` (`hdd4`)

- **Purpose:** btrfs snapshot history of `photos` and `app-data`, taken with btrbk
- **Status:** Reserved and empty. The data drives are mounted at the top-level subvolume, so btrbk needs either a top-level snapshot or the data moved into named subvolumes first

#### `/storage/archive/` (`hdd5`)

- **Purpose:** Long-term, write-once storage
- **Contents:** `valheim/` and `palworld/` world backups, `minecraft-sevtech-backup-20250816.7z`, `recordings/` (second copy of the captures), `icloud-tools/` (restore scripts for the old iCloud export)
- **Used by:** Valheim (`/config/backups`) and Palworld (`/palworld/backups/`)

### Spare drives

`/storage/spare-1/` (`hdd6`) and `/storage/spare-2/` (`hdd7`) are empty. Rename either with one `ln -sfn /mnt/<drive> /storage/<new-name>` when it gets a job.

## Volume Mapping Reference

Taken from the compose files under `infra/` and `apps/*/deploy*.yml`.

### Media stack (`infra/media.yml`)

```yaml
sonarr:
  - /storage/app-data/sonarr:/config
  - /storage/tv:/tv
  - /storage/downloads/completed:/downloads

radarr:
  - /storage/app-data/radarr:/config
  - /storage/movies:/movies
  - /storage/downloads/completed:/downloads

sabnzbd:
  - /storage/app-data/sabnzbd:/config
  - /storage/downloads/completed:/downloads
  - /storage/downloads/active:/incomplete-downloads

emby:
  - /storage/app-data/emby:/config
  - /storage/tv:/tv
  - /storage/movies:/movies
```

### Download app (`apps/download/deploy.yml`, `deploy.dev.yml`)

```yaml
- /storage/app-data/download:/data # production only
- /storage/movies:/movies:ro
- /storage/tv:/tv:ro
```

### Shared infrastructure

```yaml
# infra/shared.yml and infra/shared.dev.yml — MinIO (prod and dev share the same directory)
- /storage/app-data/minio:/data

# infra/proxy.yml — Traefik
- /storage/app-data/letsencrypt:/letsencrypt

# infra/files.yml — copyparty
- /storage/files:/w
```

### Photos (`infra/immich.yml`)

```yaml
- /storage/photos/immich/upload:/usr/src/app/upload
- /storage/photos/google-photos:/google-photos:ro
- /storage/photos/home-movies:/home-movies:ro
- /storage/photos/icloud:/icloud:ro
- /storage/photos/icloud-mom:/icloud-mom:ro
- /storage/photos/immich/model-cache:/cache
- /storage/photos/immich/db:/var/lib/postgresql/data
```

### Monitoring (`infra/monitoring.yml`)

```yaml
- /storage/app-data/prometheus:/prometheus
- /storage/app-data/grafana:/var/lib/grafana
- /storage/app-data/loki:/loki
- /storage/app-data/promtail:/positions
- /storage/app-data/yacht:/config
```

### Game servers

```yaml
# infra/minecraft.yml
- /storage/app-data/minecraft:/data

# infra/palworld.yml
- /storage/app-data/palworld/:/palworld/
- /storage/archive/palworld/v2.7.1/:/palworld/backups/

# infra/valheim.yml
- /storage/app-data/valheim/config:/config
- /storage/app-data/valheim/data:/opt/valheim
- /storage/archive/valheim:/config/backups

# infra/l4d2.yml
- /storage/app-data/l4d2/:/l4d2/server/
```

### Apps (`apps/*/deploy.yml`)

```yaml
- /storage/app-data/lilnas-auth:/data
- /storage/app-data/tdr-bot-db:/var/lib/postgresql/data
- /storage/app-data/tdr-code:/data
- /storage/app-data/swole:/data
```

## Best Practices

### Choosing a location

1. **Service state:** `/storage/app-data/<service>/` for configuration and databases
2. **Media:** `/storage/movies/` and `/storage/tv/`; temporary downloads go in `/storage/downloads/`
3. **Fast scratch:** `/storage/workspace/` for anything disposable that benefits from SSD speed
4. **Personal data:** `/storage/photos/`, backed up to `/storage/backups/`
5. **Long-term copies:** `/storage/archive/`

### Backup strategy

- **Irreplaceable** (photos, recordings): keep at least two verified copies on separate drives. Recordings already have this (`recordings` and `archive/recordings`); photos have a live copy plus a manual one in `backups`
- **Important** (`app-data`): to be copied to `backups` and snapshotted to `snapshots` (not set up yet)
- **Replaceable** (movies, TV): no backup
- **Temporary** (downloads, workspace): no backup

### Moving or deleting data

- Copy with `rsync -aHAX` between drives, then verify with a checksum dry run (`rsync -rcn --delete -i SRC/ DST/`) for anything irreplaceable. The result must be empty
- Quarantine by renaming into a dot-prefixed `.trash-<date>/` folder first (Emby, Sonarr and Radarr ignore it), then delete after the services have stayed healthy for a day
- Delete only through the `/mnt/<drive>` path, with `rm -rf --one-file-system`

### Storage planning

When adding new services, consider:

1. Data criticality and backup requirements
2. Access patterns (read/write frequency)
3. Performance requirements (SSD vs HDD)
4. Growth projections
5. Data lifecycle (temporary vs permanent)

## History

On 2026-09-29 to 2026-10-03 the tier-based names (`media-library`, `media-overflow`, `backup-tier1`, `backup-tier2`, `backup-archive`, `cold-storage`, `expansion`, `fast-staging`) were replaced by the names above, three datasets were moved onto drives that fit them (recordings to `hdd8`, TV to `hdd2`, MinIO into `app-data`), and 2.4 TB of duplicate recordings were removed. See `docs/plans/001-semantic-storage-rename.md`.
