import { type NextRequest, NextResponse } from "next/server"

// Increase timeout to maximum for your Vercel plan
export const maxDuration = 300 // 5 minutes (Pro plan)
export const dynamic = "force-dynamic"

// Store to track active conversations
const activeConversations = new Map<
  string,
  {
    startTime: number
    lastEmptyMessageTime: number
    completed: boolean
    userMessage: string
    webhookCalled: boolean
    emptyMessageCount: number
    webhookStartTime?: number
    processingStarted: boolean
  }
>()

// Store final responses
const conversationResponses = new Map<
  string,
  {
    message: string
    timestamp: number
    success: boolean
  }
>()

// TIMING CONFIGURATION
const EMPTY_MESSAGE_INTERVAL = 8000 // Send empty message every 8 seconds
const API_CALL_TIME = 88 // Call n8n API after 88 seconds
const MAX_TOTAL_TIME = 180 // Absolute max 3 minutes before forcing error

// Cleanup old data every minute
const CLEANUP_INTERVAL = 60000
const MAX_CONVERSATION_AGE = 600000 // 10 minutes

setInterval(() => {
  const now = Date.now()

  for (const [phone, conv] of activeConversations.entries()) {
    if (now - conv.startTime > MAX_CONVERSATION_AGE) {
      activeConversations.delete(phone)
      conversationResponses.delete(phone)
      console.log(`[cleanup] Removed stale conversation: ${phone}`)
    }
  }

  for (const [phone, response] of conversationResponses.entries()) {
    if (now - response.timestamp > MAX_CONVERSATION_AGE) {
      conversationResponses.delete(phone)
      console.log(`[cleanup] Removed stale response: ${phone}`)
    }
  }
}, CLEANUP_INTERVAL)

