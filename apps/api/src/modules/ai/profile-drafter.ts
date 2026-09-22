/**
 * AI-assisted courier profile drafting (spec section 7): given API documentation, Claude
 * drafts a complete profile definition in our schema. The draft is marked ai_suggested
 * and is only trusted once the builder's tests pass.
 */
import type { Ctx } from '../../shared/context.js';
import { askClaude, extractJson, isAiConfigured } from './claude.js';
import { profileDefinitionSchema } from '../../couriers/profile-schema.js';
import { royalMailClickAndDrop } from '../../couriers/builtin/royal-mail-click-and-drop.js';
import { AppError, ValidationError } from '../../shared/errors.js';

const SYSTEM = `You convert courier API documentation into a Smooth Parcel courier profile: a JSON object that a generic connector engine executes. Output only JSON.

The profile schema (all keys as in this example, which is the real Royal Mail Click & Drop profile):
${JSON.stringify({ name: royalMailClickAndDrop.name, credentialSchema: royalMailClickAndDrop.credentialSchema, services: royalMailClickAndDrop.services.slice(0, 3), definition: royalMailClickAndDrop.definition }, null, 1)}

Rules:
- Templates use {{ path | filter }} with these context roots: cred.<credential key>, order.* (reference, contactName, firstName, lastName, company, line1, line2, city, region, postCode, country (alpha-2), phone, email, orderDate, incoterm, ddp, declaredValue, goodsValue, currency, signature, fragile, liquid, batteries, international, domestic, description, totalQuantity, lines[] with sku,name,quantity,unitValue,lineValue,weightKg,lengthCm,widthCm,heightCm,hsCode,countryOfOrigin,customsDescription), warehouse.* (name, contactName, company, line1, line2, city, region, postCode, country, phone, email, eori, vatNumber, iossNumber), parcels[] (weightKg, lengthCm, widthCm, heightCm, position), parcel (first parcel), totalWeightKg, method.serviceCode, method.name, shipment.reference, shipment.attempt, shipment.courierReference, shipment.trackingNumber, session.token, now.
- Filters: upper, lower, trim, truncate:N, default:'x', number, int, round:N, grams, kg, mm, cm, inches, lbs, pence, bool, not, string, json, date:YYYY-MM-DD, iso, alpha2, alpha3, first_name, last_name, concat:'x', prepend:'x', digits, nospace, length, sum:field, join:',', eq:'x', base64, urlencode.
- Object templates: {"$map": "order.lines", "as": "line", "item": {...}} for arrays; {"$if": "order.international", "then": ..., "else": ...}; "$includeIf"/"$omitIf" on an object; a key ending in ? is dropped when its value is empty.
- auth kinds: none | header {header, value} | basic {username, password} | bearer {token} | login {request, basic?, tokenPath, header, prefix, ttlMinutes, retryOn401}.
- operations: create_shipment (required, with response {courierReference, trackingNumber, labelBase64?, labelUrl?, cost?, parcels?}), get_label (responseType binary when the courier returns PDF bytes), void_shipment, track (with response {events, status, time, location?, description?}), auth_test (a harmless GET), create_return, manifest.
- label.source: inline (base64 in the create reply), url (labelUrl in reply), operation (call get_label).
- statusMap: courier status phrases → LABEL_GENERATED | SHIPPED | IN_TRANSIT | DELIVERED | PROBLEM (+problem: delivery_failed|held|returning|damaged_lost). Use "re:" prefixed regular expressions for families of phrases.
- Put every account-specific value (account numbers, depot codes) in credentialSchema and reference it as cred.<key>; list those keys in definition.accountFields.
- Include notes on anything you were unsure of, prefixed VERIFY.
Return: {"name": "...", "credentialSchema": [...], "services": [...], "definition": {...}, "notes": "..."}`;

export interface DraftInput { name?: string; documentation?: string; url?: string }

export async function draftProfileFromDocumentation(ctx: Ctx, input: DraftInput) {
  let documentation = input.documentation ?? '';
  if (input.url) {
    try {
      const res = await fetch(input.url, { headers: { accept: 'text/html,application/json,text/plain,*/*' } });
      const text = await res.text();
      documentation += `\n\n--- ${input.url} ---\n` + text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 150_000);
    } catch (err) {
      throw new ValidationError(`Could not fetch ${input.url}: ${(err as Error).message}`);
    }
  }
  if (!documentation.trim()) throw new ValidationError('No documentation to read');
  if (!isAiConfigured()) {
    // Without a model, hand back a skeleton so the builder still works by hand.
    return { name: input.name ?? 'New courier', aiSuggested: false, credentialSchema: [{ key: 'apiKey', label: 'API key', secret: true, required: true }], services: [], definition: { ...royalMailClickAndDrop.definition, baseUrl: 'https://api.example.com', notes: 'AI drafting is not configured (ANTHROPIC_API_KEY). This is the Royal Mail profile as a starting point; edit every operation.' }, notes: 'AI unavailable' };
  }
  const result = await askClaude({ accountId: ctx.accountId, job: 'profile_draft', system: SYSTEM, maxTokens: 8192, user: `Courier name hint: ${input.name ?? 'unknown'}\n\nDocumentation:\n${documentation.slice(0, 180_000)}` });
  const draft = extractJson<{ name?: string; credentialSchema?: unknown[]; services?: unknown[]; definition?: unknown; notes?: string }>(result.text);
  const parsed = profileDefinitionSchema.safeParse(draft.definition);
  if (!parsed.success) {
    throw new AppError(502, 'ai_error', 'The drafted profile did not match the schema', { issues: parsed.error.issues.slice(0, 10), draft });
  }
  return { name: draft.name ?? input.name ?? 'New courier', aiSuggested: true, credentialSchema: draft.credentialSchema ?? [], services: draft.services ?? [], definition: parsed.data, notes: draft.notes ?? '', costGbp: result.costGbp };
}
