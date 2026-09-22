/**
 * Types shared between the Smooth Parcel V4 API, web app and MCP server.
 * These are the wire shapes; the database schema lives in apps/api.
 */

export const ORDER_STATUSES = [
  'NEW',
  'UPDATE_PRODUCT',
  'LABEL_GENERATED',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'PROBLEM',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const USER_ROLES = ['OWNER', 'MANAGER', 'OPERATOR', 'READ_ONLY'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PROBLEM_KINDS = [
  'address_failed',
  'customs_incomplete',
  'no_method',
  'label_failed',
  'courier_error',
  'no_scan',
  'stalled',
  'late',
  'delivery_failed',
  'held',
  'returning',
  'damaged_lost',
  'customer_reported',
] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export const DELIVERY_PROMISES = ['economy', 'standard', 'express', 'next_day'] as const;
export type DeliveryPromise = (typeof DELIVERY_PROMISES)[number];

export const STATIONERY = ['LABEL_6X4', 'LABEL_4X4', 'A4_LEFT', 'A4_RIGHT'] as const;
export type Stationery = (typeof STATIONERY)[number];

export const DOCUMENT_KINDS = ['label', 'packing_note', 'customs_invoice', 'return_label'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DATA_SOURCES = ['manual', 'api', 'import', 'ai_suggested', 'invoice_reconciliation', 'csv'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const API_SCOPES = [
  'orders:write',
  'orders:read',
  'labels:read',
  'tracking:read',
  'products:write',
  'products:read',
  'methods:write',
  'methods:read',
  'couriers:write',
  'problems:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface AddressInput {
  contactName: string;
  company?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postCode: string;
  country: string; // ISO 3166-1 alpha-2
  phone?: string | null;
  email?: string | null;
}

export interface OrderLineInput {
  sku: string;
  name?: string;
  quantity: number;
  unitValue?: number;
  weight?: number; // kg per unit
  dimensions?: { length: number; width: number; height: number }; // cm per unit
  hsCode?: string;
  countryOfOrigin?: string;
  customsDescription?: string;
}

export interface ParcelInput {
  weight: number; // kg
  length: number; // cm
  width: number;
  height: number;
  lines?: { sku: string; quantity: number }[];
}

export interface CreateOrderInput {
  reference: string;
  orderDate?: string;
  warehouse?: string; // name or external ref; default warehouse when absent
  customer?: { name?: string; email?: string; phone?: string };
  deliveryAddress: AddressInput;
  deliveryPromise?: DeliveryPromise | string; // or ISO date
  lines?: OrderLineInput[];
  parcels?: ParcelInput[];
  customs?: { incoterm?: 'DDU' | 'DDP'; declaredValue?: number; currency?: string };
  flags?: { signature?: boolean; fragile?: boolean; liquid?: boolean; batteries?: boolean };
  method?: string;
  courier?: string;
  label?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MissingField {
  path: string;
  reason: string;
  alternatives?: string[];
  options?: string[];
}

export interface NeedsInformationReply {
  status: 'needs_information';
  reference: string;
  missing: MissingField[];
  resume: string;
}
