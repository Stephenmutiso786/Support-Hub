const dotenv = require('dotenv');

dotenv.config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8081),
  databaseUrl: process.env.DATABASE_URL,
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24),
  telephonyApiKey: process.env.TELEPHONY_API_KEY || null,
  telephonyWebhookSecret: process.env.TELEPHONY_WEBHOOK_SECRET || null,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
};

if (!env.databaseUrl) {
  throw new Error('Missing DATABASE_URL in environment');
}

module.exports = env;
