import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, NeedsInformationError, NoMethodError } from './errors.js';

export function errorHandler(err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof NeedsInformationError) {
    return reply.status(422).send({
      status: 'needs_information',
      reference: err.reference,
      orderStatus: err.orderStatus,
      missing: err.missing,
      resume: `POST /v4/orders/${encodeURIComponent(err.reference)}/label`,
    });
  }
  if (err instanceof NoMethodError) {
    return reply.status(422).send({ status: 'no_method', reference: err.reference, dropped: err.dropped });
  }
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? undefined } });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: { code: 'validation', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  const fe = err as FastifyError;
  if (fe.validation) {
    return reply.status(400).send({ error: { code: 'validation', message: fe.message } });
  }
  if (fe.statusCode && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'error', message: fe.message } });
  }
  request.log.error({ err }, 'unhandled error');
  if (process.env.NODE_ENV === 'test') console.error('[unhandled]', err);
  const message = process.env.NODE_ENV === 'production' ? 'Something went wrong' : (err as Error).message;
  return reply.status(500).send({ error: { code: 'internal', message } });
}
