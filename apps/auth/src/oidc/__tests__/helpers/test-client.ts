import type { OidcClientDefinition } from 'src/oidc/clients'

// OIDC_CLIENTS is empty in production, so the OIDC specs register this
// fixture client via jest.mock('src/oidc/clients', ...) instead.
export const TEST_OIDC_CLIENT: OidcClientDefinition = {
  clientId: 'test-app',
  name: 'Test App',
  host: 'test-app.lilnas.io',
  redirectUris: ['https://test-app.lilnas.io/api/auth/oidc/callback'],
  secretEnvKey: 'OIDC_TEST_APP_CLIENT_SECRET',
}
