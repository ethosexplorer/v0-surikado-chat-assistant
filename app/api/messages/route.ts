import { NextResponse } from "next/server"
import { messages, parsedResume } from "../webhook/route"

export async function GET() {
  return NextResponse.json({
    messages,
    parsedResume,
  })
}