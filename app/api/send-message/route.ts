import { type NextRequest, NextResponse } from "next/server"

// Configuration
export const maxDuration = 300 // 5 minutes
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
  isSoftSkillsFollowUp: boolean
  requestId: string
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
  status?: string
}

// ============================================
// Enhanced Storage with Request Locking
// ============================================

class ConversationStore {
  private conversations = new Map<string, ConversationState>()
  private responses = new Map<string, FinalResponse>()
  
  // Track active requests to prevent duplicates
  private activeRequests = new Map<string, boolean>()

  // Check if user has active request
  hasActiveRequest(phone: string): boolean {
    return this.activeRequests.get(phone) || false
  }

  // Set active request status
  setActiveRequest(phone: string, active: boolean): void {
    this.activeRequests.set(phone, active)
  }

  // Conversation methods
  setConversation(phone: string, state: ConversationState): void {
    this.conversations.set(phone, state)
  }

  getConversation(phone: string): ConversationState | undefined {
    return this.conversations.get(phone)
  }

  deleteConversation(phone: string): void {
    this.conversations.delete(phone)
    this.activeRequests.delete(phone) // Clean up active request
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
        this.activeRequests.delete(phone)
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
  MAX_TOTAL_TIME: 300000, // 5 minutes absolute maximum (300 seconds)
  WEBHOOK_TIMEOUT: 90000, // 90 seconds for webhook call (1.5 minutes)
  NORMAL_MESSAGE_TIMEOUT: 25000, // 25 seconds for normal messages
  CLEANUP_INTERVAL: 60000, // Clean up every minute
  MAX_CONVERSATION_AGE: 900000, // 15 minutes
  POLLING_WAIT_TIME: 10000, // Wait 10 seconds before first webhook call
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
// Enhanced Webhook Communication
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
    
    // Try each endpoint with increased timeout and better retry logic
    for (const url of this.endpoints) {
      console.log(`[Webhook] 🔄 Trying endpoint: ${url}`)
      
      const result = await this.attemptWebhookCall(url, payload, timeoutMs)
        
      if (result.ok) {
        console.log(`[Webhook] ✅ Success with endpoint: ${url}`)
        return result
      }

      console.log(`[Webhook] ❌ Endpoint failed: ${url}, error: ${result.error}`)
      
      // Wait before trying next endpoint
      await this.delay(2000)
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
    timeoutMs: number
  ): Promise<WebhookResult> {
    const startTime = Date.now()
    
    try {
      console.log(`[Webhook] 📡 Calling ${url} (timeout: ${timeoutMs}ms)`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log(`[Webhook] ⏱️ Timeout after ${timeoutMs}ms`)
        controller.abort()
      }, timeoutMs)

      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*"
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const duration = Date.now() - startTime

      if (response.ok) {
        const responseText = await response.text()
        console.log(`[Webhook] ✅ Success in ${duration}ms, status: ${response.status}, response:`, responseText)

        // FIXED: Return the actual response text from n8n
        let message = responseText
        
        // Try to parse JSON and extract meaningful content
        try {
          const jsonResponse = JSON.parse(responseText)
          // Extract message from various possible response formats
          message = jsonResponse.output || jsonResponse.message || jsonResponse.response || jsonResponse.body || responseText
        } catch {
          // If not JSON, use the text as is
          message = responseText
        }

        // Clean up the message - remove empty or generic responses
        if (!message || message.trim() === "" || message === "success" || message === "Success") {
          message = "Thank you for your message! I've received your information and will help you find the best opportunities."
        }

        return { ok: true, message, duration }
      }

      // Handle non-200 responses
      console.log(`[Webhook] ❌ Failed with status ${response.status} in ${duration}ms`)
      return {
        ok: false,
        message: `Webhook returned status ${response.status}`,
        duration,
        error: `HTTP ${response.status}`,
      }

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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

const webhookClient = new WebhookClient()

// ============================================
// Enhanced Background Processing
// ============================================

async function processWebhookInBackground(
  userPhone: string,
  userMessage: string,
  requestId: string
): Promise<void> {
  const startTime = Date.now()
  console.log(`[Background] 🚀 Starting API call for ${userPhone}, request: ${requestId}`)

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
      
      // Use the actual message from webhook response
      store.setResponse(userPhone, {
        message: result.message,
        timestamp: Date.now(),
        success: true,
      })
    } else {
      console.error(`[Background] ❌ API FAILED in ${duration}s:`, result.error)
      store.setResponse(userPhone, {
        message: "Thank you for your response! Our system is processing your information and will get back to you shortly.",
        timestamp: Date.now(),
        success: true,
      })
    }

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000)
    console.error(`[Background] ⚠️ Exception after ${duration}s:`, error)

    store.setResponse(userPhone, {
      message: "Thank you for sharing your information! We're processing your response and will have personalized job recommendations for you shortly.",
      timestamp: Date.now(),
      success: true,
    })
  } finally {
    // Mark conversation as completed and release the active request lock
    const conversation = store.getConversation(userPhone)
    if (conversation) {
      conversation.completed = true
      store.setConversation(userPhone, conversation)
    }
    
    // Release the active request lock
    store.setActiveRequest(userPhone, false)
    console.log(`[Background] Request completed and lock released for ${userPhone}`)
  }
}

