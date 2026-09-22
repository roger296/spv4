/**
 * Wire shapes the web app reads from the API. Decimal columns arrive as
 * strings from Postgres, so numeric fields are typed `string | number | null`
 * and rendered through `num()` / the format helpers.
 */
import type { MissingField, OrderStatus, ProblemKind, Stationery } from '@spv4/shared-types';

export type Numeric = string | number | null;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Address {
  contactName: string | null;
  company: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

// ---- auth ----

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

export interface SignInReply {
  token: string;
  account: { id: string; name: string; status?: string };
  user: SessionUser;
}

export interface MeReply {
  account: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    stationery: Stationery;
    status: string;
    trialEndsAt: string | null;
    settings: AccountSettings;
  };
  user: SessionUser | null;
  actor: { kind: string; role: string | null };
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  lastSignInAt?: string | null;
  inviteExpiresAt?: string | null;
  createdAt?: string;
}

// ---- account & settings ----

export interface AccountSettings {
  packagingAllowanceKg?: number;
  defaultBox?: { length: number; width: number; height: number };
  aiApprovalRequired?: boolean;
  trustAiAboveConfidence?: number;
  notificationEmails?: string[];
  trackingBranding?: { logoUrl?: string; colour?: string; supportEmail?: string };
  a4Label?: { x: number; y: number; width: number; height: number };
  dailyProblemEmail?: boolean;
}

export interface Account {
  id: string;
  name: string;
  slug: string;
  currency: string;
  stationery: Stationery;
  status: string;
  billingMode?: string;
  trialEndsAt: string | null;
  lastPaidAt?: string | null;
  settings: AccountSettings;
  billing?: { hasMandate: boolean; hasSubscription: boolean };
}

export interface Warehouse extends Address {
  id: string;
  name: string;
  externalRef: string | null;
  isDefault: boolean;
  eori: string | null;
  vatNumber: string | null;
  iossNumber: string | null;
  stationery: Stationery | null;
  autoLabel: boolean;
  packingNote: boolean;
  shippedAfterHours: number;
  allowedMethodIds: string[] | null;
}

