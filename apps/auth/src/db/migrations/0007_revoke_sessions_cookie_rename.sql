-- Better Auth cookies were renamed (better-auth.* -> lilnas-auth.*). A token signed
-- before the rename would still verify if sent under the new name, so every
-- session is revoked once. oauth_*_token.session_id is ON DELETE set null.
DELETE FROM `session`;
