import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import type { Profile } from 'passport-google-oauth20'
import { Strategy } from 'passport-google-oauth20'

import { EnvKeys } from 'src/env'

import { AuthService } from './auth.service'

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env[EnvKeys.GOOGLE_CLIENT_ID]!,
      clientSecret: process.env[EnvKeys.GOOGLE_CLIENT_SECRET]!,
      callbackURL: process.env[EnvKeys.GOOGLE_CALLBACK_URL]!,
      scope: ['email', 'profile'],
    })
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ) {
    return this.authService.findOrCreateUser(profile)
  }
}
