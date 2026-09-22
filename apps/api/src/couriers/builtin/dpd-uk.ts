/**
 * Built-in profile: DPD UK (api.dpd.co.uk, Geopost UK).
 * Written from public documentation (September 2026). DPD has no sandbox: labels that are
 * never scanned are not charged, so the Test step creates and immediately voids a shipment.
 * DPD audits an integration before enabling it on a live account. VERIFY the tracking path
 * and network codes at first test.
 */
import type { BuiltinProfile } from './index.js';

export const dpdUk: BuiltinProfile = {
  key: 'dpd-uk',
  name: 'DPD UK',
  credentialSchema: [
    { key: 'username', label: 'API username', required: true, help: 'Provided by DPD for API access (not your MyDPD login)' },
    { key: 'password', label: 'API password', secret: true, required: true },
    { key: 'accountNumber', label: 'DPD account number', required: true, help: 'Your DPD customer account number, sent as GeoClient account/<number>' },
  ],
  services: [
    { code: '1^12', name: 'DPD Next Day', tracked: true, maxTransitDays: 1, domestic: true, limits: { maxWeightKg: 30, maxLengthCm: 100 } },
    { code: '1^32', name: 'DPD Two Day', tracked: true, maxTransitDays: 2, domestic: true, limits: { maxWeightKg: 30, maxLengthCm: 100 } },
    { code: '1^09', name: 'DPD 12:00', tracked: true, express: true, maxTransitDays: 1, domestic: true },
    { code: '1^13', name: 'DPD 10:30', tracked: true, express: true, maxTransitDays: 1, domestic: true },
    { code: '1^16', name: 'DPD Saturday', tracked: true, express: true, maxTransitDays: 1, domestic: true },
    { code: '2^12', name: 'DPD Sunday', tracked: true, express: true, maxTransitDays: 1, domestic: true },
    { code: '1^19', name: 'DPD Classic (Europe)', tracked: true, maxTransitDays: 5, international: true },
    { code: '1^21', name: 'DPD Air Express', tracked: true, express: true, maxTransitDays: 3, international: true },
  ],
  definition: {
    version: 1,
    baseUrl: 'https://api.dpd.co.uk',
    timeoutMs: 30_000,
    rateLimitPerMinute: 120,
    headers: { GeoClient: 'account/{{ cred.accountNumber }}' },
    auth: {
      kind: 'login',
      request: { method: 'POST', path: '/user/?action=login', contentType: 'none', responseType: 'json', errorPath: 'error.errorMessage' },
      basic: { username: '{{ cred.username }}', password: '{{ cred.password }}' },
      tokenPath: 'data.geoSession',
      header: 'GeoSession',
      prefix: '',
      ttlMinutes: 720,
      retryOn401: true,
    },
    accountFields: ['accountNumber'],
    notes: 'GeoSession tokens last about 12 hours and are refreshed automatically. Network codes (1^12 Next Day etc.) depend on your contract: check them in MyDPD before trusting the defaults. VERIFY: tracking endpoint path.',
    operations: {
      auth_test: { method: 'GET', path: '/shipping/network/', query: { businessUnit: '0', deliveryDirection: '1' }, responseType: 'json', errorPath: 'error.errorMessage' },
      create_shipment: {
        method: 'POST',
        path: '/shipping/shipment',
        body: {
          jobId: null,
          collectionOnDelivery: false,
          invoice: null,
          collectionDate: '{{ now | date:YYYY-MM-DD }}T16:00:00',
          consolidate: false,
          consignment: [
            {
              consignmentNumber: null,
              consignmentRef: null,
              parcels: [],
              collectionDetails: {
                contactDetails: { contactName: '{{ warehouse.contactName | default:warehouse.company | truncate:35 }}', telephone: '{{ warehouse.phone | truncate:15 }}' },
                address: {
                  organisation: '{{ warehouse.company | truncate:35 }}',
                  countryCode: '{{ warehouse.country }}',
                  postcode: '{{ warehouse.postCode | truncate:8 }}',
                  street: '{{ warehouse.line1 | truncate:35 }}',
                  'locality?': '{{ warehouse.line2 | truncate:35 }}',
                  town: '{{ warehouse.city | truncate:35 }}',
                  'county?': '{{ warehouse.region | truncate:35 }}',
                },
              },
              deliveryDetails: {
                contactDetails: { contactName: '{{ order.contactName | truncate:35 }}', telephone: '{{ order.phone | default:warehouse.phone | truncate:15 }}' },
                address: {
                  'organisation?': '{{ order.company | truncate:35 }}',
                  countryCode: '{{ order.country }}',
                  postcode: '{{ order.postCode | truncate:8 }}',
                  street: '{{ order.line1 | truncate:35 }}',
                  'locality?': '{{ order.line2 | truncate:35 }}',
                  town: '{{ order.city | truncate:35 }}',
                  'county?': '{{ order.region | truncate:35 }}',
                },
                notificationDetails: { 'email?': '{{ order.email }}', 'mobile?': '{{ order.phone | digits }}' },
              },
              networkCode: '{{ method.serviceCode }}',
              numberOfParcels: '{{ parcels | length }}',
              totalWeight: '{{ parcels | sum:weightKg | round:2 }}',
              shippingRef1: '{{ shipment.reference | truncate:25 }}',
              'shippingRef2?': '{{ order.customerName | truncate:25 }}',
              shippingRef3: '',
              'customsValue?': { $includeIf: 'order.international', $if: 'order.international', then: '{{ order.goodsValue | round:2 }}' },
              'deliveryInstructions?': '',
              parcelDescription: '{{ order.description | truncate:50 }}',
              liabilityValue: null,
              liability: false,
            },
          ],
        },
        successWhen: { path: 'data.shipmentId' },
        errorPath: 'error.errorMessage',
        response: {
          courierReference: 'data.shipmentId',
          trackingNumber: 'data.consignmentDetail[0].consignmentNumber',
          parcels: { path: 'data.consignmentDetail[0].parcelNumbers', trackingNumber: '' },
        },
      },
      get_label: {
        method: 'GET',
        path: '/shipping/shipment/{{ shipment.courierReference }}/label',
        query: { labelFormat: 'pdf' },
        headers: { Accept: 'application/pdf' },
        responseType: 'binary',
      },
      void_shipment: {
        method: 'DELETE',
        path: '/shipping/shipment/{{ shipment.courierReference }}',
        errorPath: 'error.errorMessage',
      },
      track: {
        method: 'GET',
        path: '/tracking/trackingByParcelNumber',
        query: { parcelCode: '{{ shipment.trackingNumber }}' },
        responseType: 'json',
        errorPath: 'error.errorMessage',
        response: {
          events: 'data.trackingEvent',
          status: 'trackingEventStatus',
          time: 'trackingEventDate',
          location: 'trackingEventLocation',
          description: 'trackingEventStatus',
        },
      },
    },
    label: { format: 'pdf', source: 'operation', nativeSize: '6x4' },
    trackingUrlTemplate: 'https://track.dpd.co.uk/parcels/{{ shipment.trackingNumber }}',
    statusMap: [
      { match: 're:collected|received at|we have your parcel', status: 'SHIPPED' },
      { match: 're:in transit|depot|hub|sorted|on its way|out for delivery|driver|loaded|arrived', status: 'IN_TRANSIT' },
      { match: 're:delivered', status: 'DELIVERED' },
      { match: 're:unable to deliver|not delivered|carded|attempted|refused|address query', status: 'PROBLEM', problem: 'delivery_failed' },
      { match: 're:return|back to sender', status: 'PROBLEM', problem: 'returning' },
      { match: 're:customs|held|awaiting', status: 'PROBLEM', problem: 'held' },
      { match: 're:damaged|lost|missing', status: 'PROBLEM', problem: 'damaged_lost' },
    ],
    retryOn: [429, 502, 503, 504],
  },
};
