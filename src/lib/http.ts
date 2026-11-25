import { NextResponse } from "next/server";

export const TICKER_RE = /^[A-Za-z0-9.^=\-]{1,32}$/;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=20",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function bad(message: string, status = 400): NextResponse {
  return json({ error: message }, status);
}
