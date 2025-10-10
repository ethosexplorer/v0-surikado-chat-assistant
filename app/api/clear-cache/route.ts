import { NextResponse } from "next/server"

export async function POST() {
  try {
    // Clear the in-memory storage
    const { messages, parsedResume } = await import("../webhook/route")
    messages.length = 0

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Clear cache error:", error)
    return NextResponse.json({ error: "Failed to clear cache" }, { status: 500 })
  }
}
