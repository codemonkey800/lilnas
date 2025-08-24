export enum MediaType {
  MOVIE = 'movie',
  SERIES = 'series',
}

export enum MediaStatusType {
  ANNOUNCED = 'announced',
  IN_CINEMAS = 'inCinemas',
  RELEASED = 'released',
  DELETED = 'deleted',
  CONTINUING = 'continuing',
  ENDED = 'ended',
  UPCOMING = 'upcoming',
  MONITORED = 'monitored',
  UNMONITORED = 'unmonitored',
}

export enum QueueStatusType {
  QUEUED = 'queued',
  PAUSED = 'paused',
  DOWNLOADING = 'downloading',
  DOWNLOAD_CLIENT_UNAVAILABLE = 'downloadClientUnavailable',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum TrackedDownloadStatusType {
  OK = 'ok',
  WARNING = 'warning',
  ERROR = 'error',
}

export enum TrackedDownloadStateType {
  IMPORTING = 'importing',
  IMPORT_PENDING = 'importPending',
  DOWNLOADING = 'downloading',
  DOWNLOAD_FAILED = 'downloadFailed',
  DOWNLOAD_FAILED_PENDING = 'downloadFailedPending',
  IMPORT_FAILED = 'importFailed',
  IMPORT_FAILED_PENDING = 'importFailedPending',
  IGNORED = 'ignored',
}

export enum MinimumAvailabilityType {
  ANNOUNCED = 'announced',
  IN_CINEMAS = 'inCinemas',
  RELEASED = 'released',
  PRE_DB = 'preDB',
}

export enum SeriesType {
  STANDARD = 'standard',
  DAILY = 'daily',
  ANIME = 'anime',
}

export enum MonitorType {
  ALL = 'all',
  FUTURE = 'future',
  MISSING = 'missing',
  EXISTING = 'existing',
  PILOT = 'pilot',
  FIRST_SEASON = 'firstSeason',
  LAST_SEASON = 'lastSeason',
  MONITOR_SPECIALS = 'monitorSpecials',
  UNMONITOR = 'unmonitor',
  SKIP = 'skip',
}

export enum DiscordErrorCodes {
  UNKNOWN_INTERACTION = '10062',
  INTERACTION_HAS_ALREADY_BEEN_ACKNOWLEDGED = '40060',
  MISSING_PERMISSIONS = '50013',
  CANNOT_SEND_EMPTY_MESSAGE = '50006',
  UNKNOWN_MESSAGE = '10008',
  UNKNOWN_CHANNEL = '10003',
  UNKNOWN_GUILD = '10004',
  UNKNOWN_USER = '10013',
  UNKNOWN_WEBHOOK = '10015',
  UNKNOWN_ROLE = '10011',
  UNKNOWN_EMOJI = '10014',
  UNKNOWN_APPLICATION_COMMAND = '10063',
  APPLICATION_COMMAND_PERMISSIONS_REQUIRE_GUILD = '50001',
  ONLY_BOTS_CAN_USE_THIS_ENDPOINT = '20001',
  BOT_PROHIBITED_ENDPOINT = '20002',
  CANNOT_USE_ENDPOINT_BEFORE_VERIFICATION = '40001',
  REQUEST_ENTITY_TOO_LARGE = '40005',
  FEATURE_TEMPORARILY_DISABLED = '40006',
  USER_BANNED = '40007',
  RATE_LIMITED = '429',
  INTERNAL_SERVER_ERROR = '500',
  SERVICE_UNAVAILABLE = '503',
}

export enum ComponentType {
  ACTION_ROW = 1,
  BUTTON = 2,
  STRING_SELECT = 3,
  TEXT_INPUT = 4,
  USER_SELECT = 5,
  ROLE_SELECT = 6,
  MENTIONABLE_SELECT = 7,
  CHANNEL_SELECT = 8,
}

export enum ButtonStyle {
  PRIMARY = 1,
  SECONDARY = 2,
  SUCCESS = 3,
  DANGER = 4,
  LINK = 5,
}

export enum TextInputStyle {
  SHORT = 1,
  PARAGRAPH = 2,
}

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export enum ApplicationCommandType {
  CHAT_INPUT = 1,
  USER = 2,
  MESSAGE = 3,
}

export enum PermissionFlagsBits {
  CREATE_INSTANT_INVITE = '1',
  KICK_MEMBERS = '2',
  BAN_MEMBERS = '4',
  ADMINISTRATOR = '8',
  MANAGE_CHANNELS = '16',
  MANAGE_GUILD = '32',
  ADD_REACTIONS = '64',
  VIEW_AUDIT_LOG = '128',
  PRIORITY_SPEAKER = '256',
  STREAM = '512',
  VIEW_CHANNEL = '1024',
  SEND_MESSAGES = '2048',
  SEND_TTS_MESSAGES = '4096',
  MANAGE_MESSAGES = '8192',
  EMBED_LINKS = '16384',
  ATTACH_FILES = '32768',
  READ_MESSAGE_HISTORY = '65536',
  MENTION_EVERYONE = '131072',
  USE_EXTERNAL_EMOJIS = '262144',
  VIEW_GUILD_INSIGHTS = '524288',
  CONNECT = '1048576',
  SPEAK = '2097152',
  MUTE_MEMBERS = '4194304',
  DEAFEN_MEMBERS = '8388608',
  MOVE_MEMBERS = '16777216',
  USE_VAD = '33554432',
  CHANGE_NICKNAME = '67108864',
  MANAGE_NICKNAMES = '134217728',
  MANAGE_ROLES = '268435456',
  MANAGE_WEBHOOKS = '536870912',
  MANAGE_EMOJIS_AND_STICKERS = '1073741824',
  USE_APPLICATION_COMMANDS = '2147483648',
  REQUEST_TO_SPEAK = '4294967296',
  MANAGE_EVENTS = '8589934592',
  MANAGE_THREADS = '17179869184',
  CREATE_PUBLIC_THREADS = '34359738368',
  CREATE_PRIVATE_THREADS = '68719476736',
  USE_EXTERNAL_STICKERS = '137438953472',
  SEND_MESSAGES_IN_THREADS = '274877906944',
  USE_EMBEDDED_ACTIVITIES = '549755813888',
  MODERATE_MEMBERS = '1099511627776',
}

export enum ActivityType {
  PLAYING = 0,
  STREAMING = 1,
  LISTENING = 2,
  WATCHING = 3,
  CUSTOM = 4,
  COMPETING = 5,
}

export enum UserFlags {
  STAFF = '1',
  PARTNER = '2',
  HYPESQUAD = '4',
  BUG_HUNTER_LEVEL_1 = '8',
  HYPESQUAD_ONLINE_HOUSE_1 = '64',
  HYPESQUAD_ONLINE_HOUSE_2 = '128',
  HYPESQUAD_ONLINE_HOUSE_3 = '256',
  PREMIUM_EARLY_SUPPORTER = '512',
  TEAM_PSEUDO_USER = '1024',
  BUG_HUNTER_LEVEL_2 = '16384',
  VERIFIED_BOT = '65536',
  VERIFIED_DEVELOPER = '131072',
  CERTIFIED_MODERATOR = '262144',
  BOT_HTTP_INTERACTIONS = '524288',
}

export enum MessageFlags {
  CROSSPOSTED = '1',
  IS_CROSSPOST = '2',
  SUPPRESS_EMBEDS = '4',
  SOURCE_MESSAGE_DELETED = '8',
  URGENT = '16',
  HAS_THREAD = '32',
  EPHEMERAL = '64',
  LOADING = '128',
  FAILED_TO_MENTION_SOME_ROLES_IN_THREAD = '256',
  SUPPRESS_NOTIFICATIONS = '4096',
}

export enum EmbedType {
  RICH = 'rich',
  IMAGE = 'image',
  VIDEO = 'video',
  GIFV = 'gifv',
  ARTICLE = 'article',
  LINK = 'link',
}

export enum WebhookType {
  INCOMING = 1,
  CHANNEL_FOLLOWER = 2,
  APPLICATION = 3,
}

export enum AuditLogEvent {
  GUILD_UPDATE = 1,
  CHANNEL_CREATE = 10,
  CHANNEL_UPDATE = 11,
  CHANNEL_DELETE = 12,
  CHANNEL_OVERWRITE_CREATE = 13,
  CHANNEL_OVERWRITE_UPDATE = 14,
  CHANNEL_OVERWRITE_DELETE = 15,
  MEMBER_KICK = 20,
  MEMBER_PRUNE = 21,
  MEMBER_BAN_ADD = 22,
  MEMBER_BAN_REMOVE = 23,
  MEMBER_UPDATE = 24,
  MEMBER_ROLE_UPDATE = 25,
  MEMBER_MOVE = 26,
  MEMBER_DISCONNECT = 27,
  BOT_ADD = 28,
  ROLE_CREATE = 30,
  ROLE_UPDATE = 31,
  ROLE_DELETE = 32,
  INVITE_CREATE = 40,
  INVITE_UPDATE = 41,
  INVITE_DELETE = 42,
  WEBHOOK_CREATE = 50,
  WEBHOOK_UPDATE = 51,
  WEBHOOK_DELETE = 52,
  EMOJI_CREATE = 60,
  EMOJI_UPDATE = 61,
  EMOJI_DELETE = 62,
  MESSAGE_DELETE = 72,
  MESSAGE_BULK_DELETE = 73,
  MESSAGE_PIN = 74,
  MESSAGE_UNPIN = 75,
  INTEGRATION_CREATE = 80,
  INTEGRATION_UPDATE = 81,
  INTEGRATION_DELETE = 82,
  STAGE_INSTANCE_CREATE = 83,
  STAGE_INSTANCE_UPDATE = 84,
  STAGE_INSTANCE_DELETE = 85,
  STICKER_CREATE = 90,
  STICKER_UPDATE = 91,
  STICKER_DELETE = 92,
  GUILD_SCHEDULED_EVENT_CREATE = 100,
  GUILD_SCHEDULED_EVENT_UPDATE = 101,
  GUILD_SCHEDULED_EVENT_DELETE = 102,
  THREAD_CREATE = 110,
  THREAD_UPDATE = 111,
  THREAD_DELETE = 112,
  APPLICATION_COMMAND_PERMISSION_UPDATE = 121,
  AUTO_MODERATION_RULE_CREATE = 140,
  AUTO_MODERATION_RULE_UPDATE = 141,
  AUTO_MODERATION_RULE_DELETE = 142,
  AUTO_MODERATION_BLOCK_MESSAGE = 143,
  AUTO_MODERATION_FLAG_TO_CHANNEL = 144,
  AUTO_MODERATION_USER_COMMUNICATION_DISABLED = 145,
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace',
}

export enum CacheStrategy {
  MEMORY = 'memory',
  REDIS = 'redis',
  NONE = 'none',
}

export enum RateLimitStrategy {
  FIXED_WINDOW = 'fixed_window',
  SLIDING_WINDOW = 'sliding_window',
  TOKEN_BUCKET = 'token_bucket',
  LEAKY_BUCKET = 'leaky_bucket',
}

export enum ServiceHealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown',
}

