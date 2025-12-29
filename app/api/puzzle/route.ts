import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import type { Category } from "@/app/_types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NZ_TIME_ZONE = "Pacific/Auckland";
const DEFAULT_TAB = "Puzzles";

type PuzzleApiResponse = {
  date: string;
  todayNz: string;
  availableDates: string[];
  categories: Category[];
};

function todayInNzISO(): string {
  // en-CA reliably formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function getServiceAccountCreds(): { clientEmail: string; privateKey: string } {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!b64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_BASE64");

  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const clientEmail = json.client_email as string | undefined;
  let privateKey = json.private_key as string | undefined;

  if (!clientEmail || !privateKey) {
    throw new Error("Service account JSON missing client_email/private_key");
  }

  // If env var ever contains literal \n sequences, normalize them.
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { clientEmail, privateKey };
}

function normalizeWord(w: unknown): string {
  return String(w ?? "").trim().toUpperCase();
}

export async function GET(req: NextRequest) {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const tabName = process.env.GOOGLE_SHEETS_TAB || DEFAULT_TAB;

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Missing GOOGLE_SHEETS_ID" },
        { status: 500 }
      );
    }

    const todayNz = todayInNzISO();

    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date")?.trim() || null;

    const requestedDate = dateParam ?? todayNz;

    if (!isIsoDate(requestedDate)) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // Critical gate: never allow future dates (relative to NZ time)
    if (requestedDate > todayNz) {
      return NextResponse.json(
        { error: "That puzzle date is not available yet." },
        { status: 403 }
      );
    }

    const { clientEmail, privateKey } = getServiceAccountCreds();

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Expect columns A-G: date, level, category, word1..word4
    const range = `${tabName}!A1:G`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = res.data.values ?? [];
    if (values.length < 2) {
      return NextResponse.json(
        { error: "Sheet appears empty (need header + rows)." },
        { status: 500 }
      );
    }

    const header = values[0].map((h) => String(h).trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);

    const iDate = idx("date");
    const iLevel = idx("level");
    const iCategory = idx("category");
    const iW1 = idx("word1");
    const iW2 = idx("word2");
    const iW3 = idx("word3");
    const iW4 = idx("word4");

    const missingCols = [
  ["date", iDate],
  ["level", iLevel],
  ["category", iCategory],
  ["word1", iW1],
  ["word2", iW2],
  ["word3", iW3],
  ["word4", iW4],
].filter(([, index]) => typeof index !== "number" || index < 0);

    if (missingCols.length) {
      return NextResponse.json(
        {
          error: `Missing required columns in header row: ${missingCols
            .map(([n]) => n)
            .join(", ")}`,
        },
        { status: 500 }
      );
    }

    // Build puzzles map ONLY for dates <= todayNz (prevents leaking future rows)
    const puzzlesByDate = new Map<string, Category[]>();

    for (const row of values.slice(1)) {
      const date = String(row[iDate] ?? "").trim();
      if (!isIsoDate(date)) continue;

      // Gate out future dates at the data layer too
      if (date > todayNz) continue;

      const levelNum = Number(String(row[iLevel] ?? "").trim());
      if (![1, 2, 3, 4].includes(levelNum)) continue;

      const categoryName = String(row[iCategory] ?? "").trim();
      if (!categoryName) continue;

      const items = [
        normalizeWord(row[iW1]),
        normalizeWord(row[iW2]),
        normalizeWord(row[iW3]),
        normalizeWord(row[iW4]),
      ].filter(Boolean);

      if (items.length !== 4) continue;

      const cat: Category = {
        category: categoryName,
        items,
        level: levelNum as 1 | 2 | 3 | 4,
      };

      const existing = puzzlesByDate.get(date) ?? [];
      puzzlesByDate.set(date, [...existing, cat]);
    }

    const availableDates = Array.from(puzzlesByDate.keys()).sort((a, b) =>
      b.localeCompare(a)
    );

    // If no explicit date was requested, default to todayNZ, but fall back to latest available
    let dateToUse = requestedDate;
    if (!dateParam && !puzzlesByDate.has(dateToUse) && availableDates.length) {
      dateToUse = availableDates[0];
    }

    const categories = (puzzlesByDate.get(dateToUse) ?? []).sort(
      (a, b) => a.level - b.level
    );

    if (categories.length !== 4) {
      return NextResponse.json(
        {
          error: `Puzzle for ${dateToUse} is missing or incomplete (need 4 rows: levels 1–4).`,
          todayNz,
          availableDates,
        },
        { status: 404 }
      );
    }

    // Validate unique levels
    const levelSet = new Set(categories.map((c) => c.level));
    if (levelSet.size !== 4) {
      return NextResponse.json(
        {
          error: `Puzzle for ${dateToUse} must contain exactly one row per level (1–4).`,
          todayNz,
          availableDates,
        },
        { status: 500 }
      );
    }

    // Validate 16 unique words
    const allWords = categories.flatMap((c) => c.items);
    const wordSet = new Set(allWords);
    if (wordSet.size !== 16) {
      return NextResponse.json(
        {
          error: `Puzzle for ${dateToUse} must contain 16 unique words (no duplicates).`,
          todayNz,
          availableDates,
        },
        { status: 500 }
      );
    }

    const body: PuzzleApiResponse = {
      date: dateToUse,
      todayNz,
      availableDates,
      categories,
    };

    // Optional: add light CDN caching to reduce Sheets API usage
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

