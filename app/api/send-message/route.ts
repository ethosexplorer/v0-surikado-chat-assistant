import { type NextRequest, NextResponse } from "next/server"

// In-memory store for pending responses
const pendingResponses = new Map<string, { 
  status: 'pending' | 'completed' | 'error', 
  message?: string, 
  timestamp: number,
  isSoftSkills?: boolean // Track if this is a soft skills request
}>()

// Detect if message is about soft skills
const isSoftSkillsMessage = (message: string): boolean => {
  const softSkillsPatterns = [
    /soft\s*skills?/i,
    /your\s+soft\s+skills?/i,
    /list.*soft\s*skills?/i,
    /what\s+soft\s+skills\s+do\s+you\s+excel\s+at/i,
    /teamwork.*problem.solving|problem.solving.*teamwork/i,
    /communication.*skills?/i,
    /leadership.*skills?/i,
    /collaboration.*skills?/i
  ]
  
  return softSkillsPatterns.some(pattern => pattern.test(message))
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""
    const action = data.action || "send"

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

    const requestId = `${userPhone}-${Date.now()}`

    // POLLING MODE: Check if response is ready
    if (action === "poll") {
      const lastPendingKey = Array.from(pendingResponses.keys())
        .filter(key => key.startsWith(userPhone))
        .sort()
        .pop()
      
      if (!lastPendingKey) {
        return NextResponse.json({ 
          status: 'none',
          message: 'No pending request found' 
        })
      }

      const result = pendingResponses.get(lastPendingKey)
      if (!result) {
        return NextResponse.json({ 
          status: 'none',
          message: 'No pending request found' 
        })
      }

      // EXTENDED TIMEOUT FOR SOFT SKILLS - 3 minutes instead of 5
      const timeoutMs = result.isSoftSkills ? 3 * 60 * 1000 : 5 * 60 * 1000
      const timeoutTime = Date.now() - timeoutMs
      
      if (result.timestamp < timeoutTime) {
        pendingResponses.delete(lastPendingKey)
        return NextResponse.json({ 
          status: 'expired',
          message: 'Request expired' 
        })
      }

      return NextResponse.json({
        status: result.status,
        message: result.message,
        pending: result.status === 'pending',
        isSoftSkills: result.isSoftSkills // Send this info to frontend
      })
    }

    // SEND MODE: Fire webhook and return immediately
    if (!userMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    console.log("[send-message] Processing message:", userMessage, "from", userPhone)

    const isSoftSkills = isSoftSkillsMessage(userMessage)
    
    // Store pending status with soft skills flag
    pendingResponses.set(requestId, { 
      status: 'pending', 
      timestamp: Date.now(),
      isSoftSkills
    })

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

    // Fire and forget - don't wait for response
    const processWebhook = async () => {
      for (const url of endpoints) {
        try {
          // EXTENDED TIMEOUT FOR SOFT SKILLS REQUESTS
          const timeoutMs = isSoftSkills ? 180_000 : 120_000 // 3 min vs 2 min
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
            signal: controller.signal,
          })

          clearTimeout(timeoutId)

          const contentType = response.headers.get("content-type") || ""
          let body: any

          if (contentType.includes("application/json")) {
            try {
              body = await response.json()
            } catch {
              body = { raw: await response.text() }
            }
          } else {
            body = { raw: await response.text() }
          }

          if (response.ok) {
            const message =
              (body && typeof body === "object" && "output" in body && body.output) ||
              (body && typeof body === "object" && "message" in body && body.message) ||
              (typeof body === "string" ? body : JSON.stringify(body))
            
            pendingResponses.set(requestId, {
              status: 'completed',
              message,
              timestamp: Date.now(),
              isSoftSkills
            })
            console.log(`[send-message] Success from ${url}, softSkills: ${isSoftSkills}`)
            return
          } else {
            console.log(`[send-message] ${url} failed with status ${response.status}`)
          }
        } catch (err) {
          console.log(`[send-message] ${url} error:`, err instanceof Error ? err.message : String(err))
        }
      }

      // All endpoints failed
      pendingResponses.set(requestId, {
        status: 'error',
        message: 'All webhook endpoints failed',
        timestamp: Date.now(),
        isSoftSkills
      })
    }

    // Start processing in background (don't await)
    processWebhook().catch(err => {
      console.error("[send-message] Background processing error:", err)
      pendingResponses.set(requestId, {
        status: 'error',
        message: 'Processing error occurred',
        timestamp: Date.now(),
        isSoftSkills
      })
    })

    // Return immediately with pending status and soft skills info
    return NextResponse.json({
      ok: true,
      status: 'pending',
      message: 'Message sent to processing queue. Poll for response.',
      requestId,
      pending: true,
      isSoftSkills // Let frontend know this might take longer
    })

  } catch (error) {
    console.error("[send-message] Server error:", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json(
      { error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    )
  }
}
