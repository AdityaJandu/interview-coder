// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { OpenAI } from "openai"
import { configHelper } from "./ConfigHelper"
import Anthropic from '@anthropic-ai/sdk';
import {
  APIProvider,
  DEFAULT_MODELS,
} from "../shared/aiModels";
import { normalizeMCQAnswer } from "../shared/textUtils";

const JSON_CLASSIFICATION_GUIDANCE = `Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output, question_type, options.
- "question_type" must be exactly one of: "mcq", "coding", or "general_coding".
  - "mcq": a multiple choice question, or any question with a fixed set of selectable answers.
  - "coding": a DSA/algorithmic coding problem (e.g. LeetCode-style) that expects a full solution with time/space complexity analysis.
  - "general_coding": any other coding-related question that is NOT a DSA/algorithm exercise - e.g. "what does this regex/code/query do", "why is this slow/broken", explaining an error or stack trace, reviewing or critiquing code, a conceptual coding question, etc. Complexity analysis does not apply here.
- "options" must be an array of the answer choices as they appear`;

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

// Shape of a successfully-read screenshot, used to narrow away nulls
// after filtering out screenshots that failed to load.
interface LoadedScreenshot {
  path: string;
  preview: string;
  data: string;
}

/**
 * Shape of the JSON the extraction step returns. `question_type` and
 * `options` let us branch between three flows right after extraction,
 * instead of always forcing every screenshot through the "write code +
 * complexity" flow regardless of what kind of question it actually is:
 *
 *  - "mcq": a multiple choice / fixed-option question -> answer only,
 *    no explanation.
 *  - "coding": a DSA/algorithmic problem -> full solution with code,
 *    thoughts, and time/space complexity analysis.
 *  - "general_coding": any other coding-related question ("what does
 *    this regex do", "why is this query slow", "explain this stack
 *    trace", "review this function", etc) -> answer the question
 *    directly, show code if the answer includes any, but don't force a
 *    complexity analysis section that wouldn't make sense here.
 */
interface ProblemInfo {
  problem_statement: string;
  constraints?: string;
  example_input?: string;
  example_output?: string;
  question_type?: "mcq" | "coding" | "general_coding";
  options?: string[];
  [key: string]: unknown;
}

/**
 * Pull the "Time complexity" / "Space complexity" section out of a model's
 * free-form response.
 *
 * The previous implementation used a single regex per label with a
 * lookahead like `\n\s*(?:Space complexity|$)` to find where the section
 * ended. That lookahead only tolerates whitespace before the next label,
 * so anything the model commonly does — numbered lists ("4. Space
 * complexity:"), markdown bold ("**Space complexity:**"), or headers
 * ("### Space complexity") — breaks the match. When the regex fails to
 * match, the caller silently keeps its hardcoded placeholder text, which
 * is why real answers were being replaced by the canned "O(n) - Linear
 * time complexity because we only iterate through the array once..."
 * example.
 *
 * This version tolerates optional bullet/number/markdown decoration
 * around the label, and stops at the *next* time/space complexity
 * heading (in either order) or the end of the string.
 */
