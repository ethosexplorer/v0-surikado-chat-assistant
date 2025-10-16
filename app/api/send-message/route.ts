import { type NextRequest, NextResponse } from "next/server"

export const maxDuration = 300 // 5 minutes (Pro plan)
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""

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

    if (!userMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    const requestId = `${userPhone}-${Date.now()}`
    console.log(`[${new Date().toISOString()}] Processing message for: ${userPhone}`)

    // Call webhook immediately - NO WAITING TIME
    const result = await sendToWebhook(userPhone, userMessage, requestId, 90000)
    
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      requestId,
      success: result.ok,
    })

  } catch (error) {
    console.error(`[error] Server error:`, error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json(
      { error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}

// Send to webhook
async function sendToWebhook(
  userPhone: string,
  userMessage: string,
  requestId: string,
  timeoutMs = 90000,
): Promise<{ ok: boolean; message: string }> {
  const webhookPayload = {
    specversion: "1.0",
    type: "com.twilio.messaging.inbound-message.received",
    source: "/some-path",
    id: requestId,
    dataschema: "https://events-schemas.twilio.com/Messaging.InboundMessageV1/5",
    datacontenttype: "application/json",
    time: new Date().toISOString(),
    data: {
      numMedia: 0,
      timestamp: new Date().toISOString(),
      recipients: [],
      accountSid: "ACxxxx",
      messagingServiceSid: "MGxxxx",
      to: "whatsapp:+16098034599",
      numSegments: 1,
      messageSid: requestId,
      eventName: "com.twilio.messaging.inbound-message.received",
      body: userMessage,
      from: userPhone,
    },
  }

  const endpoints = [
    "https://surikado.hellodexter.com:5678/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
    "https://surikado.hellodexter.com/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
  ]

  const maxAttemptsPerEndpoint = 2
  let lastDetail = "Unable to reach the service"

  for (const url of endpoints) {
    for (let attempt = 1; attempt <= maxAttemptsPerEndpoint; attempt++) {
      try {
        const callStart = Date.now()
        console.log(`[webhook] Calling ${url} (attempt ${attempt}/${maxAttemptsPerEndpoint})`)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          console.log(`[webhook] Timeout triggered after ${timeoutMs}ms`)
          controller.abort()
        }, timeoutMs)

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        const duration = Date.now() - callStart

        const contentType = response.headers.get("content-type") || ""
        
        let body: any
        if (contentType.includes("application/json")) {
          try {
            body = await response.json()
            console.log(`[webhook] JSON response received in ${duration}ms`)
          } catch (e) {
            const rawText = await response.text()
            body = { raw: rawText }
            console.log(`[webhook] Text response received in ${duration}ms`)
          }
        } else {
          const rawText = await response.text()
          body = { raw: rawText }
          console.log(`[webhook] Non-JSON response received in ${duration}ms`)
        }

        if (response.ok) {
          let message = "Request processed successfully."
          
          if (body && typeof body === "object") {
            message = 
              body.output ||
              body.message ||
              body.response ||
              body.result ||
              (body.data && (body.data.output || body.data.message)) ||
              JSON.stringify(body)
          } else if (typeof body === "string") {
            message = body
          }

          if (message.length > 2000) {
            message = message.substring(0, 2000) + "..."
          }

          console.log(`[webhook] SUCCESS in ${duration}ms`)
          console.log(`[webhook] Final message: ${message.substring(0, 100)}...`)
          return { ok: true, message }
        } else {
          lastDetail = `Status ${response.status}`
          console.log(`[webhook] FAILED in ${duration}ms: ${lastDetail}`, body)
        }
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))
        lastDetail = isTimeout ? "Request timeout" : err instanceof Error ? err.message : String(err)
        console.log(`[webhook] ERROR: ${lastDetail}`)
        
        if (isTimeout) {
          break
        }
      }

      if (attempt < maxAttemptsPerEndpoint) {
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  return {
    ok: false,
    message: "I'm having trouble processing your request right now. Please try again in a moment.",
  }
}
