const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_REQUEST_BYTES = 50_000;
const TTT_CELLS = new Set(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
const GOMOKU_CELL = /^[A-P](1[0-6]|[1-9])$/;
const GOMOKU_REGION = /^r[1-4]c[1-4]$/;

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
 * This is deliberately not a generic TypeSafe proxy. It accepts only the
 * request shapes produced by the 3×3 and 16×16 game UIs.
 */
function validateBase(body) {
  if (!isObject(body) || body.model !== "jev-latest") return "Only model jev-latest is allowed.";
  const state = body.state;
  if (!isObject(state) || !["X", "O"].includes(state.current_player) || !["X", "O"].includes(state.opponent) || state.current_player === state.opponent) {
    return "current_player and opponent must be different X/O marks.";
  }
  return null;
}

function validateChoice(question) {
  return isObject(question) && question.type === "choice" && isObject(question.criteria);
}

function validateTicTacToeRequest(body) {
  const baseError = validateBase(body);
  if (baseError) return baseError;
  const rows = body.state.board?.rows;
  const question = body.questions?.next_move;
  if (!Array.isArray(rows) || rows.length !== 3 || !rows.every((row) => Array.isArray(row) && row.length === 3 && row.every((cell) => ["", "X", "O"].includes(cell)))) {
    return "Tic-tac-toe board.rows must be a 3 by 3 board containing only X, O, or empty strings.";
  }
  if (!validateChoice(question)) return "next_move must be a choice with criteria.";
  const cells = Object.keys(question.criteria);
  if (cells.length < 1 || cells.length > 9 || !cells.every((cell) => TTT_CELLS.has(cell))) return "criteria must contain one to nine valid board cells.";
  const boardByCell = Object.fromEntries(["A", "B", "C"].flatMap((row, rowIndex) => [1, 2, 3].map((column, columnIndex) => [`${row}${column}`, rows[rowIndex][columnIndex]])));
  return cells.every((cell) => boardByCell[cell] === "") ? null : "criteria may contain only empty board cells.";
}

function validateGomokuRequest(body) {
  const baseError = validateBase(body);
  if (baseError) return baseError;
  const rows = body.state.board?.rows;
  if (!Array.isArray(rows) || rows.length !== 16 || !rows.every((row) => Array.isArray(row) && row.length === 16 && row.every((cell) => ["", "X", "O"].includes(cell)))) {
    return "Gomoku board.rows must be a 16 by 16 board containing only X, O, or empty strings.";
  }

  const questions = body.questions;
  if (!isObject(questions)) return "A Gomoku choice question is required.";
  if (isObject(questions.next_region)) {
    const question = questions.next_region;
    const regions = Object.keys(question.criteria || {});
    if (!validateChoice(question) || regions.length < 1 || regions.length > 16 || !regions.every((region) => GOMOKU_REGION.test(region))) return "next_region must contain valid non-empty 4 by 4 regions.";
    return null;
  }
  if (isObject(questions.next_move)) {
    const question = questions.next_move;
    const cells = Object.keys(question.criteria || {});
    if (!validateChoice(question) || cells.length < 1 || cells.length > 16 || !cells.every((cell) => GOMOKU_CELL.test(cell))) return "next_move must contain one to sixteen valid Gomoku cells.";
    const boardByCell = Object.fromEntries(rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => [`${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`, value])));
    return cells.every((cell) => boardByCell[cell] === "") ? null : "Gomoku criteria may contain only empty board cells.";
  }
  return "Gomoku requires next_region or next_move.";
}

function validateGameRequest(body) {
  const size = body?.state?.board?.rows?.length;
  if (size === 3) return validateTicTacToeRequest(body);
  if (size === 16) return validateGomokuRequest(body);
  return "Only the 3 by 3 and 16 by 16 game request formats are allowed.";
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

  const validationError = validateGameRequest(body);
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
