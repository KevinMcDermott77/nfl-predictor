import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync";

export async function POST(request: Request) {
  // Bearer token auth
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  const secret = process.env.SYNC_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSync();
  return NextResponse.json(result);
}
