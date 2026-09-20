const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_REQUEST_BYTES = 30_000;
const CELLS = new Set(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * This is deliberately not a generic TypeSafe proxy. It only accepts the
 * tic-tac-toe shape used by the UI, so the public endpoint cannot be used to
 * submit arbitrary TypeSafe workloads through the owner's API key.
 */
function validateTicTacToeRequest(body) {
  if (!isObject(body) || body.model !== "jev-latest") {
    return "Only model jev-latest is allowed.";
  }

  const state = body.state;
  const question = body.questions?.next_move;
  if (!isObject(state) || !isObject(question)) {
    return "A tic-tac-toe state and next_move question are required.";
  }
  if (question.type !== "choice" || !isObject(question.criteria)) {
    return "next_move must be a choice with criteria.";
  }

  const rows = state.board?.rows;
  if (!Array.isArray(rows) || rows.length !== 3 || !rows.every((row) =>
    Array.isArray(row) && row.length === 3 && row.every((cell) => ["", "X", "O"].includes(cell))
  )) {
    return "board.rows must be a 3 by 3 board containing only X, O, or empty strings.";
  }
  if (!["X", "O"].includes(state.current_player) || !["X", "O"].includes(state.opponent) || state.current_player === state.opponent) {
    return "current_player and opponent must be different X/O marks.";
  }

  const criteriaCells = Object.keys(question.criteria);
  if (criteriaCells.length < 1 || criteriaCells.length > 9 || !criteriaCells.every((cell) => CELLS.has(cell))) {
    return "criteria must contain one to nine valid board cells.";
  }

  const boardByCell = Object.fromEntries(
    ["A", "B", "C"].flatMap((row, rowIndex) => [1, 2, 3].map((column, columnIndex) => [
      `${row}${column}`,
      rows[rowIndex][columnIndex],
    ])),
  );
  if (!criteriaCells.every((cell) => boardByCell[cell] === "")) {
    return "criteria may contain only empty board cells.";
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json({ error: { message: "Method not allowed." } }, 405, { Allow: "POST" });
  }

  // Same-origin UI requests are expected. This is defense-in-depth, not an
  // authentication layer; use Cloudflare Access/rate limiting for public use.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: { message: "Cross-origin requests are not allowed." } }, 403);
  }

  if (!env.TYPESAFE_API_KEY) {
    return json({ error: { message: "Server is missing TYPESAFE_API_KEY." } }, 500);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_REQUEST_BYTES) {
    return json({ error: { message: "Request body is too large." } }, 413);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: { message: "Request body must be valid JSON." } }, 400);
  }

  const validationError = validateTicTacToeRequest(body);
  if (validationError) {
    return json({ error: { message: validationError } }, 400);
  }

  try {
    const upstream = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: rawBody,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return json({ error: { message: `Could not contact TypeSafe: ${error.message}` } }, 502);
  }
}
