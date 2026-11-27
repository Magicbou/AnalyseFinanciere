export async function onRequestGet(): Promise<Response> {
  return Response.json({ status: "ok", service: "investpilot-api", version: "0.2.0", timestamp: new Date().toISOString() }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
