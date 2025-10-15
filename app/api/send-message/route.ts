import { type NextRequest, NextResponse } from "next/server"

// Store to track active soft skills queries and their progress
const activeSoftSkillsQueries = new Map<string, {
  startTime: number,
  userPhone: string,
  lastEmptyMessageTime: number,
  completed: boolean
}>()

// Store final responses
const queryResponses = new Map<string, {
  message: string,
  timestamp: number
}>()

// Detect soft skills messages
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

// Generate empty message content
const getEmptyMessage = (elapsedSeconds: number): string => {
  const messages = [
    "Processing your request...",
    "Analyzing your query...",
    "Generating response...",
    "Almost there...",
    "Finalizing answer...",
    "Compiling information...",
    "Preparing response...",
    "Working on it...",
    "Getting things ready...",
    "Just a moment..."
  ]
  
  const index = Math.floor(elapsedSeconds / 10) % messages.length
  return messages[index]
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""
    const action = data.action || "send" // 'send' or 'poll' or 'empty'

    if (!userMessage && action === "send") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

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

    // POLLING MODE: Check for empty messages or final response
    if (action === "poll") {
      const query = activeSoftSkillsQueries.get(userPhone)
      
      if (!query) {
        // Check if we have a final response
        const finalResponse = queryResponses.get(userPhone)
        if (finalResponse) {
          // Clean up after sending final response
          queryResponses.delete(userPhone)
          return NextResponse.json({
            status: 'completed',
            message: finalResponse.message,
            timestamp: finalResponse.timestamp
          })
        }
        return NextResponse.json({ 
          status: 'none',
          message: 'No active query found' 
        })
      }

      const elapsedSeconds = Math.floor((Date.now() - query.startTime) / 1000)
      
      // Check if it's time to send an empty message (every 10 seconds)
      const timeSinceLastEmpty = Date.now() - query.lastEmptyMessageTime
      if (timeSinceLastEmpty >= 10000 && !query.completed) {
        // Update last empty message time
        query.lastEmptyMessageTime = Date.now()
        activeSoftSkillsQueries.set(userPhone, query)
        
        return NextResponse.json({
          status: 'empty',
          message: getEmptyMessage(elapsedSeconds),
          elapsedSeconds,
          completed: false
        })
      }

      // Check if processing is complete (after ~74 seconds)
      if (elapsedSeconds >= 74 && !query.completed) {
        query.completed = true
        activeSoftSkillsQueries.set(userPhone, query)
        
        // Trigger the actual webhook call for final response
        setTimeout(() => {
          processFinalWebhook(userPhone, userMessage, requestId)
        }, 0)
        
        return NextResponse.json({
          status: 'processing',
          message: 'Finalizing response...',
          elapsedSeconds,
          completed: true
        })
      }

      return NextResponse.json({
        status: 'waiting',
        message: 'Still processing...',
        elapsedSeconds,
        completed: false
      })
    }

    // EMPTY MESSAGE MODE: Force an empty message (for testing)
    if (action === "empty") {
      const query = activeSoftSkillsQueries.get(userPhone)
      if (query) {
        const elapsedSeconds = Math.floor((Date.now() - query.startTime) / 1000)
        query.lastEmptyMessageTime = Date.now()
        activeSoftSkillsQueries.set(userPhone, query)
        
        return NextResponse.json({
          status: 'empty',
          message: getEmptyMessage(elapsedSeconds),
          elapsedSeconds,
          completed: false
        })
      }
      return NextResponse.json({ status: 'none', message: 'No active query' })
    }

    // SEND MODE: Start a new query
    console.log("[v0] Processing message:", userMessage, "from", userPhone)

    const isSoftSkills = isSoftSkillsMessage(userMessage)

    if (isSoftSkills) {
      // Start tracking this soft skills query
      activeSoftSkillsQueries.set(userPhone, {
        startTime: Date.now(),
        userPhone,
        lastEmptyMessageTime: Date.now(), // Send first empty message immediately
        completed: false
      })

      // Return immediately to start polling
      return NextResponse.json({
        ok: true,
        status: 'pending',
        message: 'Soft skills query received. Starting processing...',
        requestId,
        pending: true,
        isSoftSkills: true
      })
    } else {
      // For non-soft skills, process immediately with webhook
      return await processImmediateWebhook(userMessage, userPhone, requestId)
    }

  } catch (error) {
    console.error("[v0] Server error:", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json(
      { error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}

// Process immediate webhook for non-soft skills messages
async function processImmediateWebhook(userMessage: string, userPhone: string, requestId: string) {
  const timeoutMs = 25_000

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
  let lastDetail = "Unknown error"

  for (const url of endpoints) {
    for (let attempt = 1; attempt <= maxAttemptsPerEndpoint; attempt++) {
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
            (body && typeof body === "object" && "output" in body && (body as any).output) ||
            (body && typeof body === "object" && "message" in body && (body as any).message) ||
            (typeof body === "string" ? body : JSON.stringify(body))
          return NextResponse.json({ ok: true, message })
        } else {
          lastDetail = `Status ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
          console.log(`[v0] Webhook ${url} attempt ${attempt}/${maxAttemptsPerEndpoint} failed: ${lastDetail}`)
        }
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err)
        console.log(`[v0] Webhook ${url} attempt ${attempt}/${maxAttemptsPerEndpoint} network error:`, lastDetail)
      }

      if (attempt < maxAttemptsPerEndpoint) {
        const backoff = 300
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }

  return NextResponse.json({
    ok: false,
    message: `Unable to reach upstream webhook after ${maxAttemptsPerEndpoint * endpoints.length} attempts. Last detail: ${lastDetail}`,
  })
}

// Process final webhook for soft skills (after empty messages)
async function processFinalWebhook(userPhone: string, userMessage: string, requestId: string) {
  const timeoutMs = 25_000

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
  let lastDetail = "Unknown error"

  for (const url of endpoints) {
    for (let attempt = 1; attempt <= maxAttemptsPerEndpoint; attempt++) {
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
            (body && typeof body === "object" && "output" in body && (body as any).output) ||
            (body && typeof body === "object" && "message" in body && (body as any).message) ||
            (typeof body === "string" ? body : JSON.stringify(body))
          
          // Store the final response
          queryResponses.set(userPhone, {
            message: message || "Response received",
            timestamp: Date.now()
          })
          
          // Clean up the active query
          activeSoftSkillsQueries.delete(userPhone)
          return
        } else {
          lastDetail = `Status ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
          console.log(`[v0] Final webhook ${url} attempt ${attempt}/${maxAttemptsPerEndpoint} failed: ${lastDetail}`)
        }
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err)
        console.log(`[v0] Final webhook ${url} attempt ${attempt}/${maxAttemptsPerEndpoint} network error:`, lastDetail)
      }

      if (attempt < maxAttemptsPerEndpoint) {
        const backoff = 300
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }

  // If webhook fails, provide a fallback response
  const fallbackResponse = `I excel at several key soft skills:\n\n• Teamwork & Collaboration\n• Problem-Solving\n• Communication\n• Adaptability\n• Time Management\n\nThese skills help me work effectively in any environment.`

  queryResponses.set(userPhone, {
    message: fallbackResponse,
    timestamp: Date.now()
  })
  
  // Clean up the active query
  activeSoftSkillsQueries.delete(userPhone)
}
