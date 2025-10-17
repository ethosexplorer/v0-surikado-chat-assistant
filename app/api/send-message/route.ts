// ============================================
// SERVER-SIDE: /app/api/send-message/route.ts
// ============================================

import { type NextRequest, NextResponse } from "next/server"

// Configuration
export const maxDuration = 300 // 5 minutes (Pro plan)
export const dynamic = "force-dynamic"

// ============================================
// Types
// ============================================

interface ConversationState {
  startTime: number
  lastEmptyMessageTime: number
  completed: boolean
  userMessage: string
  webhookCalled: boolean
  emptyMessageCount: number
  webhookStartTime?: number
  processingStarted: boolean
}

interface FinalResponse {
  message: string
  timestamp: number
  success: boolean
}

interface WebhookResult {
  ok: boolean
  message: string
  duration?: number
  error?: string
}

// ============================================
// In-Memory Storage (Use Redis in production)
// ============================================

class ConversationStore {
  private conversations = new Map<string, ConversationState>()
  private responses = new Map<string, FinalResponse>()

  // Conversation methods
  setConversation(phone: string, state: ConversationState): void {
    this.conversations.set(phone, state)
  }

  getConversation(phone: string): ConversationState | undefined {
    return this.conversations.get(phone)
  }

  deleteConversation(phone: string): void {
    this.conversations.delete(phone)
  }

  hasConversation(phone: string): boolean {
    return this.conversations.has(phone)
  }

  // Response methods
  setResponse(phone: string, response: FinalResponse): void {
    this.responses.set(phone, response)
  }

  getResponse(phone: string): FinalResponse | undefined {
    return this.responses.get(phone)
  }

  deleteResponse(phone: string): void {
    this.responses.delete(phone)
  }

  // Cleanup old data
  cleanup(maxAge: number): void {
    const now = Date.now()

    // Cleanup old conversations
    for (const [phone, conv] of this.conversations.entries()) {
      if (now - conv.startTime > maxAge) {
        this.conversations.delete(phone)
        this.responses.delete(phone)
        console.log(`[Cleanup] Removed stale conversation: ${phone}`)
      }
    }

    // Cleanup old responses
    for (const [phone, response] of this.responses.entries()) {
      if (now - response.timestamp > maxAge) {
        this.responses.delete(phone)
        console.log(`[Cleanup] Removed stale response: ${phone}`)
      }
    }
  }
}

// ============================================
// Timing Configuration
// ============================================

const TIMING = {
  EMPTY_MESSAGE_INTERVAL: 8000, // 8 seconds between empty messages
  API_CALL_TIME: 78, // Call webhook after 78 seconds (1.18 minutes)
  MAX_TOTAL_TIME: 180, // 3 minutes absolute maximum
  WEBHOOK_TIMEOUT: 120000, // 2 minutes for webhook call
  NORMAL_MESSAGE_TIMEOUT: 25000, // 25 seconds for normal messages
  CLEANUP_INTERVAL: 60000, // Clean up every minute
  MAX_CONVERSATION_AGE: 600000, // 10 minutes
}

// ============================================
// Global Store Instance
// ============================================

const store = new ConversationStore()

// Start cleanup interval
setInterval(() => {
  store.cleanup(TIMING.MAX_CONVERSATION_AGE)
}, TIMING.CLEANUP_INTERVAL)

// ============================================
// Helper Functions
// ============================================

function normalizeWhatsApp(raw: unknown): string {
  if (!raw) return ""
  let n = String(raw).trim()
  if (n.toLowerCase().startsWith("whatsapp:")) n = n.slice(9)
  n = n.replace(/[^+\d]/g, "")
  if (!n.startsWith("+")) n = `+${n}`
  return `whatsapp:${n}`
}

function getEmptyMessage(count: number): string {
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
  return messages[count % messages.length]
}

// ============================================
// Webhook Communication
// ============================================

class WebhookClient {
  private readonly endpoints = [
    "https://surikado.hellodexter.com:5678/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
    "https://surikado.hellodexter.com/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
  ]

  async sendToWebhook(
    userPhone: string,
    userMessage: string,
    requestId: string,
    timeoutMs: number
  ): Promise<WebhookResult> {
    const payload = this.createWebhookPayload(userPhone, userMessage, requestId)
    const maxAttemptsPerEndpoint = 2

    for (const url of this.endpoints) {
      for (let attempt = 1; attempt <= maxAttemptsPerEndpoint; attempt++) {
        const result = await this.attemptWebhookCall(url, payload, timeoutMs, attempt, maxAttemptsPerEndpoint)
        
        if (result.ok) {
          return result
        }

        // Wait before retry (except on last attempt of last endpoint)
        if (attempt < maxAttemptsPerEndpoint) {
          await this.delay(1000)
        }
      }
    }

    return {
      ok: false,
      message: "Unable to reach webhook after all attempts",
      error: "All webhook endpoints failed",
    }
  }

