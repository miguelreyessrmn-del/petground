// qz-sign — firma las peticiones de QZ Tray para que no pidan confirmación.
//
// Recibe:  POST con el texto que QZ manda a firmar (hash SHA-256 en hex, 64 chars).
// Firma:   RSA PKCS#1 v1.5 + SHA-512 (lo que QZ espera con setSignatureAlgorithm('SHA512')).
// Devuelve: la firma en base64 (text/plain).
//
// Secretos (Supabase → Edge Functions → Secrets, nunca en Git ni en el navegador):
//   QZ_PRIVATE_KEY      clave privada PKCS#8 (PEM completo o solo el base64 del cuerpo)
//   QZ_ALLOWED_ORIGINS  orígenes permitidos separados por coma
//
// SEGURIDAD PROVISIONAL: hoy PetGround no tiene Supabase Auth, así que el único
// control es el Origin + CORS. Eso detiene a otras páginas web en el navegador,
// pero NO a alguien que llame a este endpoint desde un servidor. NO es la
// seguridad final para un SaaS multi-hotel: cuando exista Supabase Auth/RLS,
// esta función debe exigir un JWT de usuario autenticado.
// No toca la base de datos.

const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_BODY = 128;
const RATE_LIMIT = 60;          // firmas por minuto por IP (mejor esfuerzo, por instancia)
const RATE_WINDOW_MS = 60_000;

const allowedOrigins = (Deno.env.get("QZ_ALLOWED_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const raw = Deno.env.get("QZ_PRIVATE_KEY") ?? "";
    const b64 = raw.replace(/-----[^-]+-----/g, "").replace(/\\n|\s/g, "");
    const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    keyPromise = crypto.subtle.importKey(
      "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }, false, ["sign"],
    );
    keyPromise.catch(() => { keyPromise = null; });
  }
  return keyPromise;
}

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function reply(status: number, body: string | null, origin: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, apikey, authorization, x-client-info";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(body, { status, headers });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) return reply(403, "forbidden", null);
  if (req.method === "OPTIONS") return reply(204, null, origin);
  if (req.method !== "POST") return reply(405, "method not allowed", origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return reply(429, "too many requests", origin);

  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (len > MAX_BODY) return reply(413, "payload too large", origin);
  const body = await req.text();
  if (body.length > MAX_BODY) return reply(413, "payload too large", origin);
  const toSign = body.trim();
  if (!HASH_RE.test(toSign)) return reply(400, "invalid request", origin);

  try {
    const key = await getKey();
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign));
    let bin = "";
    for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
    return reply(200, btoa(bin), origin);
  } catch (e) {
    console.error("qz-sign: no se pudo firmar", e instanceof Error ? e.name : "error");
    return reply(500, "signing unavailable", origin);
  }
});
