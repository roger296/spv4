/**
 * Wires the optional modules into the app: couriers, shipping methods, labels, tracking,
 * CSV import, billing, AI jobs, the admin portal and the MCP server. Imported for its side
 * effects by server.ts, the worker and the test helper.
 */
import { addModule } from './index.js';
import { courierRoutes } from './couriers/courier.routes.js';
import { methodRoutes } from './methods/methods.routes.js';
import { labelRoutes } from './labels/label.routes.js';
import { installLabelPipeline } from './labels/label.service.js';
import { trackingRoutes } from './tracking/tracking.routes.js';
import { importRoutes } from './orders/import.routes.js';
import { billingRoutes } from './billing/billing.routes.js';
import { aiRoutes } from './ai/ai.routes.js';
import { adminRoutes } from './admin/admin.routes.js';
import { mcpRoutes } from '../mcp/server.js';
import { seedBuiltinProfiles } from '../couriers/builtin/index.js';

let installed = false;

addModule(async (app) => {
  await app.register(courierRoutes, { prefix: '/v4' });
  await app.register(methodRoutes, { prefix: '/v4' });
  await app.register(labelRoutes, { prefix: '/v4' });
  await app.register(trackingRoutes, { prefix: '/v4' });
  await app.register(importRoutes, { prefix: '/v4' });
  await app.register(billingRoutes, { prefix: '/v4' });
  await app.register(aiRoutes, { prefix: '/v4' });
  await app.register(adminRoutes, { prefix: '/v4' });
  await app.register(mcpRoutes); // /mcp and /.well-known/* live at the root
  if (!installed) {
    installLabelPipeline();
    installed = true;
  }
  await seedBuiltinProfiles();
});
