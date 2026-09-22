/**
 * Later modules (labels, couriers, tracking, MCP, admin, billing) register here so app.ts
 * stays short. Each module's register function mounts its routes and event listeners.
 */
import type { FastifyInstance } from 'fastify';

export type ModuleRegistrar = (app: FastifyInstance) => Promise<void>;
const registrars: ModuleRegistrar[] = [];

export function addModule(fn: ModuleRegistrar): void {
  registrars.push(fn);
}

export async function registerModules(app: FastifyInstance): Promise<void> {
  for (const fn of registrars) await fn(app);
}