  private async attemptWebhookCall(
    url: string,
    payload: any,
    timeoutMs: number,
    attempt: number,
    maxAttempts: number
  ): Promise<WebhookResult> {
    const startTime = Date.now()
    
    try {
      console.log(`[Webhook] 📡 Calling ${url} (attempt ${attempt}/${maxAttempts}, timeout: ${timeoutMs}ms)`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log(`[Webhook] ⏱️ Timeout after ${timeoutMs}ms`)
        controller.abort()
      }, timeoutMs)

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const duration = Date.now() - startTime

      if (!response.ok) {
        console.log(`[Webhook] ❌ Failed with status ${response.status} in ${duration}ms`)
        return {
          ok: false,
          message: `Webhook returned status ${response.status}`,
          duration,
          error: `HTTP ${response.status}`,
        }
      }

      const body = await this.parseResponseBody(response)
      const message = this.extractMessage(body)

      console.log(`[Webhook] ✅ Success in ${duration}ms`)
      return { ok: true, message, duration }

    } catch (error) {
      const duration = Date.now() - startTime
      const isTimeout = error instanceof Error && 
        (error.name === "AbortError" || error.message.includes("aborted"))
      
      const errorMsg = isTimeout ? "Timeout" : error instanceof Error ? error.message : "Unknown error"
      console.log(`[Webhook] ⚠️ Error in ${duration}ms: ${errorMsg}`)

      return {
        ok: false,
        message: errorMsg,
        duration,
        error: errorMsg,
      }
    }
  }

  private createWebhookPayload(userPhone: string, userMessage: string, requestId: string) {
    return {
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
  }

  private async parseResponseBody(response: Response): Promise<any> {
    const contentType = response.headers.get("content-type") || ""
    
    if (contentType.includes("application/json")) {
      try {
        return await response.json()
      } catch {
        return { raw: await response.text() }
      }
    }
    
    return { raw: await response.text() }
  }

  private extractMessage(body: any): string {
    if (!body) return "Success"
    
    if (typeof body === "string") return body
    
    if (typeof body === "object") {
      return body.output || body.message || JSON.stringify(body)
    }
    
    return "Success"
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

const webhookClient = new WebhookClient()

// ============================================
// Background Processing
// ============================================

async function processWebhookInBackground(
  userPhone: string,
  userMessage: string,
  requestId: string
): Promise<void> {
  const startTime = Date.now()
  console.log(`[Background] 🚀 Starting API call for ${userPhone}`)

  try {
    const result = await webhookClient.sendToWebhook(
      userPhone,
      userMessage,
      requestId,
      TIMING.WEBHOOK_TIMEOUT
    )

    const duration = Math.floor((Date.now() - startTime) / 1000)

    if (result.ok) {
      console.log(`[Background] ✅ API SUCCESS in ${duration}s`)
      store.setResponse(userPhone, {
        message: result.message || "Response received",
        timestamp: Date.now(),
        success: true,
      })
    } else {
      console.error(`[Background] ❌ API FAILED in ${duration}s:`, result.error)
      store.setResponse(userPhone, {
        message: "I'm processing your information. Please wait a moment and try again.",
        timestamp: Date.now(),
        success: false,
      })
    }

    // Mark conversation as completed
    const conversation = store.getConversation(userPhone)
    if (conversation) {
      conversation.completed = true
      store.setConversation(userPhone, conversation)
      console.log(`[Background] Marked as completed (total: ${Math.floor((Date.now() - conversation.startTime) / 1000)}s)`)
    }

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000)
    console.error(`[Background] ⚠️ Exception after ${duration}s:`, error)

    store.setResponse(userPhone, {
      message: "I apologize, but I'm having trouble processing your response. Please try again.",
      timestamp: Date.now(),
      success: false,
    })

    const conversation = store.getConversation(userPhone)
    if (conversation) {
      conversation.completed = true
      store.setConversation(userPhone, conversation)
    }
  }
}

// ============================================
// Request Handlers
// ============================================

async function handlePollRequest(userPhone: string): Promise<NextResponse> {
  const conversation = store.getConversation(userPhone)

  // Check for stored final response first
  if (!conversation) {
    const finalResponse = store.getResponse(userPhone)
    if (finalResponse) {
      console.log(`[Poll] Found stored final response`)
      store.deleteResponse(userPhone)
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
  console.log(`[Poll] Elapsed: ${elapsedSeconds}s, WebhookCalled: ${conversation.webhookCalled}, Completed: ${conversation.completed}`)

  // Hard timeout
  if (elapsedSeconds >= TIMING.MAX_TOTAL_TIME) {
    console.error(`[Poll] HARD TIMEOUT after ${elapsedSeconds}s`)
    store.deleteConversation(userPhone)
    store.deleteResponse(userPhone)
    return NextResponse.json({
      status: "completed",
      message: "I apologize for the delay. Please try sending your soft skills again.",
      elapsedSeconds,
      completed: true,
      success: false,
    })
  }

  // Return completed response
  if (conversation.completed) {
    const finalResponse = store.getResponse(userPhone)
    if (finalResponse) {
      console.log(`[Poll] Returning completed response (took ${elapsedSeconds}s total)`)
      store.deleteConversation(userPhone)
      store.deleteResponse(userPhone)
      return NextResponse.json({
        status: "completed",
        message: finalResponse.message,
        elapsedSeconds,
        completed: true,
        success: finalResponse.success,
      })
    }
  }

  // Time to call API (at 78 seconds)
  if (elapsedSeconds >= TIMING.API_CALL_TIME && !conversation.webhookCalled) {
    console.log(`[Poll] ⏰ Reached ${TIMING.API_CALL_TIME}s - CALLING API NOW`)
    
    conversation.webhookCalled = true
    conversation.webhookStartTime = Date.now()
    conversation.processingStarted = true
    store.setConversation(userPhone, conversation)

    // Start background processing (don't await)
    processWebhookInBackground(userPhone, conversation.userMessage, `${userPhone}-${Date.now()}`)

    return NextResponse.json({
      status: "processing",
      message: "⚡ Processing your information...",
      elapsedSeconds,
      completed: false,
    })
  }

  // Webhook already called, still processing
  if (conversation.webhookCalled && !conversation.completed) {
    const webhookElapsed = conversation.webhookStartTime
      ? Math.floor((Date.now() - conversation.webhookStartTime) / 1000)
      : 0

    console.log(`[Poll] API still processing... (${webhookElapsed}s since webhook call)`)
    
    return NextResponse.json({
      status: "processing",
      message: "⚡ Processing your information...",
      elapsedSeconds,
      webhookElapsed,
      completed: false,
    })
  }

  // Send empty messages before API call time
  const timeSinceLastEmpty = Date.now() - conversation.lastEmptyMessageTime
  if (timeSinceLastEmpty >= TIMING.EMPTY_MESSAGE_INTERVAL) {
    conversation.lastEmptyMessageTime = Date.now()
    conversation.emptyMessageCount++
    store.setConversation(userPhone, conversation)

    console.log(`[Poll] Empty message #${conversation.emptyMessageCount} at ${elapsedSeconds}s`)

    return NextResponse.json({
      status: "empty",
      message: getEmptyMessage(conversation.emptyMessageCount),
      elapsedSeconds,
      completed: false,
    })
  }

  // Still waiting
  return NextResponse.json({
    status: "waiting",
    message: getEmptyMessage(conversation.emptyMessageCount),
    elapsedSeconds,
    completed: false,
  })
}

async function handleSendRequest(
  userPhone: string,
  userMessage: string,
  isSoftSkillsQuestion: boolean,
  requestId: string
): Promise<NextResponse> {
  console.log(`[Send] Message:`, userMessage.substring(0, 50))

  if (isSoftSkillsQuestion) {
    console.log(`[Send] Starting soft skills response flow`)

    // Clean up existing conversation
    if (store.hasConversation(userPhone)) {
      console.log(`[Send] Cleaning up existing conversation`)
      store.deleteConversation(userPhone)
      store.deleteResponse(userPhone)
    }

    // Start tracking - API will be called at 78 seconds
    store.setConversation(userPhone, {
      startTime: Date.now(),
      lastEmptyMessageTime: Date.now(),
      completed: false,
      userMessage: userMessage,
      webhookCalled: false,
      emptyMessageCount: 0,
      processingStarted: false,
    })

    console.log(`[Send] Conversation started. API will be called at ${TIMING.API_CALL_TIME}s`)

    return NextResponse.json({
      ok: true,
      status: "pending",
      message: "Response received. Processing...",
      requestId,
      pending: true,
      isSoftSkillsResponse: true,
    })
  }

  // Normal message - call webhook immediately
  console.log(`[Send] Normal message - calling webhook immediately`)
  const result = await webhookClient.sendToWebhook(
    userPhone,
    userMessage,
    requestId,
    TIMING.NORMAL_MESSAGE_TIMEOUT
  )

  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    error: result.error,
  })
}

// ============================================
// Main POST Handler
// ============================================

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""
    const action = data.action || "send"
    const isSoftSkillsQuestion = data.isSoftSkillsQuestion || false

    const userPhone = normalizeWhatsApp(data.toPhone)
    if (!userPhone) {
      return NextResponse.json(
        { error: "toPhone (WhatsApp number) is required" },
        { status: 400 }
      )
    }

    const requestId = `${userPhone}-${Date.now()}`
    console.log(`[${new Date().toISOString()}] Action: ${action}, Phone: ${userPhone}`)

    // Route to appropriate handler
    if (action === "poll") {
      return handlePollRequest(userPhone)
    }

    if (action === "send") {
      if (!userMessage) {
        return NextResponse.json(
          { error: "Message is required" },
          { status: 400 }
        )
      }
      return handleSendRequest(userPhone, userMessage, isSoftSkillsQuestion, requestId)
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'send' or 'poll'" },
      { status: 400 }
    )

  } catch (error) {
    console.error(`[Error] Server error:`, error)
    return NextResponse.json(
      {
        error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    )
  }
}
