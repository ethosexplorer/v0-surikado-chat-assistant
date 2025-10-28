import { type NextRequest, NextResponse } from "next/server"

// ============================================
// Enhanced Webhook Communication (from repo)
// ============================================

class WebhookClient {
  private readonly endpoints = [
    "https://surikado.hellodexter.com/webhook/130bb4fe-11e5-4442-9a63-a68de302e144",
  ]

  async sendToWebhook(
    userPhone: string,
    userMessage: string,
    requestId: string,
    timeoutMs: number = 30000
  ): Promise<{ ok: boolean; message: string; error?: string }> {
    const payload = this.createWebhookPayload(userPhone, userMessage, requestId)
    
    // Try each endpoint with better retry logic
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
  ): Promise<{ ok: boolean; message: string; error?: string }> {
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

        // Extract meaningful message from response
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

        return { ok: true, message }
      }

      // Handle non-200 responses
      console.log(`[Webhook] ❌ Failed with status ${response.status} in ${duration}ms`)
      return {
        ok: false,
        message: `Webhook returned status ${response.status}`,
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
// Main POST Handler
// ============================================

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""

    if (!userMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    console.log("[API] Processing message:", userMessage)

    // Get the phone number from request data
    const userPhone = data.toPhone ? normalizeWhatsApp(data.toPhone) : "whatsapp:+923346250250"
    const requestId = `msg-${Date.now()}`

    // Use the enhanced webhook client from repo code
    const result = await webhookClient.sendToWebhook(
      userPhone,
      userMessage,
      requestId,
      30000 // 30 second timeout
    )

    if (result.ok) {
      return NextResponse.json({ 
        message: result.message, 
        success: true 
      })
    } else {
      // Return a proper error response instead of falling back to echo
      console.error("[API] Webhook failed after all attempts:", result.error)
      
      return NextResponse.json({
        error: "Failed to process your message",
        message: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
        success: false,
      }, { status: 500 })
    }

  } catch (error) {
    // Server-side error
    console.error("[API] Server error:", error instanceof Error ? error.message : "Unknown error")
    
    return NextResponse.json({
      error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}`,
      message: "I apologize, but I'm experiencing technical difficulties. Please try again shortly.",
      success: false,
    }, { status: 500 })
  }
}

// Add the normalizeWhatsApp function from repo code
function normalizeWhatsApp(raw: unknown): string {
  if (!raw) return ""
  let n = String(raw).trim()
  if (n.toLowerCase().startsWith("whatsapp:")) n = n.slice(9)
  n = n.replace(/[^+\d]/g, "")
  if (!n.startsWith("+")) n = `+${n}`
  return `whatsapp:${n}`
}