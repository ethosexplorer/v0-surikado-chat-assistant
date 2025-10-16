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
    lastPollTime: number
    webhookCompleted: boolean
    rapidPollingStarted: boolean // NEW: Track rapid polling state
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

// TIMING CONFIGURATION - OPTIMIZED FOR RAPID POLLING
const EMPTY_MESSAGE_INTERVAL = 8000 // Send empty message every 8 seconds
const API_CALL_TIME = 3 // Call n8n API after 3 seconds
const RAPID_POLLING_START_TIME = 70 // Start rapid polling after 70 seconds (1:10 mins)
const MAX_TOTAL_TIME = 120 // Absolute max 2 minutes
const POLL_TIMEOUT = 45000 // 45 seconds poll timeout
const WEBHOOK_TIMEOUT = 90000 // 90 seconds for webhook to complete

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

      // Update last poll time to prevent timeout
      conversation.lastPollTime = Date.now()
      activeConversations.set(userPhone, conversation)

      const elapsedSeconds = Math.floor((Date.now() - conversation.startTime) / 1000)
      const totalProcessingTime = conversation.webhookStartTime 
        ? Math.floor((Date.now() - conversation.webhookStartTime) / 1000)
        : 0

      console.log(
        `[poll] Elapsed: ${elapsedSeconds}s, Processing: ${totalProcessingTime}s, WebhookCalled: ${conversation.webhookCalled}, RapidPolling: ${conversation.rapidPollingStarted}`,
      )

      // NEW: Check if we should start rapid polling (after 70 seconds)
      if (elapsedSeconds >= RAPID_POLLING_START_TIME && !conversation.rapidPollingStarted) {
        conversation.rapidPollingStarted = true
        activeConversations.set(userPhone, conversation)
        console.log(`[poll] 🚀 STARTING RAPID POLLING at ${elapsedSeconds}s`)
      }

      // Check if polling has timed out (no polls for 45 seconds)
      const timeSinceLastPoll = Date.now() - conversation.lastPollTime
      if (timeSinceLastPoll > POLL_TIMEOUT) {
        console.error(`[poll] POLLING TIMEOUT - No polls for ${timeSinceLastPoll}ms`)
        activeConversations.delete(userPhone)
        conversationResponses.delete(userPhone)
        return NextResponse.json({
          status: "timeout",
          message: "Session expired. Please send your message again.",
          elapsedSeconds,
          completed: true,
          success: false,
        })
      }

      // Check if webhook is taking too long to complete
      if (conversation.webhookCalled && !conversation.webhookCompleted && conversation.webhookStartTime) {
        const webhookElapsed = Date.now() - conversation.webhookStartTime
        if (webhookElapsed > WEBHOOK_TIMEOUT) {
          console.error(`[poll] WEBHOOK TIMEOUT after ${Math.floor(webhookElapsed / 1000)}s`)
          activeConversations.delete(userPhone)
          conversationResponses.delete(userPhone)
          return NextResponse.json({
            status: "completed",
            message: "The request is taking longer than expected. Please try again.",
            elapsedSeconds,
            completed: true,
            success: false,
          })
        }
      }

      // ABSOLUTE TIMEOUT - Force error if taking too long
      if (elapsedSeconds >= MAX_TOTAL_TIME) {
        console.error(`[poll] HARD TIMEOUT after ${elapsedSeconds}s`)
        activeConversations.delete(userPhone)
        conversationResponses.delete(userPhone)
        return NextResponse.json({
          status: "completed",
          message: "I apologize for the delay. Please try sending your message again.",
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

      // Check if it's time to call the API (at 3 seconds)
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
          message: "⚡ Starting to process your soft skills...",
          elapsedSeconds,
          completed: false,
        })
      }

      // If webhook has been called, show processing status
      if (conversation.webhookCalled && !conversation.completed) {
        const webhookElapsed = conversation.webhookStartTime
          ? Math.floor((Date.now() - conversation.webhookStartTime) / 1000)
          : 0

        console.log(`[poll] API processing for ${webhookElapsed}s`)

        // Show more specific messages based on processing time
        let processingMessage = "⚡ Processing your information..."
        if (webhookElapsed > 60) {
          processingMessage = "🔄 Finalizing your analysis... Almost done!"
        } else if (webhookElapsed > 45) {
          processingMessage = "📊 Compiling your soft skills assessment..."
        } else if (webhookElapsed > 30) {
          processingMessage = "💡 Analyzing your strengths and opportunities..."
        } else if (webhookElapsed > 15) {
          processingMessage = "🎯 Processing your response..."
        }

        return NextResponse.json({
          status: "processing",
          message: processingMessage,
          elapsedSeconds,
          webhookElapsed,
          rapidPolling: conversation.rapidPollingStarted, // NEW: Tell frontend to poll faster
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

      // Start tracking - API will be called at 3 seconds
      activeConversations.set(userPhone, {
        startTime: Date.now(),
        lastEmptyMessageTime: Date.now(),
        lastPollTime: Date.now(),
        completed: false,
        userMessage: userMessage,
        webhookCalled: false,
        emptyMessageCount: 0,
        processingStarted: false,
        webhookCompleted: false,
        rapidPollingStarted: false, // NEW
      })

      console.log(`[send] Conversation started. API will be called at ${API_CALL_TIME}s`)

      return NextResponse.json({
        ok: true,
        status: "pending",
        message: "Response received. Starting analysis...",
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

// Background processing - called once at 3 seconds
async function processWebhookInBackground(userPhone: string, userMessage: string, requestId: string) {
  const startTime = Date.now()
  console.log(`[background] 🚀 Starting API call for ${userPhone}`)

  try {
    // Call with timeout matching n8n workflow time (90 seconds)
    const result = await sendToWebhook(userPhone, userMessage, requestId, WEBHOOK_TIMEOUT)

    const duration = Math.floor((Date.now() - startTime) / 1000)
    console.log(`[background] Webhook completed in ${duration}s`)

    if (result.ok) {
      console.log(`[background] ✅ API SUCCESS in ${duration}s`)
      console.log(`[background] Response: ${result.message.substring(0, 200)}...`)

      conversationResponses.set(userPhone, {
        message: result.message || "Analysis complete! Here's your soft skills assessment.",
        timestamp: Date.now(),
        success: true,
      })
    } else {
      console.error(`[background] ❌ API FAILED in ${duration}s:`, result.message)

      conversationResponses.set(userPhone, {
        message: "I encountered an issue processing your response. Please try again in a moment.",
        timestamp: Date.now(),
        success: false,
      })
    }

    // Mark as completed
    const conversation = activeConversations.get(userPhone)
    if (conversation) {
      conversation.completed = true
      conversation.webhookCompleted = true
      activeConversations.set(userPhone, conversation)
      const totalTime = Math.floor((Date.now() - conversation.startTime) / 1000)
      console.log(`[background] Marked as completed (total time: ${totalTime}s)`)
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
      conversation.webhookCompleted = true
      activeConversations.set(userPhone, conversation)
    }
  }
}

// Send to webhook - keep existing implementation
async function sendToWebhook(
  userPhone: string,
  userMessage: string,
  requestId: string,
  timeoutMs = 90000,
): Promise<{ ok: boolean; message: string }> {
  // ... keep existing sendToWebhook implementation
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
  let lastResponse: any = null

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
        
        let body: any
        if (contentType.includes("application/json")) {
          try {
            body = await response.json()
            lastResponse = body
            console.log(`[webhook] JSON response received in ${duration}ms`)
          } catch (e) {
            const rawText = await response.text()
            body = { raw: rawText }
            lastResponse = rawText
            console.log(`[webhook] Text response received in ${duration}ms`)
          }
        } else {
          const rawText = await response.text()
          body = { raw: rawText }
          lastResponse = rawText
          console.log(`[webhook] Non-JSON response received in ${duration}ms`)
        }

        if (response.ok) {
          let message = "Analysis complete! Here's your soft skills assessment."
          
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

          console.log(`[webhook] ✅ SUCCESS in ${duration}ms`)
          console.log(`[webhook] Final message: ${message.substring(0, 100)}...`)
          return { ok: true, message }
        } else {
          lastDetail = `Status ${response.status}`
          console.log(`[webhook] ❌ FAILED in ${duration}ms: ${lastDetail}`, body)
        }
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))
        lastDetail = isTimeout ? "Request timeout" : err instanceof Error ? err.message : String(err)
        console.log(`[webhook] ⚠️ ERROR ${isTimeout ? "(TIMEOUT)" : ""}: ${lastDetail}`)
        
        if (isTimeout) {
          break
        }
      }

      if (attempt < maxAttemptsPerEndpoint) {
        const backoff = 2000
        console.log(`[webhook] Waiting ${backoff}ms before retry...`)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }

  return {
    ok: false,
    message: "I'm having trouble processing your request right now. Please try again in a moment.",
  }
}
