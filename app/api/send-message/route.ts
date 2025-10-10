import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const userMessage = data.message || ""

    if (!userMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    console.log("[v0] Processing message:", userMessage)

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
        from: "whatsapp:+923346250250",
      },
    }

    const webhookUrl = "https://surikado.hellodexter.com/webhook/130bb4fe-11e5-4442-9a63-a68de302e144"

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 200) {
        const contentType = response.headers.get("content-type")
        let result

        if (contentType && contentType.includes("application/json")) {
          result = await response.json()
          if (result.output !== undefined) {
            return NextResponse.json({ message: result.output })
          }
          if (result.message !== undefined) {
            return NextResponse.json({ message: result.message })
          }
          // If no specific field, return the whole result as message
          return NextResponse.json({ message: JSON.stringify(result) })
        } else {
          const textResponse = await response.text()
          return NextResponse.json({ message: textResponse })
        }
      } else {
        const contentType = response.headers.get("content-type")
        let errorMessage

        if (contentType && contentType.includes("application/json")) {
          try {
            const errorData = await response.json()
            errorMessage = errorData.message || errorData.error || "Unknown error"
          } catch {
            errorMessage = await response.text()
          }
        } else {
          errorMessage = await response.text()
        }

        console.log("[v0] Webhook failed with status:", response.status, "Error:", errorMessage)
        return NextResponse.json({
          error: "Webhook request failed",
          status: response.status,
          message: errorMessage,
        })
      }
    } catch (networkError) {
      console.log("[v0] Network error:", networkError instanceof Error ? networkError.message : "Unknown error")

      return NextResponse.json({
        message: `Echo: ${userMessage}`,
      })
    }
  } catch (error) {
    console.error("[v0] Server error:", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({
      error: `Server error: ${error instanceof Error ? error.message : "Unknown error"}`,
    })
  }
}
