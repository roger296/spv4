/**
 * A fake courier API for tests. Two flavours on one server:
 *  - /cd/*   header-key auth, Click & Drop shaped (label inline as base64 PDF)
 *  - /dpd/*  login exchange → session header, label fetched by a second call, track endpoint
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export interface FakeState {
  created: { id: string; body: unknown; flavour: string }[];
  voided: string[];
  labelFetches: number;
  logins: number;
  failNextCreate: { status: number; message: string } | null;
  trackingEvents: Record<string, { status: string; time: string; location?: string }[]>;
}

async function labelPdf(text: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([288, 432]); // 4x6 in
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`FAKE LABEL ${text}`, { x: 20, y: 400, size: 14, font });
  return Buffer.from(await doc.save()).toString('base64');
}

export async function startFakeCourier(): Promise<{ app: FastifyInstance; url: string; state: FakeState }> {
  const state: FakeState = { created: [], voided: [], labelFetches: 0, logins: 0, failNextCreate: null, trackingEvents: {} };
  const app = Fastify({ logger: false });
  let seq = 1000;

  // ---- Click & Drop flavour ----
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/cd/')) {
      if (req.headers.authorization !== 'cd-key-123') return reply.status(401).send({ message: 'bad key' });
    }
  });
  app.get('/cd/version', async () => ({ version: '1.0' }));
  app.post('/cd/orders', async (req, reply) => {
    if (state.failNextCreate) { const f = state.failNextCreate; state.failNextCreate = null; return reply.status(f.status).send({ failedOrders: [{ errors: [{ errorMessage: f.message }] }] }); }
    const body = req.body as { items: { orderReference: string; packages: unknown[] }[] };
    const item = body.items[0]!;
    if (!item.packages?.length) return reply.status(200).send({ successCount: 0, errorsCount: 1, failedOrders: [{ orderReference: item.orderReference, errors: [{ errorMessage: 'packages required' }] }] });
    const id = String(++seq);
    state.created.push({ id, body, flavour: 'cd' });
    return { successCount: 1, errorsCount: 0, createdOrders: [{ orderIdentifier: Number(id), orderReference: item.orderReference, trackingNumber: `TT${id}GB`, label: await labelPdf(id) }] };
  });
  app.get('/cd/orders/:id/label', async (req, reply) => {
    state.labelFetches++;
    const b64 = await labelPdf((req.params as { id: string }).id);
    return reply.type('application/pdf').send(Buffer.from(b64, 'base64'));
  });
  app.delete('/cd/orders/:id', async (req) => { state.voided.push((req.params as { id: string }).id); return { deletedOrders: [Number((req.params as { id: string }).id)] }; });

  // ---- DPD flavour ----
  app.post('/dpd/user/', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Basic ${Buffer.from('dpduser:dpdpass').toString('base64')}`) return reply.status(401).send({ error: { errorMessage: 'bad login' } });
    state.logins++;
    return { data: { geoSession: `sess-${state.logins}` } };
  });
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/dpd/shipping') || req.url.startsWith('/dpd/tracking')) {
      if (!String(req.headers.geosession ?? '').startsWith('sess-')) return reply.status(401).send({ error: { errorMessage: 'no session' } });
      if (req.headers.geoclient !== 'account/ACC1') return reply.status(403).send({ error: { errorMessage: 'bad account' } });
    }
  });
  app.get('/dpd/shipping/network/', async () => ({ data: [{ networkCode: '1^12' }] }));
  app.post('/dpd/shipping/shipment', async (req) => {
    const id = String(++seq);
    state.created.push({ id, body: req.body, flavour: 'dpd' });
    return { data: { shipmentId: Number(id), consignmentDetail: [{ consignmentNumber: `155${id}`, parcelNumbers: [`155${id}01`] }] }, error: null };
  });
  app.get('/dpd/shipping/shipment/:id/label', async (req, reply) => {
    state.labelFetches++;
    return reply.type('application/pdf').send(Buffer.from(await labelPdf((req.params as { id: string }).id), 'base64'));
  });
  app.delete('/dpd/shipping/shipment/:id', async (req) => { state.voided.push((req.params as { id: string }).id); return { data: 'ok', error: null }; });
  app.get('/dpd/tracking/trackingByParcelNumber', async (req) => {
    const code = (req.query as { parcelCode: string }).parcelCode;
    return { data: { trackingEvent: (state.trackingEvents[code] ?? []).map((e) => ({ trackingEventStatus: e.status, trackingEventDate: e.time, trackingEventLocation: e.location ?? '' })) }, error: null };
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, url: `http://127.0.0.1:${port}`, state };
}
