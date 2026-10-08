import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { extractPermissions } from '../common/types/permission';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { getDemoEmail, isDemoMode } from '../constants/branding';
import { AuthResponseDto } from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client | null;
  private readonly googleClientId: string | null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    // Demo mode runs without Google credentials (R9, D-15): the env schema
    // makes GOOGLE_CLIENT_ID optional there, so it must not be read.
    if (isDemoMode()) {
      this.googleClientId = null;
      this.googleClient = null;
    } else {
      this.googleClientId =
        this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
      this.googleClient = new OAuth2Client(this.googleClientId);
    }
  }

  async validateGoogleToken(idToken: string): Promise<AuthResponseDto> {
    // Server-side refusal, independent of the front hiding the button (D-14).
    if (isDemoMode()) {
      throw new UnauthorizedException('Login con Google no disponible');
    }

    const payload = await this.verifyGoogleIdToken(idToken);

    if (!payload || !payload.email) {
      throw new UnauthorizedException('Token de Google invalido');
    }

    const user = await this.usersService.findActiveByEmail(payload.email);

    if (!user) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    await this.usersService.updateGoogleProfile(user.id, {
      name: payload.name ?? null,
      pictureUrl: payload.picture ?? null,
      googleId: payload.sub,
    });

    const permissions = extractPermissions(user.role);

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      permissions,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        permissions,
        name: payload.name ?? user.name ?? null,
        pictureUrl: payload.picture ?? user.pictureUrl ?? null,
      },
    };
  }

  async getProfile(userId: string): Promise<User | null> {
    return this.usersService.findById(userId);
  }

  async validateDemoLogin(email: string): Promise<AuthResponseDto> {
    if (!isDemoMode()) {
      throw new UnauthorizedException('Demo login no disponible');
    }

    if (email !== getDemoEmail()) {
      throw new UnauthorizedException('Demo login no disponible');
    }

    // Look up the pinned demo account, never the client-supplied address.
    const user = await this.usersService.findActiveByEmail(getDemoEmail());
    if (!user) {
      throw new UnauthorizedException('Usuario demo no encontrado');
    }

    const permissions = extractPermissions(user.role);
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      permissions,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        permissions,
        name: user.name ?? null,
        pictureUrl: user.pictureUrl ?? null,
      },
    };
  }

  private async verifyGoogleIdToken(
    idToken: string,
  ): Promise<TokenPayload | undefined> {
    // Only reachable when demo mode was on at construction and is off now;
    // outside demo mode the env schema requires GOOGLE_CLIENT_ID at boot.
    if (!this.googleClient || !this.googleClientId) {
      throw new UnauthorizedException('Login con Google no disponible');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });

      return ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Token de Google invalido');
    }
  }
}
