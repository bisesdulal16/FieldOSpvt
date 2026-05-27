module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/Downloads/FIELDOS/fieldos-dashboard/src/app/api/fieldos/[...path]/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DELETE",
    ()=>DELETE,
    "GET",
    ()=>GET,
    "PATCH",
    ()=>PATCH,
    "POST",
    ()=>POST,
    "PUT",
    ()=>PUT
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$FIELDOS$2f$fieldos$2d$dashboard$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/FIELDOS/fieldos-dashboard/node_modules/next/server.js [app-route] (ecmascript)");
;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
async function GET(request, { params }) {
    const { path } = await params;
    let apiPath = path.join('/');
    // Prepend 'manager/' for bare paths that map to the manager router
    // (dashboard, staff, visits, collections, par-followup, ptp-today, exceptions, eod-reviews, sync-status, audit-logs)
    // Don't auto-prefix if the path already contains a module prefix
    const knownModules = [
        'cbs',
        'security',
        'pilot',
        'auth',
        'mobile',
        'voice-ai',
        'manager'
    ];
    if (!knownModules.some((m)=>apiPath.startsWith(m + '/'))) {
        apiPath = 'manager/' + apiPath;
    }
    const searchParams = request.nextUrl.searchParams.toString();
    const url = `${BACKEND_URL}/api/v1/${apiPath}${searchParams ? '?' + searchParams : ''}`;
    try {
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...request.headers.get('Authorization') ? {
                    Authorization: request.headers.get('Authorization')
                } : {}
            },
            cache: 'no-store'
        });
        const data = await res.json();
        return __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$FIELDOS$2f$fieldos$2d$dashboard$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(data, {
            status: res.status
        });
    } catch (error) {
        console.error(`[API Proxy] GET /${apiPath} error:`, error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$FIELDOS$2f$fieldos$2d$dashboard$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: false,
            data: null,
            detail: 'Backend unavailable'
        }, {
            status: 502
        });
    }
}
async function POST(request, { params }) {
    return proxyHandler('POST', request, {
        params
    });
}
async function PUT(request, { params }) {
    return proxyHandler('PUT', request, {
        params
    });
}
async function PATCH(request, { params }) {
    return proxyHandler('PATCH', request, {
        params
    });
}
async function DELETE(request, { params }) {
    return proxyHandler('DELETE', request, {
        params
    });
}
async function proxyHandler(method, request, ctx) {
    const { path } = await ctx.params;
    let apiPath = path.join('/');
    const knownModules = [
        'cbs',
        'security',
        'pilot',
        'auth',
        'mobile',
        'voice-ai',
        'manager'
    ];
    if (!knownModules.some((m)=>apiPath.startsWith(m + '/'))) {
        apiPath = 'manager/' + apiPath;
    }
    const searchParams = request.nextUrl.searchParams.toString();
    const url = `${BACKEND_URL}/api/v1/${apiPath}${searchParams ? '?' + searchParams : ''}`;
    try {
        let body = null;
        if (method !== 'GET' && request.headers.get('content-type')?.includes('application/json')) {
            body = await request.text();
        }
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...request.headers.get('Authorization') ? {
                    Authorization: request.headers.get('Authorization')
                } : {}
            },
            body,
            cache: 'no-store'
        });
        const data = await res.json();
        return __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$FIELDOS$2f$fieldos$2d$dashboard$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(data, {
            status: res.status
        });
    } catch (error) {
        console.error(`[API Proxy] ${method} /${apiPath} error:`, error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$FIELDOS$2f$fieldos$2d$dashboard$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: false,
            data: null,
            detail: 'Backend unavailable'
        }, {
            status: 502
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0~rk2c4._.js.map