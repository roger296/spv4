/**
 * The courier profile definition: a declarative description of a courier's API that the
 * connector engine executes. Users fill this in through the builder; Royal Mail and DPD ship
 * as built-in definitions in ./builtin. Nothing outside src/couriers knows courier specifics.
 *
 * Templates: any string may contain `{{ path | filter | filter:arg }}` expressions rendered
 * against the call context (see template.ts). A string that is exactly one expression keeps
 * the value's type (number, boolean, object). Objects may use `$map`, `$if` and `$omitIf`.
 */
import { z } from 'zod';

const method = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const operationSchema = z.object({
  method,
  path: z.string().min(1),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  contentType: z.enum(['json', 'form', 'xml', 'none']).default('json'),
  /** Parse the reply as this; default json, falling back to text. */
  responseType: z.enum(['json', 'text', 'binary', 'xml']).default('json'),
  /** Treat these HTTP codes as success (default 2xx). */
  successCodes: z.array(z.number()).optional(),
  /** JSON path that must be truthy (or equal `equals`) for success. */
  successWhen: z.object({ path: z.string(), equals: z.unknown().optional() }).optional(),
  /** Where the courier puts its error message. */
  errorPath: z.string().optional(),
});
export type OperationSpec = z.infer<typeof operationSchema>;

export const authSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('header'), header: z.string(), value: z.string() }),
  z.object({ kind: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ kind: z.literal('bearer'), token: z.string() }),
  z.object({
    kind: z.literal('login'),
    request: operationSchema,
    /** Basic-auth the login request itself with these templates (DPD style). */
    basic: z.object({ username: z.string(), password: z.string() }).optional(),
    tokenPath: z.string(),
    header: z.string().default('Authorization'),
    prefix: z.string().default(''),
    ttlMinutes: z.number().default(60),
    retryOn401: z.boolean().default(true),
  }),
]);
export type AuthSpec = z.infer<typeof authSchema>;

export const createResponseSchema = z.object({
  courierReference: z.string(),
  trackingNumber: z.string(),
  trackingUrl: z.string().optional(),
  cost: z.string().optional(),
  labelBase64: z.string().optional(),
  labelUrl: z.string().optional(),
  /** For multi-parcel replies: path to the array of parcels, then per-item paths. */
  parcels: z.object({ path: z.string(), trackingNumber: z.string(), labelBase64: z.string().optional() }).optional(),
});

export const trackResponseSchema = z.object({
  /** Path to the event array (relative to the reply, or to each item when `batchItems` is set). */
  events: z.string(),
  status: z.string(),
  time: z.string(),
  location: z.string().optional(),
  description: z.string().optional(),
  /** Batch tracking: path to the per-shipment array, and how to match a shipment. */
  batchItems: z.string().optional(),
  batchKey: z.string().optional(),
});

export const statusMapEntrySchema = z.object({
  /** Case-insensitive match; a trailing * is a prefix match; `re:` prefix means a regular expression. */
  match: z.string(),
  status: z.enum(['LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'PROBLEM']),
  problem: z.enum(['delivery_failed', 'held', 'returning', 'damaged_lost']).optional(),
});

export const labelSpecSchema = z.object({
  format: z.enum(['pdf', 'png', 'zpl']).default('pdf'),
  /** Where the label comes from after create_shipment. */
  source: z.enum(['inline', 'url', 'operation']).default('inline'),
  nativeSize: z.enum(['6x4', 'a4', 'a5', 'other']).default('6x4'),
  /** For `url` source: template for the URL if not in the reply. */
  urlTemplate: z.string().optional(),
  /** For `operation` source: base64 or binary body path in the get_label reply. */
  base64Path: z.string().optional(),
});

export const profileDefinitionSchema = z.object({
  version: z.literal(1).default(1),
  baseUrl: z.string().url(),
  sandboxBaseUrl: z.string().url().optional(),
  timeoutMs: z.number().default(20_000),
  rateLimitPerMinute: z.number().optional(),
  headers: z.record(z.string()).optional(),
  auth: authSchema,
  operations: z.object({
    auth_test: operationSchema.optional(),
    create_shipment: operationSchema.extend({ response: createResponseSchema }),
    get_label: operationSchema.optional(),
    void_shipment: operationSchema.optional(),
    track: operationSchema.extend({ response: trackResponseSchema }).optional(),
    create_return: operationSchema.extend({ response: createResponseSchema }).optional(),
    manifest: operationSchema.optional(),
  }),
  label: labelSpecSchema.default({}),
  statusMap: z.array(statusMapEntrySchema).default([]),
  trackingUrlTemplate: z.string().optional(),
  /** HTTP codes that mean "retry later" rather than "rejected". */
  retryOn: z.array(z.number()).default([429, 502, 503, 504]),
  /** Notes shown to the user in the builder. */
  notes: z.string().optional(),
  /** Per-account values that are placeholders in shared profiles, e.g. account number. */
  accountFields: z.array(z.string()).optional(),
});
export type ProfileDefinition = z.infer<typeof profileDefinitionSchema>;
export type ProfileDefinitionInput = z.input<typeof profileDefinitionSchema>;

export const OPERATION_NAMES = ['auth_test', 'create_shipment', 'get_label', 'void_shipment', 'track', 'create_return', 'manifest'] as const;
export type OperationName = (typeof OPERATION_NAMES)[number];

export function parseDefinition(raw: unknown): ProfileDefinition {
  return profileDefinitionSchema.parse(raw);
}
