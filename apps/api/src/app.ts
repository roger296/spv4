import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getEnv } from './config/env.js';
import { errorHandler } from './shared/error-handler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { productRoutes } from './modules/products/products.routes.js';
import { orderRoutes } from './modules/orders/order.routes.js';
import { registerModules } from './modules/index.js';

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    },
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(formbody);
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: { info: { title: 'Smooth Parcel V4 API', version: '4.0.0', description: 'Bring-your-own-courier shipping labels and tracking' }, servers: [{ url: env.API_ORIGIN }] },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({ status: 'ok', version: '4.0.0', timestamp: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/v4' });
  await app.register(settingsRoutes, { prefix: '/v4' });
  await app.register(productRoutes, { prefix: '/v4' });
  await app.register(orderRoutes, { prefix: '/v4' });
  await registerModules(app);

  return app;
}
