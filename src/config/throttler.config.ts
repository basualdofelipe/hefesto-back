import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'http';

export const THROTTLE_TTL_MS = 60000;
export const THROTTLE_LIMIT = 100;

/** Set by Cloudflare at the edge to the real client IP (Node lower-cases header names). */
export const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

const UNKNOWN_TRACKER = 'unknown';

export function getCloudflareClientIp(
  headers: IncomingHttpHeaders,
): string | undefined {
  const raw = headers[CF_CONNECTING_IP_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : undefined;
}

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
  // No CF-Connecting-IP means the request did not come through Cloudflare: it
  // came from inside the Docker network (the front's server) and is not
  // limited by design.
  skipIf: (context: ExecutionContext): boolean =>
    getCloudflareClientIp(
      context.switchToHttp().getRequest<Request>().headers,
    ) === undefined,
  // The guard evaluates skipIf first, so the fallback is unreachable; it keeps
  // the tracker total instead of throwing inside the guard. The library types
  // the request as Record<string, any>; narrow it to the express fields used.
  getTracker: (req): string => {
    const { headers, ip } = req as Pick<Request, 'headers' | 'ip'>;
    return getCloudflareClientIp(headers) ?? ip ?? UNKNOWN_TRACKER;
  },
};
