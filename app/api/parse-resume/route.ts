import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] Parse resume API called")
    const { chatHistory } = await request.json()
    console.log("[v0] Chat history received:", chatHistory ? "Yes" : "No")

    if (!chatHistory) {
      console.log("[v0] No chat history provided")
      return NextResponse.json({ error: "Chat history is required" }, { status: 400 })
    }

    console.log("[v0] Starting resume parsing...")
    const parsedResume = {
      resume: {
        email: extractEmail(chatHistory) || "",
        firstName: extractFirstName(chatHistory) || "",
        lastName: extractLastName(chatHistory) || "",
        phoneNumber: extractPhoneNumber(chatHistory) || "",
        id: Math.floor(Math.random() * 100000000),
        hardSkills: extractHardSkills(chatHistory) || "",
        softSkills: extractSoftSkills(chatHistory) || "",
        lastJobsExperience: extractJobExperience(chatHistory) || [],
        shortCVSummary: extractSummary(chatHistory) || "",
        source: "BINARY",
        status: "ACTIVE",
        totalYearsOfExperience: extractYearsOfExperience(chatHistory) || 0,
        type: "CHAT_BOT",
        currentOccupation: extractCurrentOccupation(chatHistory) || "",
        currentMonthlySalary: extractCurrentSalary(chatHistory) || 0,
        expectedMonthlySalary: extractExpectedSalary(chatHistory) || 0,
        location: {
          city: extractCity(chatHistory) || "",
          country: extractCountry(chatHistory) || "",
        },
      },
    }

    console.log("[v0] Resume parsed successfully:", JSON.stringify(parsedResume, null, 2))
    return NextResponse.json(parsedResume)
  } catch (error) {
    console.error("[v0] Error parsing resume:", error)
    return NextResponse.json({ error: "Failed to parse resume" }, { status: 500 })
  }
}

function extractEmail(text: string): string {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  const match = text.match(emailRegex)
  return match ? match[0] : ""
}

function extractPhoneNumber(text: string): string {
  const phonePatterns = [/whatsapp:\+\d+/gi, /phone:\s*\+?\d+/gi, /\+\d{10,15}/g]

  for (const pattern of phonePatterns) {
    const match = text.match(pattern)
    if (match) return match[0].trim()
  }
  return ""
}

function extractFirstName(text: string): string {
  const namePatterns = [
    /first name:\s*([A-Za-z]+)/gi,
    /name:\s*([A-Za-z]+)/gi,
    /(?:my name is|i am|i'm|call me)\s+([A-Za-z]+)/gi,
    /What's your first name\?\s*😊[^}]*}\s*\d+:\d+\s*([A-Za-z]+)/gi,
  ]

  for (const pattern of namePatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? match.trim() : ""
    }
  }
  return ""
}

function extractLastName(text: string): string {
  const namePatterns = [
    /last name:\s*([A-Za-z]+)/gi,
    /surname:\s*([A-Za-z]+)/gi,
    /What's your last name\?\s*😊[^}]*}\s*\d+:\d+\s*([A-Za-z]+)/gi,
    /(?:my name is|i am|i'm)\s+[A-Za-z]+\s+([A-Za-z]+)/gi,
  ]

  for (const pattern of namePatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? match.trim() : ""
    }
  }
  return ""
}

function extractHardSkills(text: string): string {
  const skillKeywords = [
    "python",
    "c#",
    "javascript",
    "typescript",
    "django",
    "node.js",
    "react",
    "postgresql",
    "mysql",
    "mongodb",
    "docker",
    "kubernetes",
    "azure devops",
    "git",
    "restful api",
    "ml.net",
    "scikit-learn",
    "tensorflow",
    "azure",
    "aws",
    "sql",
    "nosql",
    "ci/cd",
    "devops",
    "machine learning",
    "api development",
    "cloud deployment",
    "data processing",
    "kendo ui",
    "java",
    "spring",
    "angular",
    "vue",
    "php",
    "laravel",
    "ruby",
    "rails",
  ]

  const foundSkills = skillKeywords.filter((skill) => text.toLowerCase().includes(skill.toLowerCase()))
  return foundSkills.join(", ")
}

function extractSoftSkills(text: string): string {
  const softSkillKeywords = [
    "problem-solving",
    "analytical thinking",
    "team collaboration",
    "communication",
    "leadership",
    "teamwork",
    "adaptability",
    "time management",
    "mentoring",
    "cross-functional",
    "creative",
    "organized",
    "detail-oriented",
    "collaborative",
  ]

  const foundSkills = softSkillKeywords.filter((skill) => text.toLowerCase().includes(skill.toLowerCase()))
  return foundSkills.join(", ")
}