export enum ApiClientType {
  SONARR = 'sonarr',
  RADARR = 'radarr',
  EMBY = 'emby',
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
}

export enum ContentType {
  JSON = 'application/json',
  XML = 'application/xml',
  TEXT = 'text/plain',
  HTML = 'text/html',
  FORM = 'application/x-www-form-urlencoded',
  MULTIPART = 'multipart/form-data',
}

export enum ValidationErrorType {
  REQUIRED = 'required',
  INVALID_FORMAT = 'invalid_format',
  OUT_OF_RANGE = 'out_of_range',
  TOO_LONG = 'too_long',
  TOO_SHORT = 'too_short',
  INVALID_TYPE = 'invalid_type',
  CUSTOM = 'custom',
}

export enum EventType {
  MEDIA_REQUESTED = 'media.requested',
  MEDIA_ADDED = 'media.added',
  MEDIA_DELETED = 'media.deleted',
  MEDIA_SEARCH = 'media.search',
  DOWNLOAD_STARTED = 'download.started',
  DOWNLOAD_COMPLETED = 'download.completed',
  DOWNLOAD_FAILED = 'download.failed',
  COMPONENT_CREATED = 'component.created',
  COMPONENT_EXPIRED = 'component.expired',
  COMPONENT_CLEANUP = 'component.cleanup',
  COMPONENT_ERROR = 'component.error',
  COMPONENT_CLEANED = 'component.cleaned',
  COMPONENT_WARNING = 'component.warning',
  USER_INTERACTION = 'user.interaction',
  API_REQUEST = 'api.request',
  API_RESPONSE = 'api.response',
  API_ERROR = 'api.error',
  SERVICE_HEALTH_CHECK = 'service.health_check',
  RATE_LIMIT_EXCEEDED = 'rate_limit.exceeded',
}

export enum Priority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4,
  URGENT = 5,
}

export enum ActionType {
  REQUEST = 'request',
  ADD = 'add',
  DELETE = 'delete',
  MONITOR = 'monitor',
  UNMONITOR = 'unmonitor',
  CANCEL = 'cancel',
  CONFIRM = 'confirm',
  VIEW = 'view',
  DOWNLOAD = 'download',
  PLAY = 'play',
}
