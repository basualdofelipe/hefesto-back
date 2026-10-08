import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(4000),
  DATABASE_URL: Joi.string().required(),
  FRONTEND_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  // Google login is off in demo mode, so its client id is only required outside
  // it. A blank `GOOGLE_CLIENT_ID=` line is accepted in demo mode (R9, D-15).
  GOOGLE_CLIENT_ID: Joi.string().when('DEMO_LOGIN_ENABLED', {
    is: 'true',
    then: Joi.string().allow('').optional(),
    otherwise: Joi.required(),
  }),
  DEMO_LOGIN_ENABLED: Joi.string().valid('true', 'false').default('false'),
  DEMO_EMAIL: Joi.string().email().default('demo@hefesto.com'),
  ADMIN_EMAIL: Joi.string().email().default('admin@hefesto.com'),
});
