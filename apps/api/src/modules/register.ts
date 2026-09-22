/**
 * Wires the optional modules into the app: couriers, shipping methods, labels.
 * Imported for its side effects by server.ts and by the test helper.
 */
import { addModule } from './index.js';
import { courierRoutes } from './couriers/courier.routes.js';
import { methodRoutes } from './methods/methods.routes.js';
import { labelRoutes } from './labels/label.routes.js';
import { installLabelPipeline } from './labels/label.service.js';
import { seedBuiltinProfiles } from '../couriers/builtin/index.js';

let installed = false;

addModule(async (app) => {
  await app.register(courierRoutes, { prefix: '/v4' });
  await app.register(methodRoutes, { prefix: '/v4' });
  await app.register(labelRoutes, { prefix: '/v4' });
  if (!installed) {
    installLabelPipeline();
    installed = true;
  }
  await seedBuiltinProfiles();
});
