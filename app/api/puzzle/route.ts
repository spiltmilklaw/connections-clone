import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import type { Category } from "@/app/_types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NZ_TIME_ZONE = "Pacific/Auckland";
const DEFAULT_TAB = "Puzzles";

function todayInNzISO(): string {
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

function getServiceAccountCreds() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!b64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_BASE64");

  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return {
    clientEmail: json.client_email,
    privateKey: json.private_key.replace(/\\n/g, "\n"),
  };
}

export async function GET(req: NextRequest) {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const tabName = process.env.GOOGLE_SHEETS_TAB || DEFAULT_TAB;

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Missing sheet ID" }, { status: 500 });
    }

    const todayNz = todayInNzISO();
    const url = new URL(req.url);
    const requestedDate = url.searchParams.get("date") || todayNz;

    if (!isIsoDate(requestedDate) || requestedDate > todayNz) {
      return NextResponse.json({ error: "Invalid or future date" }, { status: 403 });
    }

    const { clientEmail, privateKey } = getServiceAccountCreds();

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:G`,
    });

    const rows = res.data.values || [];
    const header = rows[0].map((h) => h.toLowerCase());

    const idx = (n: string) => header.indexOf(n);

    const puzzles = new Map<string, Category[]>();

    for (const row of rows.slice(1)) {
      const date = row[idx("date")];
      if (!isIsoDate(date) || date > todayNz) continue;

      const category: Category = {
        category: row[idx("category")],
        level: Number(row[idx("level")]) as 1 | 2 | 3 | 4,
        items: [
          row[idx("word1")],
          row[idx("word2")],
          row[idx("word3")],
          row[idx("word4")],
        ],
      };

      puzzles.set(date, [...(puzzles.get(date) || []), category]);
    }

    return NextResponse.json({
      date: requestedDate,
      todayNz,
      availableDates: [...puzzles.keys()].sort().reverse(),
      categories: puzzles.get(requestedDate),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
