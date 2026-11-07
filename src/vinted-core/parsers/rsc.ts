/**
 * Vinted's pages are Next.js apps: their data arrives as JSON string literals
 * inside self.__next_f.push([1,"..."]) calls. Decoding those literals gives
 * the React Server Component payload as plain text with ordinary JSON in it.
 */
export function readFlightData(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      parts.push(JSON.parse(match[1]));
    } catch {
      // A chunk that is not a valid JSON string literal carries nothing we read.
    }
  }
  return parts.join("");
}

/** Parses the JSON array or object that starts at `start`, or returns undefined. */
export function readJsonValueAt(text: string, start: number): any {
  const open = text[start];
  if (open !== "[" && open !== "{") {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "[" || ch === "{") {
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

/**
 * Finds the first value written as `key` (e.g. `"photos":`) that `accept`
 * agrees with. The payload repeats keys for unrelated widgets, so callers
 * pass a predicate that recognises the one they want.
 */
export function findJsonAfter(text: string, key: string, accept: (value: any, index: number) => boolean = () => true): any {
  let from = 0;
  while (true) {
    const index = text.indexOf(key, from);
    if (index < 0) {
      return undefined;
    }

    const value = readJsonValueAt(text, index + key.length);
    if (value !== undefined && accept(value, index)) {
      return value;
    }
    from = index + key.length;
  }
}
