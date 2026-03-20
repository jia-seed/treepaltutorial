"use server"

import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"

// More robust API key handling
const getOpenAIKey = () => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set in environment variables")
    return null
  }
  return apiKey
}

// Mock analysis function for when API key is not available
async function mockAnalysis(url: string) {
  const validUrl = url.startsWith("http") ? url : `https://${url}`

  // Try to fetch the website to at least validate the URL
  try {
    const response = await fetchWithTimeout(
      validUrl,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TermsAnalyzer/1.0)",
        },
      },
      10000,
    )

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch website: ${response.status} ${response.statusText}`,
      }
    }

    // Return mock data for demonstration purposes
    return {
      success: true,
      data: {
        url: validUrl,
        content:
          "This is a mock analysis because the OpenAI API key is not configured. In a real scenario, this would contain the actual Terms of Service content.",
        summary:
          "This is a demonstration mode. The application is working correctly, but the OpenAI API key is not configured. Please add your OpenAI API key to the environment variables to enable full functionality.",
      },
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to access the website: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// Helper function to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 10000): Promise<Response> {
  // Validate URL before attempting to fetch
  try {
    new URL(url) // This will throw if the URL is invalid
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`)
  }

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(id)
    return response
  } catch (error) {
    clearTimeout(id)
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout}ms: ${url}`)
      }
    }
    throw error
  }
}

// List of user agents to try if the first one fails
const USER_AGENTS = [
  "Mozilla/5.0 (compatible; TermsAnalyzer/1.0)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
]

// Enhanced link extraction for specific websites
function getKnownTermsLinks(domain: string): { terms?: string; privacy?: string } {
  const knownSites: Record<string, { terms?: string; privacy?: string }> = {
    "supabase.com": {
      terms: "https://supabase.com/terms",
      privacy: "https://supabase.com/privacy",
    },
    "vercel.com": {
      terms: "https://vercel.com/legal/terms",
      privacy: "https://vercel.com/legal/privacy-policy",
    },
    "github.com": {
      terms: "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service",
      privacy: "https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement",
    },
    "facebook.com": {
      terms: "https://www.facebook.com/terms.php",
      privacy: "https://www.facebook.com/privacy/policy/",
    },
    "twitter.com": {
      terms: "https://twitter.com/tos",
      privacy: "https://twitter.com/privacy",
    },
    "google.com": {
      terms: "https://policies.google.com/terms",
      privacy: "https://policies.google.com/privacy",
    },
    "cognition.ai": {
      terms: "https://cognition.ai/pages/terms-of-service",
      privacy: "https://cognition.ai/pages/privacy-policy",
    },
  }

  // Check if the domain matches any of our known sites
  for (const [siteDomain, links] of Object.entries(knownSites)) {
    if (domain.includes(siteDomain)) {
      return links
    }
  }

  return {}
}

export async function analyzeWebsite(url: string) {
  try {
    // Check for OpenAI API key
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      // If no API key, use a mock analysis for demonstration
      return mockAnalysis(url)
    }

    // Validate URL
    let validUrl = url
    if (!url.startsWith("http")) {
      validUrl = `https://${url}`
    }

    // Try to validate the URL
    try {
      new URL(validUrl)
    } catch (error) {
      return {
        success: false,
        error: `Invalid URL: ${validUrl}. Please enter a valid website address.`,
      }
    }

    // Extract domain for known site checking
    const urlObj = new URL(validUrl)
    const domain = urlObj.hostname

    // Initialize variables for content and link tracking
    let tosContent = null
    let usedLink = ""
    const fetchErrors = []

    // Check for known terms links
    const knownLinks = getKnownTermsLinks(domain)

    // If we have known links, try them first
    if (knownLinks.terms || knownLinks.privacy) {
      console.log("Found known Terms/Privacy links for this domain")

      // Try Terms of Service first
      if (knownLinks.terms) {
        try {
          console.log("Trying known Terms link:", knownLinks.terms)
          const content = await fetchTosContent(knownLinks.terms)

          if (content && content.length > 500) {
            console.log("Successfully fetched content from known Terms link")
            tosContent = content
            usedLink = knownLinks.terms
          }
        } catch (error) {
          console.error("Error fetching from known Terms link:", error)
        }
      }

      // If Terms failed, try Privacy Policy
      if (!tosContent && knownLinks.privacy) {
        try {
          console.log("Trying known Privacy link:", knownLinks.privacy)
          const content = await fetchTosContent(knownLinks.privacy)

          if (content && content.length > 500) {
            console.log("Successfully fetched content from known Privacy link")
            tosContent = content
            usedLink = knownLinks.privacy
          }
        } catch (error) {
          console.error("Error fetching from known Privacy link:", error)
        }
      }

      // If we got content from known links, generate summary and return
      if (tosContent) {
        const summary = await generateTosSummary(tosContent)
        return {
          success: true,
          data: {
            url: usedLink,
            content: tosContent,
            summary: summary,
          },
        }
      }
    }

    // Check if the URL might already be a direct link to a Terms of Service page
    const isLikelyTosPage = checkIfLikelyTosUrl(validUrl)

    // If it looks like a ToS page, try to fetch it directly first
    if (isLikelyTosPage) {
      console.log("URL appears to be a direct ToS link, trying it first")
      try {
        const directContent = await fetchTosContent(validUrl)
        if (directContent && directContent.length > 500) {
          console.log("Successfully fetched content from direct ToS link")
          const summary = await generateTosSummary(directContent)
          return {
            success: true,
            data: {
              url: validUrl,
              content: directContent,
              summary: summary,
            },
          }
        }
      } catch (error) {
        console.error("Error fetching from direct ToS link:", error)
        // Continue with normal flow if direct fetch fails
      }
    }

    // Fetch the website content
    console.log("Fetching main page:", validUrl)
    let mainPageHtml = ""
    let mainPageContent = ""

    try {
      // Try multiple user agents if needed
      let response = null
      let fetchError = null

      for (const userAgent of USER_AGENTS) {
        try {
          response = await fetchWithTimeout(
            validUrl,
            {
              headers: {
                "User-Agent": userAgent,
              },
            },
            15000,
          )

          if (response.ok) {
            break // Successfully fetched the content
          }
        } catch (error) {
          fetchError = error
          console.warn(`Fetch attempt failed with user agent "${userAgent}":`, error)
          // Continue to the next user agent
        }
      }

      if (!response || !response.ok) {
        return {
          success: false,
          error: `Failed to fetch website: ${fetchError ? fetchError.message : "Unknown error"}`,
        }
      }

      mainPageHtml = await response.text()
      mainPageContent = extractTextContent(mainPageHtml)
    } catch (error) {
      return {
        success: false,
        error: `Failed to access the website: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Extract potential Terms of Service links by analyzing the link text and href
    const tosLinks = extractTosLinksByText(mainPageHtml, validUrl)
    console.log("Found ToS links by text analysis:", tosLinks)

    // If no links found by text analysis, fall back to URL pattern matching
    const allTosLinks = tosLinks.length > 0 ? tosLinks : extractTosLinks(mainPageHtml, validUrl)
    console.log("All potential ToS links:", allTosLinks)

    // Try to get content from ToS links
    if (allTosLinks.length > 0) {
      // Try each link until we find one with good content
      for (const link of allTosLinks) {
        try {
          console.log("Trying ToS link:", link)
          const content = await fetchTosContent(link)

          if (content && content.length > 500) {
            console.log("Found valid ToS content with length:", content.length)
            tosContent = content
            usedLink = link
            break
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.error(`Error fetching content from ${link}:`, errorMessage)
          fetchErrors.push(`${link}: ${errorMessage}`)
          // Continue to the next link
        }
      }
    }

    // If we couldn't get content from ToS links, check if the main page might contain ToS
    if (!tosContent && mainPageContent.length > 1000) {
      console.log("No ToS links found or no valid content in links, analyzing main page")

      // Check if the main page contains terms-related keywords
      const termsKeywords = [
        "terms of service",
        "terms and conditions",
        "user agreement",
        "privacy policy",
        "data policy",
        "legal agreement",
      ]

      const containsTermsKeywords = termsKeywords.some((keyword) =>
        mainPageContent.toLowerCase().includes(keyword.toLowerCase()),
      )

      if (containsTermsKeywords) {
        console.log("Main page contains terms-related keywords")
        tosContent = mainPageContent
        usedLink = validUrl
      }
    }

    // If we still don't have content, try to use AI to extract relevant parts from the main page
    if (!tosContent && mainPageContent.length > 1000) {
      console.log("Using AI to extract relevant content from main page")

      try {
        const { text: contentAnalysis } = await generateText({
          model: openai("gpt-4o"),
          prompt: `
              Analyze the following text from ${validUrl} and determine if it contains Terms of Service, 
              Privacy Policy, or similar legal content. If it does, extract only the relevant legal sections.
              If it doesn't contain any legal content, respond with "NO_LEGAL_CONTENT".
              
              Text to analyze:
              ${mainPageContent.substring(0, 8000)}
            `,
        })

        if (contentAnalysis && !contentAnalysis.includes("NO_LEGAL_CONTENT")) {
          console.log("AI identified legal content in the main page")
          tosContent = contentAnalysis
          usedLink = validUrl
        }
      } catch (error) {
        console.error("Error using AI to extract content:", error)
      }
    }

    // If we still don't have content, return an error with helpful information
    if (!tosContent) {
      let errorMessage =
        "Could not find Terms of Service content. Try providing a direct link to the Terms of Service page."

      // Add more detailed error information if available
      if (fetchErrors.length > 0) {
        errorMessage += ` Attempted to fetch ${fetchErrors.length} potential ToS links but encountered errors.`
      }

      return {
        success: false,
        error: errorMessage,
      }
    }

    // Generate a summary of the ToS
    const summary = await generateTosSummary(tosContent)

    // Return the analysis data to the client
    return {
      success: true,
      data: {
        url: usedLink || validUrl,
        content: tosContent,
        summary: summary,
      },
    }
  } catch (error) {
    console.error("Error analyzing website:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred while analyzing the website",
    }
  }
}

export async function askAboutTerms(
  question: string,
  analysisResult: { url: string; content: string; summary: string },
) {
  try {
    // Check for OpenAI API key
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      return {
        message:
          "I'm in demonstration mode because the OpenAI API key is not configured. In a real scenario, I would analyze the Terms of Service and answer your specific question. Please add your OpenAI API key to enable full functionality.",
      }
    }

    // system prompt 
    const { text } = await generateText({
      model: openai("gpt-4o"),
      system:
        "You are a helpful expert in interpreting Terms of Service and privacy policies. Your goal is to help users understand how websites use their data in simple, clear language. When information is explicitly stated in the Terms, provide that information accurately. When information isn't explicitly stated, provide a helpful response based on industry standards and reasonable inferences, clearly indicating when you're making an inference. Always aim to give users useful information that helps them understand their rights and the implications of the Terms. Focus on being helpful rather than overly cautious. Also you don't use words in bold lettering and don't use asterisks",
      prompt: `
          Based on the following Terms of Service content from ${analysisResult.url}:
          
          ${analysisResult.content.substring(0, 8000)}
          
          Answer this question: ${question}
          
          If the information is not explicitly stated in the Terms of Service, you can make reasonable inferences based on industry standards and similar services, but indicate that you're doing so. Always try to provide a helpful answer rather than simply stating the information is not available.
        `,
    })

    return { message: text }
  } catch (error) {
    console.error("Error asking about terms:", error)
    return {
      message:
        error instanceof Error
          ? `Error: ${error.message}`
          : "Sorry, I encountered an error while processing your question. Please try again.",
    }
  }
}

// Add this new function after the askAboutTerms function

export async function generateSuggestedQuestions(content: string): Promise<string[]> {
  try {
    // Check for OpenAI API key
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      // Return default questions if no API key
      return [
        "How is my personal data used?",
        "Can I delete my account?",
        "How do they share my information?",
        "What rights do I have?",
        "How can I opt out of data collection?",
      ]
    }

    // Use AI to generate relevant questions based on the content
    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt: `
          Based on the following Terms of Service content:
          
          ${content.substring(0, 5000)}
          
          Generate 5 specific, relevant questions that a user might want to ask about these terms.
          Focus on privacy, data usage, user rights, and important policies.
          
          IMPORTANT: Return ONLY a plain JSON array of strings with no markdown formatting, no code blocks, and no additional text.
          Example: ["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]
        `,
    })

    // Clean the response to handle potential markdown formatting
    let cleanedResponse = text.trim()

    // Remove markdown code block syntax if present
    if (cleanedResponse.includes("```")) {
      cleanedResponse = cleanedResponse
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim()
    }

    try {
      // Try to parse the cleaned response as JSON
      const questions = JSON.parse(cleanedResponse)
      if (Array.isArray(questions) && questions.length > 0) {
        return questions.slice(0, 5) // Limit to 5 questions
      }
    } catch (e) {
      console.error("Failed to parse questions JSON:", e, "Raw response:", cleanedResponse)

      // More robust fallback: try to extract questions directly from text
      const extractedQuestions = cleanedResponse
        .split(/\n/)
        .map((line) => {
          // Remove list markers, quotes and other non-question text
          return line.replace(/^["\s\d.[\]\-*]+|["\s,\][]+$/g, "").trim()
        })
        .filter((line) => line.endsWith("?") && line.length > 10)
        .slice(0, 5)

      if (extractedQuestions.length > 0) {
        return extractedQuestions
      }
    }

    // Fallback to default questions
    return [
      "How is my personal data used?",
      "Can I delete my account?",
      "How do they share my information?",
      "What rights do I have?",
      "How can I opt out of data collection?",
    ]
  } catch (error) {
    console.error("Error generating suggested questions:", error)
    // Return default questions if there's an error
    return [
      "How is my personal data used?",
      "Can I delete my account?",
      "How do they share my information?",
      "What rights do I have?",
      "How can I opt out of data collection?",
    ]
  }
}