export interface AddressBookEntry extends Address {
  id: string;
  label: string;
  lastUsedAt: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  kind: 'api' | 'mcp';
  clientName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreated extends Pick<ApiKey, 'id' | 'name' | 'prefix' | 'scopes' | 'kind'> {
  key: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secretPreview?: string;
  secret?: string;
  createdAt: string;
}

export const WEBHOOK_EVENTS = [
  'order.label_generated',
  'order.shipped',
  'order.in_transit',
  'order.delivered',
  'order.problem',
  'order.cancelled',
] as const;

// ---- products ----

export interface SuggestedProductData {
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  confidence: number;
  sourceUrl?: string;
  suggestedAt?: string;
}

export interface Product {
  id: string;
  stockCode: string;
  name: string;
  ean: string | null;
  brand: string | null;
  description?: string | null;
  weight: Numeric;
  length: Numeric;
  width: Numeric;
  height: Numeric;
  hsCode: string | null;
  countryOfOrigin: string | null;
  customsDescription: string | null;
  unitValue: Numeric;
  dataSource?: string;
  dataConfidence?: Numeric;
  dataSourceUrl?: string | null;
  suggested: SuggestedProductData | null;
  complete: boolean;
  updatedAt?: string;
}

export interface ProductPatch {
  name?: string;
  ean?: string | null;
  brand?: string | null;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
  customsDescription?: string | null;
  unitValue?: number | null;
}

// ---- orders ----

export interface OrderRow extends Address {
  id: string;
  orderNumber: string;
  externalRef: string | null;
  source: string;
  warehouseId: string;
  orderDate: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  deliveryPromise: string;
  deliverBy: string | null;
  incoterm: 'DDU' | 'DDP' | null;
  declaredValue: Numeric;
  currencyCode: string;
  signature: boolean;
  fragile: boolean;
  liquid: boolean;
  batteries: boolean;
  requestedMethod: string | null;
  requestedCourier: string | null;
  status: OrderStatus;
  problemReason: ProblemKind | null;
  missing: MissingField[];
  shipmentId: string | null;
  courierName: string | null;
  methodName: string | null;
  cost: Numeric;
  trackingNumber: string | null;
  trackingLink: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  lastEventAt: string | null;
  labelWanted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLine {
  id: string;
  productId: string | null;
  sku: string;
  name: string;
  quantity: number;
  unitValue: Numeric;
  weight: Numeric;
  length: Numeric;
  width: Numeric;
  height: Numeric;
  hsCode: string | null;
  countryOfOrigin: string | null;
  customsDescription: string | null;
}

export interface Parcel {
  id: string;
  sequence: number;
  weight: Numeric;
  length: Numeric;
  width: Numeric;
  height: Numeric;
  contents: { sku: string; quantity: number }[];
  estimated: boolean;
  labelDocumentId: string | null;
  trackingNumber: string | null;
}

export interface Shipment {
  id: string;
  kind: 'outbound' | 'return' | string;
  attempt: number;
  methodName: string | null;
  courierName: string | null;
  serviceCode: string | null;
  status: string;
  courierReference: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  cost: Numeric;
  chargeableKg: Numeric;
  errorMessage: string | null;
  voidedAt: string | null;
  lastTrackedAt: string | null;
  createdAt: string;
}

export interface OrderDocument {
  id: string;
  kind: string;
  stationery?: string | null;
  pageCount?: number;
  parcelId?: string | null;
  url: string;
  createdAt: string;
}

export interface Problem {
  id: string;
  orderId: string;
  kind: ProblemKind;
  description: string;
  suggestedAction: string | null;
  openedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolvedBy: string | null;
}

export interface TrackingEvent {
  id: string;
  occurredAt: string;
  courierStatus: string;
  mappedStatus: OrderStatus | null;
  problemKind: ProblemKind | null;
  location: string | null;
  description: string | null;
}

export interface RankedMethod {
  methodId: string;
  name: string;
  courier: string;
  cost: number;
  transitDays: number;
  chargeableKg: number;
}

export interface Selection {
  chosenMethodId: string | null;
  reason: string;
  ranked: RankedMethod[];
  dropped: { methodId?: string; name: string; reason: string }[];
  selectedAt?: string;
}

export interface Order extends OrderRow {
  warehouse: { id: string; name: string; externalRef: string | null; country: string | null } | null;
  lines: OrderLine[];
  parcels: Parcel[];
  shipments: Shipment[];
  documents: OrderDocument[];
  problems: Problem[];
  trackingEvents: TrackingEvent[];
  selection: Selection | null;
  metadata?: Record<string, unknown>;
  duplicate?: boolean;
}

export interface HistoryEntry {
  id: string;
  kind: 'action' | 'note' | 'view';
  action: string;
  actorKind?: string;
  actorName: string | null;
  clientName: string | null;
  before: unknown;
  after: unknown;
  note?: string | null;
  createdAt: string;
}

export interface OrderImportRow {
  row: number;
  reference?: string;
  status?: string;
  missing?: MissingField[];
  error?: string;
}

// ---- couriers ----

export interface CourierService {
  code: string;
  name: string;
  tracked?: boolean;
  signature?: boolean;
  express?: boolean;
  maxTransitDays?: number | null;
  domestic?: boolean;
  international?: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  help?: string;
  required?: boolean;
}

export interface CourierProfile {
  id: string;
  key: string;
  name: string;
  origin: 'builtin' | 'shared' | 'own';
  review?: string | null;
  version?: number;
  services: CourierService[];
  credentialSchema: CredentialField[];
  aiSuggested?: boolean;
  adoptions?: number;
  definition?: unknown;
}

export interface CourierAccount {
  id: string;
  profileId: string;
  profile: { key: string; name: string };
  name: string;
  sandbox: boolean;
  active: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export interface CourierTestReply {
  ok: boolean;
  message?: string;
  request?: unknown;
  response?: unknown;
}

// ---- methods ----

export interface Band {
  minWeightKg: number;
  maxWeightKg: number;
  cost: number;
  effectiveFrom?: string;
  note?: string | null;
}

export interface ShippingMethod {
  id: string;
  courierAccountId: string;
  courierName: string;
  name: string;
  serviceCode: string | null;
  originCountry: string | null;
  destinationCountries: string[];
  excludedPostcodePrefixes: string[];
  tracked: boolean;
  signature: boolean;
  express: boolean;
  allowsLiquid: boolean;
  allowsBatteries: boolean;
  allowsFragile: boolean;
  returnsService: boolean;
  maxTransitDays: number | null;
  volumetricDivisor: number | null;
  minWeightKg: Numeric;
  maxWeightKg: Numeric;
  maxLengthCm: Numeric;
  maxGirthCm: Numeric;
  maxThinnestCm: Numeric;
  maxDeclaredValue: Numeric;
  preferred: boolean;
  active: boolean;
  surcharges: unknown[];
  currentBands: Band[];
}

export interface Quote {
  ranked: RankedMethod[];
  dropped: { name: string; reason: string }[];
}

// ---- problems / returns / dashboard ----

export interface ProblemQueueItem {
  id: string;
  orderId: string;
  orderNumber: string;
  kind: ProblemKind;
  description: string;
  suggestedAction: string | null;
  openedAt: string;
  resolvedAt: string | null;
  lastEventAt: string | null;
  trackingNumber: string | null;
  courierName: string | null;
}

export interface ReturnShipment {
  id: string;
  orderNumber: string;
  trackingNumber: string | null;
  courierName: string | null;
  status: string;
  createdAt: string;
  documentUrl: string | null;
}

export interface Dashboard {
  counts: Partial<Record<OrderStatus, number>>;
  openProblems: number;
  labelsThisWeek: { courier: string; count: number }[];
  costThisWeek: number | string;
  incompleteProducts: number;
  digest?: string | null;
}

export interface Billing {
  status: string;
  trialEndsAt: string | null;
  billingMode: string;
  hasMandate: boolean;
  weeklyAmount: number | string | null;
  lastPaidAt: string | null;
  payments: { id: string; amount: Numeric; currency: string; status: string; createdAt: string }[];
}
