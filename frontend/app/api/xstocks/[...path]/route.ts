import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const XSTOCKS_BASE = process.env.XSTOCKS_API_BASE ?? 'https://api.xstocks.fi/api/v2';

/**
 * Server-side proxy for xStocks API calls.
 * Avoids CORS issues and keeps the API base URL out of the client bundle.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const path = pathSegments.join('/');
  const { searchParams } = new URL(req.url);

  try {
    const res = await axios.get(`${XSTOCKS_BASE}/${path}`, {
      params: Object.fromEntries(searchParams),
      timeout: 10_000,
    });
    return NextResponse.json(res.data);
  } catch (err: any) {
    const status = err.response?.status ?? 500;
    return NextResponse.json(
      { error: err.message, path },
      { status }
    );
  }
}