async function generateTosSummary(content: string): Promise<string> {
  try {
    // Check for OpenAI API key
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      return "This is a demonstration mode. The application is working correctly, but the OpenAI API key is not configured. Please add your OpenAI API key to the environment variables to enable full functionality."
    }

    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt: `
          Summarize the following Terms of Service content in a clear, concise way, 
          focusing on how user data is collected, used, and shared:
          
          ${content.substring(0, 8000)}
        `,
    })

    return text
  } catch (error) {
    console.error("Error generating ToS summary:", error)
    return "Failed to generate summary. Please check your OpenAI API key configuration."
  }
}

// Check if a URL is likely a direct link to a Terms of Service page
function checkIfLikelyTosUrl(url: string): boolean {
  const tosKeywords = [
    "terms",
    "tos",
    "terms-of-service",
    "terms-and-conditions",
    "legal",
    "user-agreement",
    "privacy",
    "privacy-policy",
    "data-policy",
    "data-protection",
    "legal",
    "disclaimer",
    "eula",
    "agreement",
  ]

  const lowerUrl = url.toLowerCase()
  return tosKeywords.some((keyword) => lowerUrl.includes(keyword))
}

// New function to extract links by analyzing the link text content
function extractTosLinksByText(html: string, baseUrl: string): string[] {
  const links: string[] = []

  try {
    // Look for links with text content containing terms-related keywords
    const linkTextPatterns = [
      /<a\s+[^>]*>(.*?terms\s+of\s+service.*?)<\/a>/gi,
      /<a\s+[^>]*>(.*?terms.*?)<\/a>/gi,
      /<a\s+[^>]*>(.*?privacy\s+policy.*?)<\/a>/gi,
      /<a\s+[^>]*>(.*?legal.*?)<\/a>/gi,
    ]

    for (const pattern of linkTextPatterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        // Extract the href from the matched <a> tag
        const hrefMatch = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/i.exec(match[0])
        if (hrefMatch && hrefMatch[1]) {
          try {
            // Handle relative URLs
            let fullUrl = hrefMatch[1]
            if (fullUrl.startsWith("/")) {
              // Convert relative URL to absolute
              const urlObj = new URL(baseUrl)
              fullUrl = `${urlObj.protocol}//${urlObj.host}${fullUrl}`
            } else if (!fullUrl.startsWith("http")) {
              // Handle other relative formats
              fullUrl = new URL(fullUrl, baseUrl).href
            }

            links.push(fullUrl)
          } catch (e) {
            console.error("Error resolving URL:", hrefMatch[1], e)
          }
        }
      }
    }

    // Remove duplicates
    return [...new Set(links)].filter((link) => link.startsWith("http"))
  } catch (error) {
    console.error("Error extracting links by text:", error)
    return []
  }
}

