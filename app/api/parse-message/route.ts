import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()

    // Mock parsing logic - same as webhook
    const resume = {
      email: extractEmail(message) || "user@example.com",
      firstName: extractFirstName(message) || "John",
      lastName: extractLastName(message) || "Doe",
      phoneNumber: "whatsapp:+1234567890",
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

    return NextResponse.json({ resume })
  } catch (error) {
    console.error("Parse error:", error)
    return NextResponse.json({ error: "Failed to parse message" }, { status: 500 })
  }
}

// Helper functions (same as webhook)
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