// Generate empty message content
const getEmptyMessage = (count: number): string => {
  const messages = [
    "🔄 Analyzing your soft skills...",
    "💭 Understanding your strengths...",
    "📊 Processing your profile...",
    "⚡ Matching with opportunities...",
    "✨ Almost ready...",
    "🎯 Preparing your response...",
    "📝 Finalizing details...",
    "🌟 Just a moment more...",
    "💡 Compiling information...",
    "🚀 Getting everything ready...",
  ]

  const index = count % messages.length
  return messages[index]
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""
    const action = data.action || "send"
    const isSoftSkillsQuestion = data.isSoftSkillsQuestion || false

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

    console.log(`[${new Date().toISOString()}] Action: ${action}, Phone: ${userPhone}`)

    // POLLING MODE: Check for empty messages or final response
    if (action === "poll") {
      const conversation = activeConversations.get(userPhone)

      if (!conversation) {
        // Check if we have a final response stored
        const finalResponse = conversationResponses.get(userPhone)
        if (finalResponse) {
          console.log(`[poll] Found stored final response`)
          conversationResponses.delete(userPhone)
          return NextResponse.json({
            status: "completed",
            message: finalResponse.message,
            timestamp: finalResponse.timestamp,
            success: finalResponse.success,
          })
        }
        return NextResponse.json({
          status: "none",
          message: "No active conversation found",
        })
      }

      const elapsedSeconds = Math.floor((Date.now() - conversation.startTime) / 1000)
      console.log(
        `[poll] Elapsed: ${elapsedSeconds}s, WebhookCalled: ${conversation.webhookCalled}, Completed: ${conversation.completed}`,
      )

      // ABSOLUTE TIMEOUT - Force error if taking too long
      if (elapsedSeconds >= MAX_TOTAL_TIME) {
        console.error(`[poll] HARD TIMEOUT after ${elapsedSeconds}s`)
        activeConversations.delete(userPhone)
        conversationResponses.delete(userPhone)
        return NextResponse.json({
          status: "completed",
          message: "I apologize for the delay. Please try sending your soft skills again.",
          elapsedSeconds,
          completed: true,
          success: false,
        })
      }

      // If already completed, return the final response
      if (conversation.completed) {
        const finalResponse = conversationResponses.get(userPhone)
        if (finalResponse) {
          console.log(`[poll] Returning completed response (took ${elapsedSeconds}s total)`)
          activeConversations.delete(userPhone)
          conversationResponses.delete(userPhone)
          return NextResponse.json({
            status: "completed",
            message: finalResponse.message,
            elapsedSeconds,
            completed: true,
            success: finalResponse.success,
          })
        } else {
          // Completed but no response stored - this shouldn't happen
          console.error(`[poll] ERROR: Completed but no response found`)
          activeConversations.delete(userPhone)
          return NextResponse.json({
            status: "completed",
            message: "Response processing completed. Please continue.",
            elapsedSeconds,
            completed: true,
            success: false,
          })
        }
      }

      // Check if it's time to call the API (at 88 seconds)
      if (elapsedSeconds >= API_CALL_TIME && !conversation.webhookCalled) {
        console.log(`[poll] ⏰ Reached ${API_CALL_TIME}s - CALLING API NOW`)

        conversation.webhookCalled = true
        conversation.webhookStartTime = Date.now()
        conversation.processingStarted = true
        activeConversations.set(userPhone, conversation)

        // Call API in background (don't await - let it run)
        processWebhookInBackground(userPhone, conversation.userMessage, requestId)

        // Return processing status
        return NextResponse.json({
          status: "processing",
          message: "⚡ Processing your information...",
          elapsedSeconds,
          completed: false,
        })
      }

      // If webhook has been called, show processing status
      if (conversation.webhookCalled && !conversation.completed) {
        const webhookElapsed = conversation.webhookStartTime
          ? Math.floor((Date.now() - conversation.webhookStartTime) / 1000)
          : 0

        console.log(`[poll] API still processing... (${webhookElapsed}s since webhook call)`)

        return NextResponse.json({
          status: "processing",
          message: "⚡ Processing your information...",
          elapsedSeconds,
          webhookElapsed,
          completed: false,
        })
      }

      // Before API call time - send empty messages
      const timeSinceLastEmpty = Date.now() - conversation.lastEmptyMessageTime
      if (timeSinceLastEmpty >= EMPTY_MESSAGE_INTERVAL) {
        conversation.lastEmptyMessageTime = Date.now()
        conversation.emptyMessageCount++
        activeConversations.set(userPhone, conversation)

        console.log(`[poll] Empty message #${conversation.emptyMessageCount} at ${elapsedSeconds}s`)

        return NextResponse.json({
          status: "empty",
          message: getEmptyMessage(conversation.emptyMessageCount),
          elapsedSeconds,
          completed: false,
        })
      }

      // Still waiting for next empty message or API call time
      return NextResponse.json({
        status: "waiting",
        message: getEmptyMessage(conversation.emptyMessageCount),
        elapsedSeconds,
        completed: false,
      })
    }

    // SEND MODE: Process user message
    if (!userMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    console.log(`[send] Message:`, userMessage.substring(0, 50))

    // If this is a user response to a soft skills question
    if (isSoftSkillsQuestion) {
      console.log(`[send] Starting soft skills response flow`)

      // Clean up any existing conversation
      const existing = activeConversations.get(userPhone)
      if (existing) {
        console.log(`[send] Cleaning up existing conversation`)
        activeConversations.delete(userPhone)
        conversationResponses.delete(userPhone)
      }

      // Start tracking - API will be called at 88 seconds
      activeConversations.set(userPhone, {
        startTime: Date.now(),
        lastEmptyMessageTime: Date.now(),
        completed: false,
        userMessage: userMessage,
        webhookCalled: false,
        emptyMessageCount: 0,
        processingStarted: false,
      })

      console.log(`[send] Conversation started. API will be called at ${API_CALL_TIME}s`)

      return NextResponse.json({
        ok: true,
        status: "pending",
        message: "Response received. Processing...",
        requestId,
        pending: true,
        isSoftSkillsResponse: true,
      })
    } else {
      // For normal messages, call webhook immediately
      console.log(`[send] Normal message - calling webhook immediately`)
      const result = await sendToWebhook(userPhone, userMessage, requestId, 25000)
      return NextResponse.json(result)
    }
  } catch (error) {
    console.error(`[error] Server error:`, error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json(
      { error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}

// Background processing - called once at 88 seconds
async function processWebhookInBackground(userPhone: string, userMessage: string, requestId: string) {
  const startTime = Date.now()
  console.log(`[background] 🚀 Starting API call for ${userPhone}`)

  try {
    // Call with generous timeout (2 minutes for n8n processing)
    const result = await sendToWebhook(userPhone, userMessage, requestId, 120000)

    const duration = Math.floor((Date.now() - startTime) / 1000)

    if (result.ok) {
      console.log(`[background] ✅ API SUCCESS in ${duration}s`)

      conversationResponses.set(userPhone, {
        message: result.message || "Response received",
        timestamp: Date.now(),
        success: true,
      })
    } else {
      console.error(`[background] ❌ API FAILED in ${duration}s:`, result.message)

      conversationResponses.set(userPhone, {
        message: "I'm processing your information. Please wait a moment and try again.",
        timestamp: Date.now(),
        success: false,
      })
    }

    // Mark as completed
    const conversation = activeConversations.get(userPhone)
    if (conversation) {
      conversation.completed = true
      activeConversations.set(userPhone, conversation)
      console.log(
        `[background] Marked as completed (total time: ${Math.floor((Date.now() - conversation.startTime) / 1000)}s)`,
      )
    }
  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000)
    console.error(`[background] ⚠️ Exception after ${duration}s:`, error)

    conversationResponses.set(userPhone, {
      message: "I apologize, but I'm having trouble processing your response. Please try again.",
      timestamp: Date.now(),
      success: false,
    })

    const conversation = activeConversations.get(userPhone)
    if (conversation) {
      conversation.completed = true
      activeConversations.set(userPhone, conversation)
    }
  }
}

// Send to webhook
async function sendToWebhook(
  userPhone: string,
  userMessage: string,
  requestId: string,
  timeoutMs = 25000,
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
        console.log(
          `[webhook] 📡 Calling ${url} (attempt ${attempt}/${maxAttemptsPerEndpoint}, timeout: ${timeoutMs}ms)`,
        )

        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          console.log(`[webhook] ⏱️ Timeout triggered after ${timeoutMs}ms`)
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

          console.log(`[webhook] ✅ SUCCESS in ${duration}ms`)
          return { ok: true, message }
        } else {
          lastDetail = `Status ${response.status}`
          console.log(`[webhook] ❌ FAILED in ${duration}ms: ${lastDetail}`)
        }
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))
        lastDetail = isTimeout ? "Request timeout" : err instanceof Error ? err.message : String(err)
        console.log(`[webhook] ⚠️ ERROR ${isTimeout ? "(TIMEOUT)" : ""}: ${lastDetail}`)
      }

      if (attempt < maxAttemptsPerEndpoint) {
        const backoff = 1000
        console.log(`[webhook] Waiting ${backoff}ms before retry...`)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }

  return {
    ok: false,
    message: `Unable to reach webhook after ${maxAttemptsPerEndpoint * endpoints.length} attempts. Last error: ${lastDetail}`,
  }
}
