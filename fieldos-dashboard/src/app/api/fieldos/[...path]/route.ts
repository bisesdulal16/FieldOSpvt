import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  let apiPath = path.join('/');

  // Prepend 'manager/' for bare paths that map to the manager router
  // (dashboard, staff, visits, collections, par-followup, ptp-today, exceptions, eod-reviews, sync-status, audit-logs)
  // Don't auto-prefix if the path already contains a module prefix
  const knownModules = ['cbs', 'security', 'pilot', 'auth', 'mobile', 'voice-ai', 'manager'];
  if (!knownModules.some((m) => apiPath.startsWith(m + '/'))) {
    apiPath = 'manager/' + apiPath;
  }

  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${BACKEND_URL}/api/v1/${apiPath}${searchParams ? '?' + searchParams : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('Authorization')
          ? { Authorization: request.headers.get('Authorization')! }
          : {}),
      },
      cache: 'no-store',
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error(`[API Proxy] GET /${apiPath} error:`, error);
    return NextResponse.json(
      { success: false, data: null, detail: 'Backend unavailable' },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyHandler('POST', request, { params });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyHandler('PUT', request, { params });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyHandler('PATCH', request, { params });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyHandler('DELETE', request, { params });
}

async function proxyHandler(
  method: string,
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  let apiPath = path.join('/');

  const knownModules = ['cbs', 'security', 'pilot', 'auth', 'mobile', 'voice-ai', 'manager'];
  if (!knownModules.some((m) => apiPath.startsWith(m + '/'))) {
    apiPath = 'manager/' + apiPath;
  }

  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${BACKEND_URL}/api/v1/${apiPath}${searchParams ? '?' + searchParams : ''}`;

  try {
    let body: string | null = null;
    if (method !== 'GET' && request.headers.get('content-type')?.includes('application/json')) {
      body = await request.text();
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('Authorization')
          ? { Authorization: request.headers.get('Authorization')! }
          : {}),
      },
      body,
      cache: 'no-store',
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error(`[API Proxy] ${method} /${apiPath} error:`, error);
    return NextResponse.json(
      { success: false, data: null, detail: 'Backend unavailable' },
      { status: 502 }
    );
  }
}