// Simplified helper functions using regex only
function extractTosLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []

  // Regex patterns for Terms of Service links
  const tosPatterns = [
    /href=["'](.*?(?:terms|tos|terms-of-service|terms-and-conditions|legal|user-agreement).*?)["']/gi,
    /href=["'](.*?(?:privacy|privacy-policy|data-policy|data-protection).*?)["']/gi,
    /href=["'](.*?(?:legal|disclaimer|eula|agreement).*?)["']/gi,
  ]

  for (const pattern of tosPatterns) {
    let match
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) {
        try {
          // Handle relative URLs
          let fullUrl = match[1]
          if (fullUrl.startsWith("/")) {
            // Convert relative URL to absolute
            const urlObj = new URL(baseUrl)
            fullUrl = `${urlObj.protocol}//${urlObj.host}${fullUrl}`
          } else if (!fullUrl.startsWith("http")) {
            // Handle other relative formats
            fullUrl = new URL(fullUrl, baseUrl).href
          }

          links.push(fullUrl)
        } catch (e) {
          console.error("Error resolving URL:", match[1], e)
        }
      }
    }
  }

  // Remove duplicates and filter out non-HTTP links
  return [...new Set(links)].filter((link) => link.startsWith("http"))
}

async function fetchTosContent(url: string): Promise<string | null> {
  // Try multiple user agents if needed
  for (const userAgent of USER_AGENTS) {
    try {
      console.log(`Fetching content from: ${url} with User-Agent: ${userAgent}`)

      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            "User-Agent": userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
        15000,
      )

      if (!response.ok) {
        console.warn(`Failed to fetch with status: ${response.status} ${response.statusText}`)
        continue // Try next user agent
      }

      const html = await response.text()

      try {
        const extractedContent = extractTextContent(html)
        if (extractedContent && extractedContent.length > 100) {
          return extractedContent
        } else {
          console.warn("Extracted content too short, trying next user agent")
        }
      } catch (extractError) {
        console.error(`Error extracting content from HTML: ${extractError}`)
        continue // Try next user agent
      }
    } catch (error) {
      console.error(`Error fetching ToS content with User-Agent ${userAgent}:`, error)
      // Continue to the next user agent
    }
  }

  // If we've tried all user agents and none worked, return null instead of throwing
  console.error(`Failed to fetch content from ${url} after trying multiple user agents`)
  return null
}

