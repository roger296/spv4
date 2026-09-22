CREATE TYPE "public"."account_status" AS ENUM('TRIAL', 'ACTIVE', 'ARREARS', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('user', 'api_key', 'mcp', 'system', 'admin');--> statement-breakpoint
CREATE TYPE "public"."audit_kind" AS ENUM('action', 'note', 'view');--> statement-breakpoint
CREATE TYPE "public"."billing_mode" AS ENUM('MOLLIE', 'INVOICED', 'COMPLIMENTARY');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('manual', 'api', 'import', 'ai_suggested', 'invoice_reconciliation', 'csv');--> statement-breakpoint
CREATE TYPE "public"."delivery_promise" AS ENUM('economy', 'standard', 'express', 'next_day', 'date');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('label', 'packing_note', 'customs_invoice', 'return_label');--> statement-breakpoint
CREATE TYPE "public"."incoterm" AS ENUM('DDU', 'DDP');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('api', 'mcp', 'csv', 'manual', 'smmta');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('NEW', 'UPDATE_PRODUCT', 'LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'PROBLEM', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."problem_kind" AS ENUM('address_failed', 'customs_incomplete', 'no_method', 'label_failed', 'courier_error', 'no_scan', 'stalled', 'late', 'delivery_failed', 'held', 'returning', 'damaged_lost', 'customer_reported');--> statement-breakpoint
CREATE TYPE "public"."profile_origin" AS ENUM('builtin', 'shared', 'own');--> statement-breakpoint
CREATE TYPE "public"."profile_review" AS ENUM('draft', 'submitted', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."shipment_kind" AS ENUM('outbound', 'return');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('PENDING', 'CREATED', 'FAILED', 'VOID', 'VOID_FAILED');--> statement-breakpoint
CREATE TYPE "public"."stationery" AS ENUM('LABEL_6X4', 'LABEL_4X4', 'A4_LEFT', 'A4_RIGHT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'MANAGER', 'OPERATOR', 'READ_ONLY');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"currency" varchar(3) DEFAULT 'GBP' NOT NULL,
	"stationery" "stationery" DEFAULT 'LABEL_6X4' NOT NULL,
	"status" "account_status" DEFAULT 'TRIAL' NOT NULL,
	"billing_mode" "billing_mode" DEFAULT 'MOLLIE' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"mollie_customer_id" varchar(64),
	"mollie_mandate_id" varchar(64),
	"mollie_subscription_id" varchar(64),
	"failed_payments" integer DEFAULT 0 NOT NULL,
	"last_paid_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(200) NOT NULL,
	"name" varchar(200) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"kind" varchar(16) DEFAULT 'api' NOT NULL,
	"client_name" varchar(120),
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"mollie_payment_id" varchar(64) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GBP' NOT NULL,
	"status" varchar(30) NOT NULL,
	"sequence_type" varchar(16),
	"paid_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email" varchar(200) NOT NULL,
	"name" varchar(200) NOT NULL,
	"role" "user_role" DEFAULT 'OPERATOR' NOT NULL,
	"password_hash" varchar(255),
	"invite_token" varchar(128),
	"invite_expires_at" timestamp with time zone,
	"reset_token" varchar(128),
	"reset_expires_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"url" varchar(500) NOT NULL,
	"secret" varchar(128) NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "address_book" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"contact_name" varchar(120),
	"company" varchar(120),
	"line1" varchar(255),
	"line2" varchar(255),
	"city" varchar(100),
	"region" varchar(100),
	"post_code" varchar(20),
	"country" varchar(2),
	"phone" varchar(50),
	"email" varchar(200),
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" varchar(100) NOT NULL,
	"name" varchar(500) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_value" numeric(12, 2),
	"weight" numeric(10, 3),
	"length" numeric(10, 1),
	"width" numeric(10, 1),
	"height" numeric(10, 1),
	"hs_code" varchar(20),
	"country_of_origin" varchar(2),
	"customs_description" varchar(200),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_number" varchar(100) NOT NULL,
	"external_ref" varchar(100),
	"source" "order_source" DEFAULT 'manual' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"order_date" date NOT NULL,
	"customer_name" varchar(200),
	"customer_email" varchar(200),
	"customer_phone" varchar(50),
	"contact_name" varchar(120),
	"company" varchar(120),
	"line1" varchar(255),
	"line2" varchar(255),
	"city" varchar(100),
	"region" varchar(100),
	"post_code" varchar(20),
	"country" varchar(2),
	"phone" varchar(50),
	"email" varchar(200),
	"delivery_promise" "delivery_promise" DEFAULT 'standard' NOT NULL,
	"deliver_by" date,
	"incoterm" "incoterm",
	"declared_value" numeric(12, 2),
	"currency_code" varchar(3) DEFAULT 'GBP' NOT NULL,
	"signature" boolean DEFAULT false NOT NULL,
	"fragile" boolean DEFAULT false NOT NULL,
	"liquid" boolean DEFAULT false NOT NULL,
	"batteries" boolean DEFAULT false NOT NULL,
	"requested_method" varchar(120),
	"requested_courier" varchar(120),
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"problem_reason" "problem_kind",
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selection" jsonb,
	"shipment_id" uuid,
	"courier_name" varchar(120),
	"method_name" varchar(120),
	"cost" numeric(12, 2),
	"tracking_number" varchar(100),
	"tracking_link" varchar(500),
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"label_wanted" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"weight" numeric(10, 3) NOT NULL,
	"length" numeric(10, 1) NOT NULL,
	"width" numeric(10, 1) NOT NULL,
	"height" numeric(10, 1) NOT NULL,
	"contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"label_document_id" uuid,
	"tracking_number" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"stock_code" varchar(100) NOT NULL,
	"ean" varchar(50),
	"brand" varchar(120),
	"description" text,
	"weight" numeric(10, 3),
	"length" numeric(10, 1),
	"width" numeric(10, 1),
	"height" numeric(10, 1),
	"hs_code" varchar(20),
	"country_of_origin" varchar(2),
	"customs_description" varchar(200),
	"unit_value" numeric(12, 2),
	"integration_skus" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_source" "data_source" DEFAULT 'manual' NOT NULL,
	"data_confidence" numeric(4, 3),
	"data_source_url" varchar(500),
	"suggested" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"external_ref" varchar(100),
	"contact_name" varchar(120),
	"company" varchar(120),
	"line1" varchar(255),
	"line2" varchar(255),
	"city" varchar(100),
	"region" varchar(100),
	"post_code" varchar(20),
	"country" varchar(2),
	"phone" varchar(50),
	"email" varchar(200),
	"is_default" boolean DEFAULT false NOT NULL,
	"eori" varchar(30),
	"vat_number" varchar(30),
	"ioss_number" varchar(30),
	"stationery" "stationery",
	"auto_label" boolean DEFAULT true NOT NULL,
	"packing_note" boolean DEFAULT true NOT NULL,
	"shipped_after_hours" integer DEFAULT 24 NOT NULL,
	"allowed_method_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courier_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"credentials_enc" text,
	"sandbox" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"session_enc" text,
	"session_expires_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courier_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"key" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"origin" "profile_origin" DEFAULT 'own' NOT NULL,
	"review" "profile_review" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_profile_id" uuid,
	"definition" jsonb NOT NULL,
	"credential_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tests_passed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"contributor_name" varchar(120),
	"opt_out_sharing" boolean DEFAULT false NOT NULL,
	"adoptions" integer DEFAULT 0 NOT NULL,
	"live_labels" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lane_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"country" varchar(2) NOT NULL,
	"method_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_method_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method_id" uuid NOT NULL,
	"min_weight_kg" numeric(10, 3) NOT NULL,
	"max_weight_kg" numeric(10, 3) NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"source" "data_source" DEFAULT 'manual' NOT NULL,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"courier_account_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"service_code" varchar(80) NOT NULL,
	"origin_country" varchar(2) DEFAULT 'GB' NOT NULL,
	"destination_countries" text[] DEFAULT '{}' NOT NULL,
	"excluded_postcode_prefixes" text[] DEFAULT '{}' NOT NULL,
	"tracked" boolean DEFAULT true NOT NULL,
	"signature" boolean DEFAULT false NOT NULL,
	"express" boolean DEFAULT false NOT NULL,
	"allows_liquid" boolean DEFAULT true NOT NULL,
	"allows_batteries" boolean DEFAULT true NOT NULL,
	"allows_fragile" boolean DEFAULT true NOT NULL,
	"returns_service" boolean DEFAULT false NOT NULL,
	"max_transit_days" integer DEFAULT 3 NOT NULL,
	"volumetric_divisor" integer DEFAULT 5000 NOT NULL,
	"min_weight_kg" numeric(10, 3) DEFAULT '0' NOT NULL,
	"max_weight_kg" numeric(10, 3) DEFAULT '30' NOT NULL,
	"max_length_cm" numeric(10, 1),
	"max_girth_cm" numeric(10, 1),
	"max_thinnest_cm" numeric(10, 1),
	"max_declared_value" numeric(12, 2),
	"preferred" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"surcharges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"job" varchar(60) NOT NULL,
	"model" varchar(60) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_gbp" numeric(10, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" varchar(120),
	"actor_name" varchar(200),
	"client_name" varchar(120),
	"kind" "audit_kind" DEFAULT 'action' NOT NULL,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_id" uuid,
	"parcel_id" uuid,
	"kind" "document_kind" NOT NULL,
	"stationery" varchar(20),
	"file_path" varchar(255) NOT NULL,
	"page_count" integer DEFAULT 1 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"void_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "problem_kind" NOT NULL,
	"description" text NOT NULL,
	"suggested_action" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"resolved_by" varchar(120),
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "shipment_kind" DEFAULT 'outbound' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"courier_account_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"method_id" uuid,
	"method_name" varchar(120),
	"courier_name" varchar(120),
	"service_code" varchar(80),
	"status" "shipment_status" DEFAULT 'PENDING' NOT NULL,
	"courier_reference" varchar(120),
	"tracking_number" varchar(100),
	"tracking_url" varchar(500),
	"cost" numeric(12, 2),
	"courier_cost" numeric(12, 2),
	"chargeable_kg" numeric(10, 3),
	"error_message" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"idempotency_key" varchar(200) NOT NULL,
	"voided_at" timestamp with time zone,
	"void_note" text,
	"last_tracked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"courier_status" varchar(120) NOT NULL,
	"mapped_status" "order_status",
	"problem_kind" "problem_kind",
	"location" varchar(200),
	"description" text,
	"raw" jsonb,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmapped_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"courier_status" varchar(120) NOT NULL,
	"sample" text,
	"seen" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_book" ADD CONSTRAINT "address_book_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_profile_id_courier_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."courier_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_profiles" ADD CONSTRAINT "courier_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_defaults" ADD CONSTRAINT "lane_defaults_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_defaults" ADD CONSTRAINT "lane_defaults_method_id_shipping_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_method_bands" ADD CONSTRAINT "shipping_method_bands_method_id_shipping_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_courier_account_id_courier_accounts_id_fk" FOREIGN KEY ("courier_account_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courier_account_id_courier_accounts_id_fk" FOREIGN KEY ("courier_account_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_profile_id_courier_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."courier_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_method_id_shipping_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmapped_statuses" ADD CONSTRAINT "unmapped_statuses_profile_id_courier_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."courier_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_slug_unq" ON "accounts" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_unq" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_unq" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_account_idx" ON "api_keys" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_mollie_unq" ON "payments" USING btree ("mollie_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_account_idx" ON "users" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "webhooks_account_idx" ON "webhooks" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "address_book_account_idx" ON "address_book" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_account_number_unq" ON "orders" USING btree ("account_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_account_status_idx" ON "orders" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "orders_tracking_idx" ON "orders" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "parcels_order_idx" ON "parcels" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_account_sku_unq" ON "products" USING btree ("account_id","stock_code");--> statement-breakpoint
CREATE INDEX "warehouses_account_idx" ON "warehouses" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "courier_accounts_account_idx" ON "courier_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "courier_profiles_account_idx" ON "courier_profiles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "courier_profiles_key_idx" ON "courier_profiles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "lane_defaults_unq" ON "lane_defaults" USING btree ("warehouse_id","country");--> statement-breakpoint
CREATE INDEX "bands_method_idx" ON "shipping_method_bands" USING btree ("method_id","effective_from");--> statement-breakpoint
CREATE INDEX "shipping_methods_account_idx" ON "shipping_methods" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_usage_account_day_idx" ON "ai_usage" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_account_idx" ON "audit_log" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_order_idx" ON "documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "problems_account_open_idx" ON "problems" USING btree ("account_id","resolved_at");--> statement-breakpoint
CREATE INDEX "problems_order_idx" ON "problems" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_account_status_idx" ON "shipments" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "shipments_tracking_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "tracking_events_shipment_idx" ON "tracking_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tracking_events_dedupe_idx" ON "tracking_events" USING btree ("shipment_id","dedupe_key");