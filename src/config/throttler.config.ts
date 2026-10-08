import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const THROTTLE_TTL_MS = 60000;
export const THROTTLE_LIMIT = 100;

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
};