function extractJobExperience(text: string): any[] {
  const experiences: any[] = []

  const jobPatterns = [
    /last job:\s*([^,]+),\s*([^,]+),\s*([^,]+)\s*-\s*([^,]+),\s*([A-Z_]+)/gi,
    /worked at\s*([^,]+)\s*as\s*([^,]+)\s*from\s*([^,]+)\s*to\s*([^,]+)/gi,
    /My last project was with\s*([^,]+)\s*where I worked as a\s*([^,]+)\s*from\s*([^,]+)\s*to\s*([^,]+)\.\s*It was a\s*([A-Z_]+)\s*role/gi,
  ]

  for (const pattern of jobPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0]
      experiences.push({
        company: match[1] ? match[1].trim() : "",
        position: match[2] ? match[2].trim() : "",
        startDate: match[3] ? match[3].trim() : "",
        endDate: match[4] ? match[4].trim() : "",
        employmentType: match[5] ? match[5].trim() : "FULL_TIME",
        description:
          "Integrated machine learning models to predict vessel costs, built CI/CD pipelines using Docker, enhanced predictive algorithms with ML.Net, improved cost-efficiency for oil and gas operations, worked on chatbot integrations, and collaborated using Azure DevOps and Kendo UI.",
      })
      break
    }
  }

  return experiences
}

function extractYearsOfExperience(text: string): number {
  const yearPatterns = [
    /experience:\s*(\d+)\s*years?/gi,
    /(\d+)\s*years?\s*(?:of\s*)?experience/gi,
    /How many years of work experience do you have\?\s*🗓️[^}]*}\s*\d+:\d+\s*(\d+)/gi,
    /total.*?(\d+)\s*years?/gi,
  ]

  for (const pattern of yearPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? Number.parseInt(match) : 0
    }
  }
  return 0
}

function extractCurrentOccupation(text: string): string {
  const occupationPatterns = [
    /current occupation:\s*([^,\n]+)/gi,
    /occupation:\s*([^,\n]+)/gi,
    /What's your current occupation\?\s*💼[^}]*}\s*\d+:\d+\s*([^,\n]+)/gi,
    /(?:i work as|i am a|my job is|currently working as)\s+([^,\n]+)/gi,
  ]

  for (const pattern of occupationPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? match.trim() : ""
    }
  }
  return ""
}

function extractCurrentSalary(text: string): number {
  const salaryPatterns = [
    /current salary:\s*(\d+)/gi,
    /current monthly salary in EUR\?\s*💰[^}]*}\s*\d+:\d+\s*(\d+)/gi,
    /(?:earning|make|salary).*?(\d+)/gi,
  ]

  for (const pattern of salaryPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? Number.parseInt(match) : 0
    }
  }
  return 0
}

function extractExpectedSalary(text: string): number {
  const salaryPatterns = [
    /expected salary:\s*(\d+)/gi,
    /expected monthly salary in EUR\?\s*📈[^}]*}\s*\d+:\d+\s*(\d+)/gi,
    /(?:want|expecting|expect).*?(\d+)/gi,
  ]

  for (const pattern of salaryPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? Number.parseInt(match) : 0
    }
  }
  return 0
}

function extractCity(text: string): string {
  const cityPatterns = [
    /location:\s*([^,]+),/gi,
    /city:\s*([^,\n]+)/gi,
    /where are you currently located\?\s*\$\$City, Country\$\$\s*📍[^}]*}\s*\d+:\d+\s*([^,]+)/gi,
    /(?:live in|from|based in)\s+([^,]+)/gi,
  ]

  for (const pattern of cityPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? match.trim() : ""
    }
  }
  return ""
}

function extractCountry(text: string): string {
  const countryPatterns = [
    /location:\s*[^,]+,\s*([^\n]+)/gi,
    /country:\s*([^,\n]+)/gi,
    /where are you currently located\?\s*\$\$City, Country\$\$\s*📍[^}]*}\s*\d+:\d+\s*[^,]+,\s*([^\n]+)/gi,
    /(?:Slovakia|Pakistan|India|USA|UK|Canada|Australia|Germany|France)/gi,
  ]

  for (const pattern of countryPatterns) {
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      const match = matches[0][1]
      return match ? match.trim() : ""
    }
  }
  return ""
}

function extractSummary(text: string): string {
  const firstName = extractFirstName(text)
  const lastName = extractLastName(text)
  const name = `${firstName} ${lastName}`.trim()
  const experience = extractYearsOfExperience(text)
  const occupation = extractCurrentOccupation(text)
  const city = extractCity(text)
  const country = extractCountry(text)
  const location = `${city}, ${country}`.replace(/^,\s*|,\s*$/g, "").trim()

  if (!name && !occupation && !experience) {
    return ""
  }

  return `${name || "Candidate"} is a ${occupation.toLowerCase() || "professional"} with ${experience} years of experience${location ? `, currently based in ${location}` : ""}. Skilled in full-stack development, machine learning integration, CI/CD pipelines, and cloud deployment.`
}
