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

  // The v2 API uses the title-cased network enum even when callers use the
  // conventional lowercase query value.
  const queryParams = Object.fromEntries(searchParams);
  if (typeof queryParams.network === 'string') {
    queryParams.network = queryParams.network.toLowerCase() === 'solana'
      ? 'Solana'
      : queryParams.network;
  }

  try {
    let res;
    try {
      res = await axios.get(`${XSTOCKS_BASE}/${path}`, {
        params: queryParams,
        timeout: 10_000,
      });
    } catch (err: any) {
      // xStocks documentation uses SPYx while the Solana deployment and UI
      // use SPYX. Preserve the requested public v2 route, but support the
      // provider's canonical symbol casing when necessary.
      if (err.response?.status !== 404 || !path.startsWith('public/assets/SPYX/')) throw err;
      const aliasPath = path.replace('public/assets/SPYX/', 'public/assets/SPYx/');
      res = await axios.get(`${XSTOCKS_BASE}/${aliasPath}`, {
        params: queryParams,
        timeout: 10_000,
      });
    }
    return NextResponse.json(res.data);
  } catch (err: any) {
    const status = err.response?.status ?? 500;
    return NextResponse.json(
      { error: err.message, path },
      { status }
    );
  }
}
