import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""

    if (!userMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    const timeoutMs = 60_000

    const normalizeWhatsApp = (raw: unknown) => {
      if (!raw) return ""
      let n = String(raw).trim()
      if (n.toLowerCase().startsWith("whatsapp:")) n = n.slice(9)
      n = n.replace(/[^+\d]/g, "")
      if (!n.startsWith("+")) n = `+${n}`
      return `whatsapp:${n}`
    }
    const userPhone = normalizeWhatsApp(data.toPhone)
    if (!userPhone) {
      return NextResponse.json({ error: "toPhone (WhatsApp number) is required" }, { status: 400 })
    }

    console.log("[v0] Processing message:", userMessage, "from", userPhone)

    const webhookPayload = {
      specversion: "1.0",
      type: "com.twilio.messaging.inbound-message.received",
      source: "/some-path",
      id: `msg-${data.timestamp || Date.now()}`,
      dataschema: "https://events-schemas.twilio.com/Messaging.InboundMessageV1/5",
      datacontenttype: "application/json",
      time: data.time || new Date().toISOString(),
      data: {
        numMedia: 0,
        timestamp: data.time || new Date().toISOString(),
        recipients: [],
        accountSid: "ACxxxx",
        messagingServiceSid: "MGxxxx",
        to: "whatsapp:+16098034599",
        numSegments: 1,
        messageSid: `SM${data.timestamp || Date.now()}`,
        eventName: "com.twilio.messaging.inbound-message.received",
        body: userMessage,
        from: userPhone,
      },
    }

    const endpoints = [
      "https://surikado.hellodexter.com:5678/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
      "https://surikado.hellodexter.com/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
    ]

    const maxAttempts = 3
    let lastDetail = "Unknown error"

    for (const url of endpoints) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(timeoutMs),
          })

          const contentType = response.headers.get("content-type") || ""
          const getBody = async () => {
            if (contentType.includes("application/json")) {
              try {
                return await response.json()
              } catch {
                return { raw: await response.text() }
              }
            }
            return { raw: await response.text() }
          }

          const body = await getBody()

          if (response.ok) {
            const message =
              (body && typeof body === "object" && "output" in body && body.output) ||
              (body && typeof body === "object" && "message" in body && body.message) ||
              (typeof body === "string" ? body : JSON.stringify(body))
            return NextResponse.json({ ok: true, message })
          } else {
            lastDetail = `Status ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
            console.log(`[v0] Webhook ${url} attempt ${attempt}/${maxAttempts} failed: ${lastDetail}`)
          }
        } catch (err) {
          lastDetail = err instanceof Error ? err.message : String(err)
          console.log(`[v0] Webhook ${url} attempt ${attempt}/${maxAttempts} network error:`, lastDetail)
        }

        if (attempt < maxAttempts) {
          const backoff = 500 * 2 ** (attempt - 1)
          await new Promise((r) => setTimeout(r, backoff))
        }
      }
    }

    // If we reach here, all attempts to all endpoints failed. Return a friendly message with 200.
    return NextResponse.json({
      ok: false,
      message: `Upstream webhook unreachable: ${lastDetail}. Please try again later.`,
    })
  } catch (error) {
    console.error("[v0] Server error:", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json(
      { error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}
