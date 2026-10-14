import { randomUUID } from 'node:crypto'

import { base64Url } from '@better-auth/utils/base64'
import { createHash } from '@better-auth/utils/hash'
import { env } from '@lilnas/utils/env'
import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { eq, notInArray } from 'drizzle-orm'

import { DB, type Db } from 'src/db/database.module'
import { oauthClient } from 'src/db/schema'

import { OIDC_CLIENTS, type OidcClientDefinition } from './clients'

// Same transform as the plugin's `defaultHasher`
// (node_modules/@better-auth/oauth-provider/dist/utils-B3Myyglw.mjs ~L163):
// the token endpoint hashes the presented client_secret this way and
// constant-time compares it with the stored column, so the seeded value
// must match byte for byte (base64url, no padding).
async function hashClientSecret(secret: string): Promise<string> {
  const digest = await createHash('SHA-256').digest(
    new TextEncoder().encode(secret),
  )
  return base64Url.encode(new Uint8Array(digest), { padding: false })
}

// Syncs the code-defined OIDC clients (./clients.ts) into oauth_client on
// every boot: upserts the listed ones and deletes the rest. The plugin only
// reads this table; clients are never self-registered (auth.ts disables
// dynamic registration), so this is the only writer. Deleting a client
// cascades to its tokens and consents (see schema.ts), so removing an entry
// from clients.ts fully revokes it.
@Injectable()
export class OidcClientsService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    for (const client of OIDC_CLIENTS) {
      await this.upsert(client)
    }
    await this.db.delete(oauthClient).where(
      notInArray(
        oauthClient.clientId,
        OIDC_CLIENTS.map(c => c.clientId),
      ),
    )
  }

  private async upsert(client: OidcClientDefinition): Promise<void> {
    // env() throws naming the key when unset — deliberately fatal at boot.
    const secret = env(client.secretEnvKey)
    const now = new Date()
    // Everything except id/createdAt is refreshed on every boot so a rotated
    // secret or a new redirect URI takes effect on restart. Arrays/JSON are
    // stored as JSON text, as the SQLite adapter does for these fields.
    const values = {
      clientSecret: await hashClientSecret(secret),
      name: client.name,
      redirectUris: JSON.stringify(client.redirectUris),
      scopes: JSON.stringify(['openid', 'profile', 'email']),
      type: 'web',
      tokenEndpointAuthMethod: 'client_secret_post',
      grantTypes: JSON.stringify(['authorization_code']),
      responseTypes: JSON.stringify(['code']),
      skipConsent: true,
      requirePKCE: false,
      public: false,
      disabled: false,
      metadata: JSON.stringify({ lilnasHost: client.host }),
      updatedAt: now,
    }
    const [existing] = await this.db
      .select({ id: oauthClient.id })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, client.clientId))
      .limit(1)
    if (existing) {
      await this.db
        .update(oauthClient)
        .set(values)
        .where(eq(oauthClient.id, existing.id))
      return
    }
    await this.db.insert(oauthClient).values({
      id: randomUUID(),
      clientId: client.clientId,
      createdAt: now,
      ...values,
    })
  }
}