// ============================================
// Enhanced Request Handlers
// ============================================

async function handlePollRequest(userPhone: string): Promise<NextResponse> {
  const conversation = store.getConversation(userPhone)

  // Check for stored final response first
  if (!conversation) {
    const finalResponse = store.getResponse(userPhone)
    if (finalResponse) {
      console.log(`[Poll] Found stored final response`)
      store.deleteResponse(userPhone)
      store.setActiveRequest(userPhone, false) // Release lock
      return NextResponse.json({
        status: "completed",
        message: finalResponse.message,
        timestamp: finalResponse.timestamp,
        success: finalResponse.success,
      })
    }
    
    // Also release lock if no conversation found
    store.setActiveRequest(userPhone, false)
    return NextResponse.json({
      status: "none",
      message: "No active conversation found",
    })
  }

  const elapsedSeconds = Math.floor((Date.now() - conversation.startTime) / 1000)
  console.log(`[Poll] Elapsed: ${elapsedSeconds}s, WebhookCalled: ${conversation.webhookCalled}, Completed: ${conversation.completed}`)

  // Hard timeout (5 minutes)
  if (elapsedSeconds >= TIMING.MAX_TOTAL_TIME / 1000) {
    console.error(`[Poll] HARD TIMEOUT after ${elapsedSeconds}s`)
    store.deleteConversation(userPhone)
    store.deleteResponse(userPhone)
    store.setActiveRequest(userPhone, false) // Release lock
    return NextResponse.json({
      status: "completed",
      message: "Thank you for your patience! We've processed your information and will continue our conversation shortly.",
      elapsedSeconds,
      completed: true,
      success: true,
    })
  }

  // Return completed response
  if (conversation.completed) {
    const finalResponse = store.getResponse(userPhone)
    if (finalResponse) {
      console.log(`[Poll] Returning completed response (took ${elapsedSeconds}s total)`)
      store.deleteConversation(userPhone)
      store.deleteResponse(userPhone)
      store.setActiveRequest(userPhone, false) // Release lock
      return NextResponse.json({
        status: "completed",
        message: finalResponse.message,
        elapsedSeconds,
        completed: true,
        success: finalResponse.success,
      })
    }
  }

  // FIXED: Call API immediately for soft skills follow-ups with proper timing
  if (!conversation.webhookCalled && conversation.isSoftSkillsFollowUp) {
    // Wait a bit before calling webhook to ensure n8n is ready
    const timeSinceStart = Date.now() - conversation.startTime
    if (timeSinceStart >= TIMING.POLLING_WAIT_TIME) {
      console.log(`[Poll] ⏰ Starting API call for soft skills follow-up after ${timeSinceStart}ms`)
      
      conversation.webhookCalled = true
      conversation.webhookStartTime = Date.now()
      conversation.processingStarted = true
      store.setConversation(userPhone, conversation)

      // Start background processing (don't await)
      processWebhookInBackground(userPhone, conversation.userMessage, conversation.requestId)

      return NextResponse.json({
        status: "processing",
        message: "⚡ Processing your soft skills information and finding matching opportunities...",
        elapsedSeconds,
        completed: false,
      })
    } else {
      // Still waiting before calling webhook
      return NextResponse.json({
        status: "waiting",
        message: "🔄 Preparing to process your information...",
        elapsedSeconds,
        completed: false,
      })
    }
  }

  // Webhook already called, still processing
  if (conversation.webhookCalled && !conversation.completed) {
    const webhookElapsed = conversation.webhookStartTime
      ? Math.floor((Date.now() - conversation.webhookStartTime) / 1000)
      : 0

    console.log(`[Poll] API still processing... (${webhookElapsed}s since webhook call)`)
    
    // Send appropriate waiting messages
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

    return NextResponse.json({
      status: "processing",
      message: "⚡ Processing your information...",
      elapsedSeconds,
      webhookElapsed,
      completed: false,
    })
  }

  // Send empty messages while waiting
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

// Enhanced detection to separate actual soft skills questions from technical skills
function detectMessageType(userMessage: string): { isSoftSkillsQuestion: boolean; isTechnicalSkills: boolean } {
  const text = userMessage.toLowerCase()
  
  // Actual soft skills QUESTIONS (from bot)
  const softSkillsQuestions = [
    "soft skills", "primary skills", "what soft skills",
    "teamwork", "problem-solving", "communication",
    "adaptability", "technical leadership", "what are your soft skills",
    "tell me about your skills", "what skills do you have",
    "what are your primary skills", "describe your skills"
  ]
  
  // Technical skills keywords
  const technicalSkills = [
    "java", "spring", "framework", "sql", "spring boot", "rest api",
    "git", "docker", "postgresql", "maven", "oracle", "kubernetes",
    "java ee", "python", "javascript", "react", "node", "aws",
    "azure", "cloud", "database", "api", "microservices", "devops",
    "html", "css", "typescript", "angular", "vue", "mongodb",
    "mysql", "redis", "kafka", "jenkins", "ansible", "terraform"
  ]
  
  const isQuestion = softSkillsQuestions.some(keyword => text.includes(keyword))
  const isTechnical = technicalSkills.some(skill => text.includes(skill))
  
  console.log(`[Server Detection] Question: ${isQuestion}, Technical: ${isTechnical}, Message: ${userMessage}`)
  
  return {
    isSoftSkillsQuestion: isQuestion,
    isTechnicalSkills: isTechnical && !isQuestion
  }
}

// UPDATED: handleSendRequest - Only use polling for actual soft skills questions
async function handleSendRequest(
  userPhone: string,
  userMessage: string,
  isSoftSkillsQuestion: boolean,
  requestId: string
): Promise<NextResponse> {
  console.log(`[Send] Message: ${userMessage.substring(0, 50)}, Client SoftSkills: ${isSoftSkillsQuestion}`)

  // FIXED: Server-side detection to separate actual questions from technical skills
  const serverDetection = detectMessageType(userMessage)
  const shouldUsePolling = isSoftSkillsQuestion && serverDetection.isSoftSkillsQuestion
  
  console.log(`[Send] Server Detection - Question: ${serverDetection.isSoftSkillsQuestion}, Technical: ${serverDetection.isTechnicalSkills}, Final Use Polling: ${shouldUsePolling}`)

  // Check for active requests first
  if (store.hasActiveRequest(userPhone)) {
    console.log(`[Send] ❌ Active request already in progress for ${userPhone}`)
    return NextResponse.json({
      ok: false,
      error: "Please wait for the current request to complete before sending another message.",
      status: "processing"
    })
  }

  // Set active request immediately
  store.setActiveRequest(userPhone, true)

  // Handle ONLY actual soft skills questions with polling
  if (shouldUsePolling) {
    console.log(`[Send] Starting soft skills processing flow for question: ${userMessage}`)

    // Clean up existing conversation if it's completed
    const existingConversation = store.getConversation(userPhone)
    if (existingConversation && existingConversation.completed) {
      console.log(`[Send] Cleaning up completed conversation`)
      store.deleteConversation(userPhone)
      store.deleteResponse(userPhone)
    }

    // Start tracking - API will be called during polling after a short delay
    store.setConversation(userPhone, {
      startTime: Date.now(),
      lastEmptyMessageTime: Date.now(),
      completed: false,
      userMessage: userMessage,
      webhookCalled: false,
      emptyMessageCount: 0,
      processingStarted: false,
      isSoftSkillsFollowUp: true,
      requestId: requestId,
    })

    console.log(`[Send] Soft skills question conversation started. API will be called during polling`)

    return NextResponse.json({
      ok: true,
      status: "pending",
      message: "Processing your skills information...",
      requestId,
      pending: true,
      isSoftSkillsResponse: true,
      requiresPolling: true,
    })
  }

  // For ALL other messages (technical skills, normal messages) - call webhook immediately and return response
  console.log(`[Send] Immediate processing for: ${userMessage}`)
  
  try {
    const result = await webhookClient.sendToWebhook(
      userPhone,
      userMessage,
      requestId,
      TIMING.NORMAL_MESSAGE_TIMEOUT
    )

    // Release lock immediately
    store.setActiveRequest(userPhone, false)

    // Return the actual API response directly to frontend
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      error: result.error,
      isSoftSkillsResponse: false,
      requiresPolling: false,
    })
  } catch (error) {
    // Ensure lock is released on error
    store.setActiveRequest(userPhone, false)
    
    console.error(`[Send] Error calling webhook:`, error)
    return NextResponse.json({
      ok: false,
      error: `Failed to process message: ${error instanceof Error ? error.message : "Unknown error"}`,
      requiresPolling: false,
    })
  }
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
    console.log(`[${new Date().toISOString()}] Action: ${action}, Phone: ${userPhone}, SoftSkills: ${isSoftSkillsQuestion}`)

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