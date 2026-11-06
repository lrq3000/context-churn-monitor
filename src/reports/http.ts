import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function authorized(request: IncomingMessage, token: string): boolean {
  const actual = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Bound incoming data before parsing; report/consent endpoints never need arbitrary files or an unbounded request body. */
export async function body(request: IncomingMessage, limit = 128_000): Promise<any> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new Error('Request exceeds size limit');
    parts.push(Buffer.from(part));
  }
  return parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
}

export function respond(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
