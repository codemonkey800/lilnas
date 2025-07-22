# Storage Architecture

This document describes the semantic storage directory structure used by the lilnas server. These directories are organized based on their purpose, access patterns, and data lifecycle requirements.

## Storage Directory Structure

The server uses the following storage directories under `/storage/`:

### Active Application Data

#### `/storage/app-data/`

- **Purpose:** Application configuration, databases, and runtime data
- **Access Pattern:** High frequency read/write
- **Backup Priority:** High (Tier 1)
- **Used By:**
  - MinIO server data (`minio-data/`)
  - Traefik SSL certificates (`traefik/acme.json`)
  - Forward Auth sessions (`forward-auth/`)
  - Media server metadata (Sonarr, Radarr, Jellyfin, etc.)
  - Home Assistant configuration
  - Monitoring tools (Prometheus, Grafana)
  - Game servers (Minecraft, Palworld)

#### `/storage/fast-staging/`

- **Purpose:** Object storage buckets and frequently accessed data
- **Access Pattern:** High performance SSD-backed storage
- **Backup Priority:** Medium (Tier 2)
- **Used By:**
  - MinIO object storage buckets
  - Temporary processing data
  - Cache storage

### Media Storage

#### `/storage/media-library/`

- **Purpose:** Organized media collection
- **Access Pattern:** Read-heavy, sequential access
- **Backup Priority:** Low (replaceable)
- **Structure:**
  - `tv/` - Television shows
  - `movies/` - Movies
  - `music/` - Music collection
  - `books/` - eBooks and audiobooks
- **Used By:**
  - Jellyfin/Emby media servers
  - Sonarr (TV management)
  - Radarr (Movie management)
  - Lidarr (Music management)
  - Readarr (Book management)

#### `/storage/media-overflow/`

- **Purpose:** Additional media storage when primary is full
- **Access Pattern:** Same as media-library
- **Backup Priority:** Low
- **Status:** Currently unused (reserved for expansion)

#### `/storage/downloads/`

- **Purpose:** Download management and processing
- **Access Pattern:** Write-heavy during downloads, then moved
- **Backup Priority:** None (temporary data)
- **Structure:**
  - `torrents/` - BitTorrent downloads
  - `usenet/` - Usenet downloads
  - `complete/` - Completed downloads awaiting processing
  - `incomplete/` - Active downloads
- **Used By:**
  - qBittorrent
  - SABnzbd
  - Download automation tools

### Photo Management

#### `/storage/photos/`

- **Purpose:** Photo library and management
- **Access Pattern:** Write on upload, read for viewing
- **Backup Priority:** High (Tier 1 - irreplaceable personal data)
- **Structure:**
  - `library/` - Organized photo library
  - `upload/` - Incoming photos for processing
  - `external/` - External library references
- **Used By:**
  - Immich photo management system

### Backup Infrastructure

#### `/storage/backup-tier1/`

- **Purpose:** Critical data backups (high priority)
- **Access Pattern:** Regular scheduled writes, rare reads
- **Backup Priority:** Highest
- **Status:** Currently unused (planned)
- **Intended For:**
  - Application databases
  - Configuration files
  - Personal photos
  - Important documents

#### `/storage/backup-tier2/`

- **Purpose:** Important but replaceable data
- **Access Pattern:** Less frequent backups
- **Backup Priority:** Medium
- **Status:** Currently unused (planned)
- **Intended For:**
  - Application data
  - Downloaded content metadata
  - System snapshots

#### `/storage/backup-archive/`

- **Purpose:** Long-term archival storage
- **Access Pattern:** Write once, rarely read
- **Backup Priority:** Low
- **Status:** Currently unused (planned)
- **Intended For:**
  - Old backups
  - Historical snapshots
  - Compliance archives

### Storage Expansion

#### `/storage/cold-storage/`

- **Purpose:** Infrequently accessed data
- **Access Pattern:** Very rare access
- **Backup Priority:** Low
- **Status:** Currently unused (planned)
- **Intended For:**
  - Archived projects
  - Old media files
  - Historical data

#### `/storage/expansion/`

- **Purpose:** Future storage expansion mount point
- **Access Pattern:** TBD based on future needs
- **Backup Priority:** TBD
- **Status:** Currently unused (reserved)

## Volume Mapping Reference

### Infrastructure Services (infra/\*.yml)

#### Traefik Proxy

```yaml
volumes:
  - /storage/app-data/traefik:/etc/traefik/acme
```

#### MinIO Object Storage

```yaml
volumes:
  - /storage/app-data/minio-data:/data
  - /storage/fast-staging:/export
```

#### Forward Authentication

```yaml
volumes:
  - /storage/app-data/forward-auth:/data
```

### Media Stack (infra/media.yml)

#### Sonarr (TV Management)

```yaml
volumes:
  - /storage/app-data/sonarr:/config
  - /storage/media-library/tv:/tv
  - /storage/downloads:/downloads
```

#### Radarr (Movie Management)

```yaml
volumes:
  - /storage/app-data/radarr:/config
  - /storage/media-library/movies:/movies
  - /storage/downloads:/downloads
```

#### Jellyfin/Emby

```yaml
volumes:
  - /storage/app-data/jellyfin:/config
  - /storage/media-library:/media
```

#### Download Clients

```yaml
# qBittorrent
volumes:
  - /storage/app-data/qbittorrent:/config
  - /storage/downloads:/downloads

# SABnzbd
volumes:
  - /storage/app-data/sabnzbd:/config
  - /storage/downloads:/downloads
```

### Photo Management (infra/immich.yml)

```yaml
volumes:
  - /storage/photos/library:/usr/src/app/upload/library
  - /storage/photos/upload:/usr/src/app/upload/upload
  - /storage/photos/external:/usr/src/app/external
```

### Application Services

#### Home Assistant

```yaml
volumes:
  - /storage/app-data/homeassistant:/config
```

#### Monitoring Stack

```yaml
# Prometheus
volumes:
  - /storage/app-data/prometheus:/prometheus

# Grafana
volumes:
  - /storage/app-data/grafana:/var/lib/grafana
```

### Game Servers

#### Minecraft (infra/minecraft.yml)

```yaml
volumes:
  - /storage/app-data/minecraft:/data
```

#### Palworld (infra/palworld.yml)

```yaml
volumes:
  - /storage/app-data/palworld:/palworld
```

## Best Practices

### Directory Selection Guidelines

1. **Application Data**: Use `/storage/app-data/` for all application configurations and databases
2. **Media Files**: Use `/storage/media-library/` for organized media, `/storage/downloads/` for temporary downloads
3. **High Performance**: Use `/storage/fast-staging/` for data requiring fast access (SSD-backed)
4. **Personal Data**: Use `/storage/photos/` for photo libraries with automatic Tier 1 backup
5. **Backups**: Plan to use tiered backup directories based on data criticality

### Backup Strategy

- **Tier 1** (Critical): Photos, databases, configurations - Daily backups with versioning
- **Tier 2** (Important): Application data, projects - Weekly backups
- **Archive**: Historical data - Monthly or on-demand
- **No Backup**: Downloads, cache, temporary data

### Storage Planning

When adding new services, consider:

1. Data criticality and backup requirements
2. Access patterns (read/write frequency)
3. Performance requirements (SSD vs HDD)
4. Growth projections
5. Data lifecycle (temporary vs permanent)