function extractComplexitySection(
  text: string,
  label: "time" | "space"
): string | null {
  const decoration = `(?:^|\\n)[ \\t]*(?:[-*•]\\s*)?(?:\\d+[.)]\\s*)?#{0,3}\\s*\\*{0,2}`
  const labelPattern = `${label}\\s+complexity`
  const afterLabel = `\\*{0,2}:?\\*{0,2}\\s*`
  const nextHeading = `${decoration}\\*{0,2}(?:time|space)\\s+complexity`

  const pattern = new RegExp(
    `${decoration}${labelPattern}${afterLabel}([\\s\\S]*?)(?=${nextHeading}|$)`,
    "i"
  )

  const match = text.match(pattern)
  if (!match || !match[1]) return null

  // Trim whitespace and any leftover markdown/list decoration at the edges.
  return match[1].trim().replace(/^[\s*#-]+/, "").replace(/[\s*]+$/, "")
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiApiKey: string | null = null
  private anthropicClient: Anthropic | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  private formatProviderError(provider: "openai" | "gemini" | "anthropic", error: any, context: string): string {
    const status =
      typeof error?.status === "number"
        ? error.status
        : typeof error?.response?.status === "number"
          ? error.response.status
          : undefined;
    const message = error?.message || error?.response?.data?.error?.message || "Unknown error";
    const statusPart = status ? ` (status ${status})` : "";
    return `[${provider}] ${context} failed${statusPart}: ${message}`;
  }

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps

    // getScreenshotHelper() can return null if it's called before the
    // helper has been created; fail fast here so `this.screenshotHelper`
    // can keep a non-nullable type everywhere else in this class.
    const screenshotHelper = deps.getScreenshotHelper()
    if (!screenshotHelper) {
      throw new Error("ScreenshotHelper is not available")
    }
    this.screenshotHelper = screenshotHelper

    // Initialize AI client based on config
    this.initializeAIClient();

    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }

  /**
   * Get conversation context for integration with screenshot processing
   */
  private getConversationContext(): string | null {
    try {
      const conversationManager = this.deps.getConversationManager?.();
      if (conversationManager) {
        const history = conversationManager.getConversationHistory();
        return history && history.trim().length > 0 ? history : null;
      }
    } catch (error) {
      console.error('Error getting conversation context:', error);
    }
    return null;
  }

  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();

      if (config.apiProvider === "openai") {
        if (config.apiKey) {
          this.openaiClient = new OpenAI({
            apiKey: config.apiKey,
            timeout: 60000, // 60 second timeout
            maxRetries: 2   // Retry up to 2 times
          });
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.log("OpenAI client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === "gemini") {
        // Gemini client initialization
        this.openaiClient = null;
        this.anthropicClient = null;
        if (config.apiKey) {
          this.geminiApiKey = config.apiKey;
          console.log("Gemini API key set successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === "anthropic") {
        // Reset other clients
        this.openaiClient = null;
        this.geminiApiKey = null;
        if (config.apiKey) {
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Anthropic client not initialized");
        }
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.geminiApiKey = null;
      this.anthropicClient = null;
    }
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }

      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }

      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();

    // First verify we have a valid AI client
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();

      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();

      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();

      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)

      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots. A type predicate is
        // used here (rather than `.filter(Boolean)`) so TypeScript actually
        // narrows the array type from `(LoadedScreenshot | null)[]` to
        // `LoadedScreenshot[]` for everything downstream.
        const validScreenshots = screenshots.filter(
          (s): s is LoadedScreenshot => s !== null
        );

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)

      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);

        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];

        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }

              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots (same type-predicate
        // approach as above so `validScreenshots` is non-nullable).
        const validScreenshots = screenshots.filter(
          (s): s is LoadedScreenshot => s !== null
        );

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }

        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      // Step 1: Extract problem info using AI Vision API (OpenAI or Gemini)
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      let problemInfo: ProblemInfo | undefined;

      if (config.apiProvider === "openai") {
        // Verify OpenAI client
        if (!this.openaiClient) {
          this.initializeAIClient(); // Try to reinitialize

          if (!this.openaiClient) {
            return {
              success: false,
              error: "OpenAI API key not configured or invalid. Please check your settings."
            };
          }
        }

        // Get conversation context if available
        const conversationContext = this.getConversationContext();

        // Use OpenAI for processing.
        // question_type/options let us branch into one of three paths
        // right after extraction, instead of always forcing every
        // screenshot through the "write code + complexity" flow
        // regardless of what kind of question it actually is.
        const jsonFieldsInstruction = `${JSON_CLASSIFICATION_GUIDANCE} when question_type is "mcq", otherwise an empty array.
Just return the structured JSON without any other text.`;

        const systemPrompt = conversationContext
          ? `You are an assessment interpreter. Analyze the screenshot, which may be a DSA coding problem, a general coding question, or a multiple choice / short-answer question. Extract all relevant information, considering the conversation context provided. ${jsonFieldsInstruction}`
          : `You are an assessment interpreter. Analyze the screenshot, which may be a DSA coding problem, a general coding question, or a multiple choice / short-answer question. Extract all relevant information. ${jsonFieldsInstruction}`;

        const userPrompt = conversationContext
          ? `Extract the problem details from these screenshots. Consider the following conversation context:\n\n${conversationContext}\n\nReturn in JSON format. If this turns out to be a coding problem, note the preferred coding language is ${language}.`
          : `Extract the problem details from these screenshots. Return in JSON format. If this turns out to be a coding problem, note the preferred coding language is ${language}.`;

        const messages = [
          {
            role: "system" as const,
            content: systemPrompt
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: userPrompt
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        // Send to OpenAI Vision API
        const extractionResponse = await this.openaiClient.chat.completions.create({
          model: config.extractionModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        // Parse the response
        try {
          const responseText = extractionResponse.choices[0].message.content;
          // OpenAI's `content` field is typed as `string | null` - guard
          // before using it so we never call .replace on null.
          if (!responseText) {
            return {
              success: false,
              error: "OpenAI returned an empty response. Please try again."
            };
          }
          // Handle when OpenAI might wrap the JSON in markdown code blocks
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error parsing OpenAI response:", error);
          return {
            success: false,
            error: "Failed to parse problem information. Please try again or use clearer screenshots."
          };
        }
      } else if (config.apiProvider === "gemini") {
        // Use Gemini API
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          // Get conversation context if available
          const conversationContext = this.getConversationContext();

          const jsonFieldsInstruction = `${JSON_CLASSIFICATION_GUIDANCE} when question_type is "mcq", otherwise an empty array.
Just return the structured JSON without any other text.`;

          const geminiPrompt = conversationContext
            ? `You are an assessment interpreter. Analyze the screenshots, which may be a DSA coding problem, a general coding question, or a multiple choice / short-answer question. Extract all relevant information. Consider the following conversation context:\n\n${conversationContext}\n\n${jsonFieldsInstruction} If this turns out to be a coding problem, the preferred coding language is ${language}.`
            : `You are an assessment interpreter. Analyze the screenshots, which may be a DSA coding problem, a general coding question, or a multiple choice / short-answer question. Extract all relevant information. ${jsonFieldsInstruction} If this turns out to be a coding problem, the preferred coding language is ${language}.`;

          // Create Gemini message structure
          const geminiMessages: GeminiMessage[] = [
            {
              role: "user",
              parts: [
                {
                  text: geminiPrompt
                },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          // Make API request to Gemini
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.extractionModel || "gemini-3-flash-latest"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          const responseText = responseData.candidates[0].content.parts[0].text;

          // Handle when Gemini might wrap the JSON in markdown code blocks
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error using Gemini API:", error);
          return {
            success: false,
            error: this.formatProviderError("gemini", error, "Problem extraction")
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          // Get conversation context if available
          const conversationContext = this.getConversationContext();

          const jsonFieldsInstruction = `${JSON_CLASSIFICATION_GUIDANCE} when question_type is "mcq", otherwise an empty array.`;

          const anthropicPrompt = conversationContext
            ? `Extract the problem details from these screenshots, which may show a DSA coding problem, a general coding question, or a multiple choice / short-answer question. Consider the following conversation context:\n\n${conversationContext}\n\n${jsonFieldsInstruction} If this turns out to be a coding problem, the preferred coding language is ${language}.`
            : `Extract the problem details from these screenshots, which may show a DSA coding problem, a general coding question, or a multiple choice / short-answer question. ${jsonFieldsInstruction} If this turns out to be a coding problem, the preferred coding language is ${language}.`;

          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: anthropicPrompt
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: data
                  }
                }))
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.extractionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          const responseText = (response.content[0] as { type: 'text', text: string }).text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error: any) {
          console.error("Error using Anthropic API:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: this.formatProviderError("anthropic", error, "Problem extraction")
          };
        }
      }

      if (!problemInfo) {
        return {
          success: false,
          error: "Failed to extract problem information from the screenshot."
        };
      }

      // Normalize question_type in case the model returned something
      // unexpected (missing field, wrong casing, etc.) - default to
      // "coding" so existing behavior is preserved unless we have clear
      // evidence this is an MCQ or a general coding question.
      const normalizedQuestionType = String(problemInfo.question_type || "").toLowerCase().trim();
      const isMCQ = normalizedQuestionType === "mcq";
      const isGeneralCoding = normalizedQuestionType === "general_coding";

      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: isMCQ
            ? "Question analyzed. Determining the correct answer..."
            : isGeneralCoding
              ? "Question analyzed. Preparing a direct answer..."
              : "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      // Send first success event
      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Branch based on question type:
        //  - MCQs get a short, answer-only response.
        //  - General coding questions get a direct answer without a
        //    forced Code/Thoughts/Time/Space structure.
        //  - Everything else keeps the existing full DSA solution flow.
        const solutionsResult = isMCQ
          ? await this.generateMCQAnswerHelper(signal)
          : isGeneralCoding
            ? await this.generateGeneralCodingAnswerHelper(signal)
            : await this.generateSolutionsHelper(signal);

        if (solutionsResult.success) {
          // Clear any existing extra screenshots before transitioning to solutions view
          this.screenshotHelper.clearExtraScreenshotQueue();

          // Final progress update
          mainWindow.webContents.send("processing-status", {
            message: isMCQ
              ? "Answer determined"
              : isGeneralCoding
                ? "Answer generated successfully"
                : "Solution generated successfully",
            progress: 100
          });

          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
          return { success: true, data: solutionsResult.data };
        } else {
          throw new Error(
            solutionsResult.error ||
            (isMCQ
              ? "Failed to determine answer"
              : isGeneralCoding
                ? "Failed to generate answer"
                : "Failed to generate solutions")
          );
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      // If the request was cancelled, don't retry
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      const config = configHelper.loadConfig();
      const provider: APIProvider = config.apiProvider;

      // Handle OpenAI API errors specifically
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: this.formatProviderError(provider, error, "Auth")
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: this.formatProviderError(provider, error, "Rate limit / quota")
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: this.formatProviderError(provider, error, "Server error")
        };
      }

      console.error("API Error Details:", error);
      return {
        success: false,
        error: this.formatProviderError(provider, error, "Processing screenshots")
      };
    }
  }

  /**
   * MCQ path: given the already-extracted question + options, ask for
   * ONLY the correct answer - no code, no explanation, no complexity
   * analysis. Returns a payload shaped so it's compatible with the
   * existing solution data contract (code/thoughts/time_complexity/
   * space_complexity are still present but inert), plus `is_mcq` and
   * `mcq_answer` so the renderer can show a focused answer-only view.
   */
  private async generateMCQAnswerHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo() as ProblemInfo | null;
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Determining the correct answer...",
          progress: 70
        });
      }

      const optionsText = Array.isArray(problemInfo.options) && problemInfo.options.length > 0
        ? `\n\nOPTIONS:\n${problemInfo.options.join('\n')}`
        : '';

      const promptText = `This is a multiple choice question.

QUESTION:
${problemInfo.problem_statement}${optionsText}

Reply with ONLY the correct option (its letter/number and text), on a single line. Do NOT include any explanation, reasoning, preamble, or extra bullets.`;

      let responseContent: string | null | undefined;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }

        const response = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are an assessment assistant. When given a multiple choice question, respond with ONLY the correct option and nothing else - no explanation, no reasoning."
            },
            { role: "user", content: promptText }
          ],
          max_tokens: 60,
          temperature: 0
        }, { signal });

        responseContent = response.choices[0].message.content;
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: promptText }
              ]
            }
          ];

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-3-flash-latest"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 60
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for MCQ answer:", error);
          return {
            success: false,
            error: this.formatProviderError("gemini", error, "MCQ answer generation")
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: promptText }
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 60,
            messages: messages,
            temperature: 0
          }, { signal });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: unknown) {
          console.error("Error using Anthropic API for MCQ answer:", error);
          const err = error as any;
          if (err.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          }

          return {
            success: false,
            error: this.formatProviderError("anthropic", err, "MCQ answer generation")
          };
        }
      }

      if (!responseContent) {
        return {
          success: false,
          error: "No response content received from the AI provider. Please try again."
        };
      }

      // Collapse to a single clean line - this mode expects (and only
      // wants) one answer, not the multi-bullet formatting used for
      // conversational suggestions or coding solutions.
      const answer = normalizeMCQAnswer(responseContent)[0] || "";

      const formattedResponse = {
        code: "",
        thoughts: [] as string[],
        time_complexity: "N/A",
        space_complexity: "N/A",
        is_mcq: true,
        mcq_answer: answer || "Unable to determine the answer from the screenshot."
      };

      return { success: true, data: formattedResponse };
    } catch (error: unknown) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      console.error("MCQ answer generation error:", error);
      return {
        success: false,
        error: this.formatProviderError(configHelper.loadConfig().apiProvider, error, "MCQ answer generation")
      };
    }
  }

  /**
   * General coding path: for coding-related questions that aren't a
   * DSA/algorithm exercise (explain this code/regex/query, debug this
   * error, review this function, conceptual questions, etc). Unlike
   * `generateSolutionsHelper`, this does NOT force a Code/Thoughts/Time/
   * Space structure - it just answers the question directly. Code is
   * still extracted and surfaced if the answer happens to include any,
   * but time/space complexity are left as "N/A" since they don't apply
   * to most questions in this category.
   */
  private async generateGeneralCodingAnswerHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo() as ProblemInfo | null;
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Preparing a direct answer...",
          progress: 60
        });
      }

      const contextBlock = [
        problemInfo.constraints ? `ADDITIONAL CONTEXT:\n${problemInfo.constraints}` : null,
        problemInfo.example_input ? `EXAMPLE INPUT:\n${problemInfo.example_input}` : null,
        problemInfo.example_output ? `EXAMPLE OUTPUT:\n${problemInfo.example_output}` : null,
      ].filter(Boolean).join('\n\n');

      const promptText = `Answer the following coding-related question directly and completely. This is NOT a DSA/algorithm problem that needs a Big-O solution - it's a general coding question (for example: explain what some code/regex/query does, why something is slow or broken, debug an error or stack trace, review or critique code, or answer a conceptual coding question).

QUESTION:
${problemInfo.problem_statement}
${contextBlock ? `\n${contextBlock}\n` : ''}
Answer directly - give the explanation, fix, review, or whatever the question actually needs. If relevant, include a code snippet (in ${language}, or whatever language is already shown) using a markdown code block. Do NOT include a "Time complexity" or "Space complexity" section - those don't apply here unless the question specifically asks about performance.`;

      let responseContent: string | null | undefined;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }

        const response = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are an expert software engineer answering a general coding question - not a DSA/algorithm exercise. Answer directly and practically, without forcing a complexity analysis where it doesn't apply."
            },
            { role: "user", content: promptText }
          ],
          max_tokens: 4000,
          temperature: 0.2
        });

        responseContent = response.choices[0].message.content;
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: `You are an expert software engineer answering a general coding question - not a DSA/algorithm exercise. ${promptText}` }
              ]
            }
          ];

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-3-flash-latest"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for general coding answer:", error);
          return {
            success: false,
            error: this.formatProviderError("gemini", error, "General coding answer generation")
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `You are an expert software engineer answering a general coding question - not a DSA/algorithm exercise. ${promptText}`
                }
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: unknown) {
          console.error("Error using Anthropic API for general coding answer:", error);
          const err = error as any;
          if (err.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (err.status === 413 || (err.message && err.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: this.formatProviderError("anthropic", err, "General coding answer generation")
          };
        }
      }

      if (!responseContent) {
        return {
          success: false,
          error: "No response content received from the AI provider. Please try again."
        };
      }

      // Extract a code block if the answer happens to include one - unlike
      // the DSA path, we don't fall back to treating the whole response as
      // "code" when there's no fenced block, since most answers here are
      // prose (explanations, reviews, debugging notes).
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : "";

      const proseOnly = responseContent.replace(/```[\s\S]*?```/g, '');

      // Break the answer into digestible chunks for the UI: prefer bullet
      // points if the model used them, otherwise fall back to paragraphs
      // (with any code fences stripped out, since those are already
      // surfaced via `code`).
      const bulletPoints = proseOnly.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      let thoughts: string[];
      if (bulletPoints) {
        thoughts = bulletPoints
          .map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim())
          .filter(Boolean);
      } else {
        thoughts = proseOnly
          .split(/\n{2,}/)
          .map(paragraph => paragraph.trim())
          .filter(Boolean);
      }

      const formattedResponse = {
        code,
        thoughts: thoughts.length > 0 ? thoughts : [proseOnly.trim()],
        time_complexity: "N/A",
        space_complexity: "N/A",
        is_mcq: false,
        is_general_coding: true,
        general_analysis: responseContent
      };

      return { success: true, data: formattedResponse };
    } catch (error: unknown) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      console.error("General coding answer generation error:", error);
      return {
        success: false,
        error: this.formatProviderError(configHelper.loadConfig().apiProvider, error, "General coding answer generation")
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      // Create prompt for solution generation
      const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases.
`;

      let responseContent: string | null | undefined;

      if (config.apiProvider === "openai") {
        // OpenAI processing
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }

        // Send to OpenAI API
        const solutionResponse = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            { role: "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
            { role: "user", content: promptText }
          ],
          max_tokens: 4000,
          temperature: 0.2
        });

        responseContent = solutionResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini") {
        // Gemini processing
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          // Create Gemini message structure
          const geminiMessages = [
            {
              role: "user",
              parts: [
                {
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Make API request to Gemini
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-3-flash-latest"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for solution:", error);
          return {
            success: false,
            error: this.formatProviderError("gemini", error, "Solution generation")
          };
        }
      } else if (config.apiProvider === "anthropic") {
        // Anthropic processing
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Send to Anthropic API
          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for solution:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: this.formatProviderError("anthropic", error, "Solution generation")
          };
        }
      }

      // `responseContent` stays `undefined` if apiProvider matched none of
      // the branches above, and OpenAI's `message.content` is typed as
      // `string | null`. Guard once here so everything below can safely
      // treat it as a plain `string`.
      if (!responseContent) {
        return {
          success: false,
          error: "No response content received from the AI provider. Please try again."
        };
      }

      // Extract parts from the response
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;

      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];

      if (thoughtsMatch && thoughtsMatch[1]) {
        // Extract bullet points or numbered items
        const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point =>
            point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
          ).filter(Boolean);
        } else {
          // If no bullet points found, split by newlines and filter empty lines
          thoughts = thoughtsMatch[1].split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }

      // Extract complexity information. See `extractComplexitySection` for
      // why this replaced the old single-regex-with-lookahead approach:
      // that version silently fell back to the hardcoded example text
      // below whenever the model formatted its response with numbering,
      // markdown bold, or headers (i.e. almost always).
      let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
      let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";

      const extractedTime = extractComplexitySection(responseContent, "time");
      if (extractedTime) {
        timeComplexity = extractedTime;
        if (!timeComplexity.match(/O\([^)]+\)/i)) {
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.replace(notation, '').trim();
            timeComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const extractedSpace = extractComplexitySection(responseContent, "space");
      if (extractedSpace) {
        spaceComplexity = extractedSpace;
        if (!spaceComplexity.match(/O\([^)]+\)/i)) {
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.replace(notation, '').trim();
            spaceComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity,
        is_mcq: false
      };

      return { success: true, data: formattedResponse };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      if (error?.response?.status === 401) {
        return {
          success: false,
          error: this.formatProviderError(configHelper.loadConfig().apiProvider, error, "Auth")
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: this.formatProviderError(configHelper.loadConfig().apiProvider, error, "Rate limit / quota")
        };
      }

      console.error("Solution generation error:", error);
      return { success: false, error: this.formatProviderError(configHelper.loadConfig().apiProvider, error, "Solution generation") };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      let debugContent: string | null | undefined;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }

        const messages = [
          {
            role: "system" as const,
            content: `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed`
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debugResponse = await this.openaiClient.chat.completions.create({
          model: config.debuggingModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).
`;

          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: debugPrompt },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Gemini...",
              progress: 60
            });
          }

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.debuggingModel || "gemini-3-flash-latest"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          debugContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: this.formatProviderError("gemini", error, "Debugging")
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification.
`;

          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: debugPrompt
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const response = await this.anthropicClient.messages.create({
            model: config.debuggingModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for debugging:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: this.formatProviderError("anthropic", error, "Debugging")
          };
        }
      }

      // Same guard as `responseContent` above: `debugContent` can be
      // `undefined` (no provider branch matched) or `null` (OpenAI's typed
      // response shape), so narrow it to `string` before using it.
      if (!debugContent) {
        return {
          success: false,
          error: "No debug content received from the AI provider. Please try again."
        };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;

      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];

      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: this.formatProviderError(configHelper.loadConfig().apiProvider, error, "Debug processing") };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
