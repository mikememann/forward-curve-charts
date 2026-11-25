export type Ast =
  | { op: "id"; name: string }
  | { op: "+" | "-" | "*" | "/"; left: Ast; right: Ast };

const OPS = new Set(["+", "-", "*", "/"]);

/**
 * Arithmetic of market ids. Operators must be separate tokens:
 * `brent - wti`, not `brent-wti` (ids themselves may contain hyphens).
 */
export function parseFormula(input: string): Ast {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("Formula is empty");
  let i = 0;
  const parseExpr = (): Ast => {
    let left = parseTerm();
    while (i < tokens.length && (tokens[i] === "+" || tokens[i] === "-")) {
      const op = tokens[i++] as "+" | "-";
      left = { op, left, right: parseTerm() };
    }
    return left;
  };
  const parseTerm = (): Ast => {
    let left = parseFactor();
    while (i < tokens.length && (tokens[i] === "*" || tokens[i] === "/")) {
      const op = tokens[i++] as "*" | "/";
      left = { op, left, right: parseFactor() };
    }
    return left;
  };
  const parseFactor = (): Ast => {
    const tok = tokens[i++];
    if (!tok) throw new Error("Formula ended early");
    if (tok === "(") {
      const inner = parseExpr();
      if (tokens[i++] !== ")") throw new Error("Missing closing parenthesis");
      return inner;
    }
    if (OPS.has(tok)) throw new Error(`Operator '${tok}' is not between two series. Write 'brent - wti'.`);
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(tok)) throw new Error(`'${tok}' is not a series id`);
    return { op: "id", name: tok };
  };
  const ast = parseExpr();
  if (i !== tokens.length) throw new Error(`Couldn't read '${tokens[i]}'`);
  return ast;
}

export function formulaIds(ast: Ast): string[] {
  if (ast.op === "id") return [ast.name];
  return [...formulaIds(ast.left), ...formulaIds(ast.right)];
}

export function evalFormula(ast: Ast, values: Record<string, number>): number | null {
  if (ast.op === "id") {
    const v = values[ast.name];
    return Number.isFinite(v) ? v : null;
  }
  const l = evalFormula(ast.left, values);
  const r = evalFormula(ast.right, values);
  if (l == null || r == null) return null;
  if (ast.op === "+") return l + r;
  if (ast.op === "-") return l - r;
  if (ast.op === "*") return l * r;
  if (r === 0) return null;
  return l / r;
}