function extractTextContent(html: string): string {
  try {
    // Check if the HTML is valid
    if (!html || typeof html !== "string" || html.length < 100) {
      return ""
    }

    // Remove scripts, styles, and other non-content elements
    const content = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, " ")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")

    // Extract text from paragraphs for better content
    const paragraphs: string[] = []
    const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gis
    let paragraphMatch

    while ((paragraphMatch = paragraphRegex.exec(content)) !== null) {
      if (paragraphMatch[1]) {
        // Remove HTML tags from paragraph content
        const paragraphText = paragraphMatch[1].replace(/<[^>]*>/g, " ")
        if (paragraphText.trim().length > 0) {
          paragraphs.push(paragraphText)
        }
      }
    }

    // If we found paragraphs, use them
    if (paragraphs.length > 0) {
      return paragraphs.join("\n\n").replace(/\s+/g, " ").trim()
    }

    // If no paragraphs, try to extract text from divs
    const divs: string[] = []
    const divRegex = /<div[^>]*>(.*?)<\/div>/gis
    let divMatch

    while ((divMatch = divRegex.exec(content)) !== null) {
      if (divMatch[1]) {
        // Remove HTML tags from div content
        const divText = divMatch[1].replace(/<[^>]*>/g, " ")
        if (divText.trim().length > 0) {
          divs.push(divText)
        }
      }
    }

    // If we found divs, use them
    if (divs.length > 0) {
      return divs.join("\n\n").replace(/\s+/g, " ").trim()
    }

    // Otherwise, fall back to removing all HTML tags
    return content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  } catch (error) {
    console.error("Error extracting text content:", error)

    // Fallback to basic cleaning if anything fails
    try {
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    } catch (fallbackError) {
      console.error("Fallback extraction failed:", fallbackError)
      return ""
    }
  }
}

