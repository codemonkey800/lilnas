import { Controller, Get, Req, Res } from '@nestjs/common'
import { AuthService } from '@thallesp/nestjs-better-auth'
import type { Request, Response } from 'express'

import { type Auth } from './auth'

// Serves OIDC discovery at the ISSUER ROOT (`/.well-known/...`), outside
// the /api/auth mount. Why this exists, verified against installed
// @better-auth/oauth-provider@1.7.12's dist/authorize-D_jy3s-1.mjs ~L4355
// (`handleIssuerMetadataRequest`): the plugin answers discovery from an
// onRequest hook that compares the FULL request pathname with
// `${issuerPath}/.well-known/openid-configuration`, where issuerPath is the
// pathname of the jwt plugin's `issuer` (AUTH_HOST, so ''). The plugin's
// `/.well-known/*` endpoints are SERVER_ONLY, i.e. not routable under
// /api/auth — requesting `/api/auth/.well-known/openid-configuration` is a
// 404. So the request has to reach Better Auth's handler with the root
// path intact, but @thallesp's mount gate (`matchesBasePath`) only forwards
// '/api/auth/...'; this controller bridges the gap by handing the request
// to the same instance's `handler` itself. next.config.js rewrites the
// public root paths here without changing them.
@Controller('.well-known')
export class OidcWellKnownController {
  constructor(private readonly authService: AuthService<Auth>) {}

  @Get('openid-configuration')
  openidConfiguration(@Req() req: Request, @Res() res: Response) {
    return this.forward(req, res)
  }

  @Get('oauth-authorization-server')
  oauthAuthorizationServer(@Req() req: Request, @Res() res: Response) {
    return this.forward(req, res)
  }

  private async forward(req: Request, res: Response): Promise<void> {
    // Only the pathname matters to the plugin's hook; the origin is the
    // configured baseURL's, not anything taken from request headers.
    const authResponse = await this.authService.instance.handler(
      new Request(new URL(req.path, this.authService.instance.options.baseURL)),
    )
    res.status(authResponse.status)
    authResponse.headers.forEach((value, key) => res.setHeader(key, value))
    res.send(Buffer.from(await authResponse.arrayBuffer()))
  }
}
