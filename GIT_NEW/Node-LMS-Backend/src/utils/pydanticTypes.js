import { z } from 'zod';

/**
 * Zod equivalents of Pydantic's default ("lax") scalar types.
 *
 * FastAPI/Pydantic coerces on the way in: a JSON body of {"app_build": "48"} or a
 * query string of ?build=48 both arrive as the int 48, and Optional[str] accepts
 * ANY string. Zod is strict by default, so a direct 1:1 port of a Pydantic model
 * rejects payloads the live FastAPI backend happily accepts — the client then
 * gets a 422 instead of a 200. That is invisible to the web app (it sends
 * well-typed JSON built from TypeScript) but breaks the mobile app, which sends
 * several of these fields as strings.
 *
 * These helpers restore Pydantic's behaviour. null/undefined are passed straight
 * through so `.optional()` / `.nullable()` short-circuit exactly as before.
 */
const toNumber = (v) => {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return v; // empty string stays invalid, as in Pydantic
    const n = Number(t);
    return Number.isNaN(n) ? v : n; // non-numeric falls through to the type error
  }
  return v;
};

/** Pydantic `float` — accepts a number or a numeric string. */
export const pyFloat = () => z.preprocess(toNumber, z.number());

/** Pydantic `int` — accepts an int, an int-valued float, or a numeric string. */
export const pyInt = () => z.preprocess(toNumber, z.number().int());

// Pydantic's lax bool accepts these spellings (case-insensitive) plus 0/1.
const TRUTHY = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSY = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

const toBoolean = (v) => {
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (TRUTHY.has(t)) return true;
    if (FALSY.has(t)) return false;
    return v;
  }
  if (v === 0 || v === 1) return Boolean(v);
  return v;
};

/** Pydantic `bool` — accepts a bool, 0/1, or "true"/"false"/"yes"/"no"/… */
export const pyBool = () => z.preprocess(toBoolean, z.boolean());
