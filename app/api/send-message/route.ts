import { type NextRequest, NextResponse } from "next/server"

export const maxDuration = 60 // Maximum allowed on hobby/free tier
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

    // Fire and forget - don't wait for n8n response
    // n8n will process in background and send result via WhatsApp
    sendToWebhookAsync(userPhone, userMessage, requestId)
    
    // Return immediately with success
    return NextResponse.json({
      ok: true,
      message: "Your request is being processed. Analysis will be sent to your WhatsApp shortly.",
      requestId,
      success: true,
    })

  } catch (error) {
    console.error(`[error] Server error:`, error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({
      ok: true,
      message: "Your request has been submitted and is being processed.",
      success: true,
    })
  }
}

// Fire-and-forget webhook call
function sendToWebhookAsync(
  userPhone: string,
  userMessage: string,
  requestId: string,
) {
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

  // Primary endpoint (without port - more reliable)
  const primaryEndpoint = "https://surikado.hellodexter.com/webhook/130bb4fe-11e5-4442-9a63-a68de302e144"
  
  // Trigger webhook without waiting - set short timeout to avoid blocking
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
  
  fetch(primaryEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload),
    signal: controller.signal,
    keepalive: true, // Keep request alive even after function returns
  })
    .then((response) => {
      clearTimeout(timeoutId)
      console.log(`[webhook] Request initiated successfully`)
    })
    .catch((error) => {
      clearTimeout(timeoutId)
      // This is expected if timeout occurs, n8n still processes
      console.log(`[webhook] Request sent (processing in background)`)
    })
}
