import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

const defaultOrigins = [
  "https://mswiimura-beep.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];

function allowedOrigins() {
  const configured = (Deno.env.get("AMBR_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : defaultOrigins);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = allowedOrigins();
  return {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : defaultOrigins[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function bearerToken(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || "";
}

async function handleRequest(request: Request) {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins().has(origin)) return json(request, { error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "POST required" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json(request, { error: "Server configuration is incomplete" }, 503);
  }

  const targetAccessToken = bearerToken(request);
  if (!targetAccessToken) return json(request, { error: "Target authentication required" }, 401);

  let sourceAccessToken = "";
  try {
    const rawBody = await request.text();
    if (rawBody.length > 16_384) return json(request, { error: "Request too large" }, 413);
    const body = JSON.parse(rawBody);
    sourceAccessToken = typeof body?.sourceAccessToken === "string" ? body.sourceAccessToken.trim() : "";
  } catch {
    return json(request, { error: "Invalid JSON" }, 400);
  }
  if (!sourceAccessToken || sourceAccessToken.length > 8192 || sourceAccessToken === targetAccessToken) {
    return json(request, { error: "Separate source authentication required" }, 400);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: sourceData, error: sourceError }, { data: targetData, error: targetError }] =
    await Promise.all([
      authClient.auth.getUser(sourceAccessToken),
      authClient.auth.getUser(targetAccessToken),
    ]);
  const sourceUser = sourceData.user;
  const targetUser = targetData.user;
  if (sourceError || !sourceUser) return json(request, { error: "Source authentication is invalid" }, 401);
  if (targetError || !targetUser) return json(request, { error: "Target authentication is invalid" }, 401);
  if (!sourceUser.is_anonymous) return json(request, { error: "Source account must be anonymous" }, 409);
  if (targetUser.is_anonymous) return json(request, { error: "Target account must be permanent" }, 409);
  if (sourceUser.id === targetUser.id) return json(request, { error: "Accounts must be different" }, 409);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: merged, error: mergeError } = await serviceClient.rpc("merge_anonymous_user_data", {
    source_user: sourceUser.id,
    target_user: targetUser.id,
  });
  if (mergeError) return json(request, { error: "Ownership merge failed" }, 409);

  // Keep the old Auth row for rollback/audit. The migration tombstone blocks
  // every old-JWT write immediately; later deletion requires a separate,
  // explicitly approved retention procedure.
  return json(request, {
    merged,
    sourceAccountRetainedForAudit: true,
  });
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch {
    return json(request, { error: "Unexpected server failure" }, 500);
  }
});
