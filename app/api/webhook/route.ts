import { type NextRequest, NextResponse } from "next/server"

// In-memory storage (in production, use a database)
const messages: Array<{
  id: string
  type: "user" | "system"
  content: string
  timestamp: Date
}> = []

let parsedResume: any = null

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Extract message from Twilio webhook payload
    const messageBody = body.data?.body
    const from = body.data?.from

    if (!messageBody) {
      return NextResponse.json({ error: "No message body found" }, { status: 400 })
    }

    const externalApiResponse = await sendToExternalAPI(messageBody, body)

    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content: messageBody,
      timestamp: new Date(),
    }

    messages.push(userMessage)

    if (externalApiResponse) {
      const apiResponseMessage = {
        id: (Date.now() + 1).toString(),
        type: "system" as const,
        content: `API Response: ${JSON.stringify(externalApiResponse, null, 2)}`,
        timestamp: new Date(),
      }
      messages.push(apiResponseMessage)
    }

    // Parse the message into resume format
    const resume = await parseMessageToResume(messageBody, from)

    if (resume) {
      parsedResume = resume

      // Add system response
      const systemMessage = {
        id: (Date.now() + 2).toString(),
        type: "system" as const,
        content: 'Resume data parsed successfully! Click "Parse Data" to view details.',
        timestamp: new Date(),
      }

      messages.push(systemMessage)
    }

    return NextResponse.json({
      success: true,
      messageReceived: messageBody,
      externalApiResponse: externalApiResponse,
      resume: resume,
    })
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

async function sendToExternalAPI(userMessage: string, originalWebhookData: any) {
  try {
    const apiPayload = {
      specversion: "1.0",
      type: "com.twilio.messaging.inbound-message.received",
      source: "/some-path",
      id: "EZ-random-id",
      dataschema: "https://events-schemas.twilio.com/Messaging.InboundMessageV1/5",
      datacontenttype: "application/json",
      time: new Date().toISOString(),
      data: {
        numMedia: originalWebhookData.data?.numMedia || 0,
        timestamp: new Date().toISOString(),
        recipients: originalWebhookData.data?.recipients || [],
        accountSid: originalWebhookData.data?.accountSid || "ACxxxx",
        messagingServiceSid: originalWebhookData.data?.messagingServiceSid || "MGxxxx",
        to: originalWebhookData.data?.to || "whatsapp:+16098034599",
        numSegments: originalWebhookData.data?.numSegments || 1,
        messageSid: originalWebhookData.data?.messageSid || "SMxxxx",
        eventName: "com.twilio.messaging.inbound-message.received",
        body: userMessage, // User's message goes here
        from: originalWebhookData.data?.from || "whatsapp:+60666388495",
      },
    }

    console.log("[v0] Sending to external API:", apiPayload)

    const response = await fetch(
      "http://surikado.hellodexter.com:5678/webhook-test/130bb4fe-11e5-4442-9a63-a68de302e144",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiPayload),
      },
    )

    if (!response.ok) {
      console.error("[v0] External API error:", response.status, response.statusText)
      return { error: `API returned ${response.status}: ${response.statusText}` }
    }

    const responseData = await response.text()
    console.log("[v0] External API response:", responseData)

    // Try to parse as JSON, fallback to text
    try {
      return JSON.parse(responseData)
    } catch {
      return { response: responseData }
    }
  } catch (error) {
    console.error("[v0] Error calling external API:", error)
    return { error: `Failed to call external API: ${error.message}` }
  }
}

async function parseMessageToResume(message: string, from?: string) {
  // Mock parsing logic - in production, integrate with AI service
  // This is a simplified example that extracts basic info

  const resume = {
    email: extractEmail(message) || "user@example.com",
    firstName: extractFirstName(message) || "John",
    lastName: extractLastName(message) || "Doe",
    phoneNumber: from || "whatsapp:+1234567890",
    hardSkills: extractSkills(message) || "Communication, Problem-solving, Teamwork",
    softSkills: "Adaptability, Leadership, Time management",
    shortCVSummary: message.length > 100 ? message.substring(0, 100) + "..." : message,
    currentOccupation: extractOccupation(message) || "Professional",
    currentMonthlySalary: extractSalary(message) || 3000,
    expectedMonthlySalary: (extractSalary(message) || 3000) * 1.3,
    totalYearsOfExperience: extractExperience(message) || 2,
    lastJobsExperience: [
      {
        companyName: "Previous Company",
        role: extractOccupation(message) || "Professional",
        employmentType: "FULL_TIME",
        startDate: "January 2023",
        endDate: "Present",
        description: "Professional experience in the field",
      },
    ],
    status: "ACTIVE",
    type: "CHAT_BOT",
    source: "BINARY",
    id: Math.floor(Math.random() * 10000000),
    location: {
      city: "Unknown",
      country: "Unknown",
    },
  }

  return resume
}

function extractEmail(text: string): string | null {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/
  const match = text.match(emailRegex)
  return match ? match[0] : null
}

function extractFirstName(text: string): string | null {
  const nameRegex = /(?:my name is|i'm|i am)\s+([A-Za-z]+)/i
  const match = text.match(nameRegex)
  return match ? match[1] : null
}

function extractLastName(text: string): string | null {
  const nameRegex = /(?:my name is|i'm|i am)\s+[A-Za-z]+\s+([A-Za-z]+)/i
  const match = text.match(nameRegex)
  return match ? match[1] : null
}

function extractSkills(text: string): string | null {
  const skillKeywords = ["skill", "experience", "proficient", "expert", "knowledge"]
  for (const keyword of skillKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      return text.substring(text.toLowerCase().indexOf(keyword), text.toLowerCase().indexOf(keyword) + 50)
    }
  }
  return null
}

function extractOccupation(text: string): string | null {
  const jobRegex = /(?:work as|job as|i'm a|i am a)\s+([A-Za-z\s]+)/i
  const match = text.match(jobRegex)
  return match ? match[1].trim() : null
}

function extractSalary(text: string): number | null {
  const salaryRegex = /\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/
  const match = text.match(salaryRegex)
  return match ? Number.parseInt(match[1].replace(",", "")) : null
}

function extractExperience(text: string): number | null {
  const expRegex = /(\d+)\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp)/i
  const match = text.match(expRegex)
  return match ? Number.parseInt(match[1]) : null
}

// Export messages for the messages endpoint
export { messages, parsedResume }
