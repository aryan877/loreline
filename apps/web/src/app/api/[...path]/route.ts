const MAX_GATEWAY_BODY_SIZE = 2 * 1024 * 1024;
const serverUrl = process.env.SERVER_INTERNAL_URL ?? "http://127.0.0.1:3001";

type GatewayContext = {
  params: Promise<{ path: string[] }>;
};

async function forward(request: Request, context: GatewayContext) {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentType.toLowerCase().startsWith("application/pdf")) {
    return Response.json(
      { error: "PDF files must upload directly to the signed storage URL." },
      { status: 415 },
    );
  }
  if (contentLength > MAX_GATEWAY_BODY_SIZE) {
    return Response.json(
      { error: "The request is too large." },
      { status: 413 },
    );
  }

  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `/api/${path.map(encodeURIComponent).join("/")}${incomingUrl.search}`,
    serverUrl,
  );
  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete("connection");
  upstreamHeaders.delete("content-length");
  upstreamHeaders.delete("host");
  upstreamHeaders.set("x-forwarded-host", incomingUrl.host);
  upstreamHeaders.set("x-forwarded-proto", incomingUrl.protocol.slice(0, -1));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > MAX_GATEWAY_BODY_SIZE) {
    return Response.json(
      { error: "The request is too large." },
      { status: 413 },
    );
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      body,
      headers: upstreamHeaders,
      method: request.method,
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("connection");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");

    return new Response(upstream.body, {
      headers: responseHeaders,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch (error) {
    console.error("Loreline API gateway error", error);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 502 },
    );
  }
}

export const DELETE = forward;
export const GET = forward;
export const HEAD = forward;
export const PATCH = forward;
export const POST = forward;
export const PUT = forward;
