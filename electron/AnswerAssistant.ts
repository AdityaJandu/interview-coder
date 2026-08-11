/**
 * AnswerAssistant - Generates AI-powered answer suggestions based on conversation context
 * Follows Single Responsibility Principle - only handles answer suggestion generation
 * Uses Dependency Inversion Principle - depends on IConversationManager interface
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import * as axios from 'axios';
import { configHelper, CandidateProfile } from './ConfigHelper';
import { IConversationManager } from './ConversationManager';
import {
  APIProvider,
  DEFAULT_ANSWER_MODELS,
} from "../shared/aiModels";

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
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

export interface AnswerSuggestion {
  suggestions: string[];
  reasoning: string;
  mode: 'mcq' | 'conversational';
}

export interface IAnswerAssistant {
  generateAnswerSuggestions(
    currentQuestion: string,
    conversationManager: IConversationManager,
    screenshotContext?: string,
    candidateProfile?: CandidateProfile
  ): Promise<AnswerSuggestion>;
}

export class AnswerAssistant implements IAnswerAssistant {
  private openai: OpenAI | null = null;
  private geminiApiKey: string | null = null;
  private anthropic: Anthropic | null = null;

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

  constructor() {
    this.initializeAIClients();

    // Listen for config changes to re-initialize the AI clients
    configHelper.on('config-updated', () => {
      this.initializeAIClients();
    });
  }

  /**
   * Initializes AI clients based on API provider from config
   */
  private initializeAIClients(): void {
    const config = configHelper.loadConfig();

    // Reset all clients
    this.openai = null;
    this.geminiApiKey = null;
    this.anthropic = null;

    if (!config.apiKey || config.apiKey.trim().length === 0) {
      return;
    }

    if (config.apiProvider === "openai") {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    } else if (config.apiProvider === "gemini") {
      this.geminiApiKey = config.apiKey;
    } else if (config.apiProvider === "anthropic") {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    }
  }

  /**
   * Generates answer suggestions based on conversation context
   * @param currentQuestion - The current interviewer question
   * @param conversationManager - Conversation manager instance (dependency injection)
   * @param screenshotContext - Optional screenshot context for coding interviews or MCQs
   * @returns Promise resolving to answer suggestions
   * @throws Error if AI client not initialized or request fails
   */
  public async generateAnswerSuggestions(
    currentQuestion: string,
    conversationManager: IConversationManager,
    screenshotContext?: string,
    candidateProfile?: CandidateProfile
  ): Promise<AnswerSuggestion> {
    const config = configHelper.loadConfig();

    // Check if any AI client is initialized
    if (!this.openai && !this.geminiApiKey && !this.anthropic) {
      throw new Error('AI client not initialized. Please set API key in settings.');
    }

    // FIX: Allow empty question IF we have a screenshot context (for silent MCQ assessments)
    if ((!currentQuestion || currentQuestion.trim().length === 0) && !screenshotContext) {
      throw new Error('Either a spoken question or screenshot context must be provided.');
    }

    const conversationHistory = conversationManager.getConversationHistory();
    const previousAnswers = conversationManager.getIntervieweeAnswers();

    // Get candidate profile from config if not provided
    const profile = candidateProfile || configHelper.loadConfig().candidateProfile;

    // Decide which mode we're in up front, since it changes both the prompt
    // and how we should interpret/format the model's reply.
    const isMCQ = this.isMCQContext(screenshotContext);

    const contextPrompt = this.buildContextPrompt(
      currentQuestion,
      conversationHistory,
      previousAnswers,
      screenshotContext,
      profile,
      isMCQ
    );

    const systemMessage = isMCQ
      ? 'You are a helpful assessment assistant. When shown a multiple choice question, respond with ONLY the correct option and nothing else - no explanation, no reasoning, no extra commentary.'
      : 'You are a helpful interview and assessment assistant. Provide concise, accurate, and actionable suggestions. Tailor suggestions to the job description and resume only when relevant to the question.';

    try {
      let suggestionsText = '';

      // Resolve the answer model with provider-mismatch safety checks.
      const configuredModel = config.answerModel || DEFAULT_ANSWER_MODELS[config.apiProvider];
      const provider = config.apiProvider;

      const isMismatch =
        (provider === 'openai' && (/gemini|claude/i.test(configuredModel))) ||
        (provider === 'gemini' && (/gpt|claude/i.test(configuredModel))) ||
        (provider === 'anthropic' && (/gpt|gemini/i.test(configuredModel)));

      let answerModel: string;
      if (isMismatch) {
        const fallback = DEFAULT_ANSWER_MODELS[provider];
        console.warn(
          `[AnswerAssistant] Model/provider mismatch detected: ` +
          `provider="${provider}" but answerModel="${configuredModel}". ` +
          `Falling back to default model "${fallback}".`
        );
        answerModel = fallback;
      } else {
        answerModel = configuredModel;
      }

      // MCQ answers should be short and deterministic; conversational
      // suggestions benefit from a bit more room and creativity.
      const maxTokens = isMCQ ? 60 : 500;
      const temperature = isMCQ ? 0 : 0.3;

      if (config.apiProvider === "openai" && this.openai) {
        const response = await this.openai.chat.completions.create({
          model: answerModel,
          messages: [
            {
              role: 'system',
              content: systemMessage
            },
            {
              role: 'user',
              content: contextPrompt
            }
          ],
          temperature,
          max_tokens: maxTokens,
        });

        suggestionsText = response.choices[0]?.message?.content || '';
      } else if (config.apiProvider === "gemini" && this.geminiApiKey) {
        const geminiMessages: GeminiMessage[] = [
          {
            role: "user",
            parts: [
              {
                text: `${systemMessage}\n\n${contextPrompt}`
              }
            ]
          }
        ];

        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${answerModel}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens
            }
          }
        );

        const responseData = response.data as GeminiResponse;
        if (responseData.candidates && responseData.candidates.length > 0) {
          suggestionsText = responseData.candidates[0].content.parts[0].text;
        }
      } else if (config.apiProvider === "anthropic" && this.anthropic) {
        const response = await this.anthropic.messages.create({
          model: answerModel,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: `${systemMessage}\n\n${contextPrompt}`
            }
          ],
          temperature
        });

        suggestionsText = (response.content[0] as { type: 'text', text: string }).text;
      } else {
        throw new Error('No AI client available. Please configure your API key in settings.');
      }

      const suggestions = isMCQ
        ? this.parseMCQAnswer(suggestionsText)
        : this.parseSuggestions(suggestionsText);

      return {
        suggestions: suggestions.length > 0
          ? suggestions
          : [isMCQ
            ? 'Unable to determine the answer from the screenshot.'
            : 'Consider answering based on your experience and background.'],
        reasoning: isMCQ
          ? 'MCQ mode: answer only, no explanation.'
          : 'Based on provided context and assessment requirements.',
        mode: isMCQ ? 'mcq' : 'conversational',
      };
    } catch (error: any) {
      console.error('Error generating suggestions:', error);

      const status = error?.status ?? error?.response?.status;
      if (status === 401) {
        throw new Error(this.formatProviderError(config.apiProvider, error, "Auth"));
      } else if (status === 429) {
        throw new Error(this.formatProviderError(config.apiProvider, error, "Rate limit"));
      }

      throw new Error(this.formatProviderError(config.apiProvider, error, "Answer suggestion generation"));
    }
  }

  /**
   * Detects whether the screenshot context looks like a multiple choice question.
   * Looks for lettered/numbered option lists and common MCQ phrasing.
   * This is intentionally conservative - it only flips into "answer only" mode
   * when there's reasonably strong evidence of an MCQ, since being wrong here
   * means either withholding a needed explanation or over-explaining an MCQ.
   */
  private isMCQContext(screenshotContext?: string): boolean {
    if (!screenshotContext || screenshotContext.trim().length === 0) {
      return false;
    }

    const text = screenshotContext;

    // Look for at least 2 option-style lines, e.g. "A)", "A.", "(A)", "1)", "1."
    const optionLinePattern = /(^|\n)\s*[\(\[]?[A-Da-d1-4][\)\.\]]\s+.+/g;
    const optionMatches = text.match(optionLinePattern) || [];

    // Common MCQ phrasing cues
    const phraseCues = [
      /multiple\s*choice/i,
      /select\s+(the\s+)?(one|correct|best)/i,
      /choose\s+(the\s+)?(one|correct|best)/i,
      /which\s+of\s+the\s+following/i,
      /correct\s+option/i,
      /correct\s+answer/i,
    ];
    const hasPhraseCue = phraseCues.some(re => re.test(text));

    return optionMatches.length >= 2 || (optionMatches.length >= 1 && hasPhraseCue) || hasPhraseCue;
  }

  /**
   * Builds the context prompt for the AI
   */
  private buildContextPrompt(
    currentQuestion: string,
    conversationHistory: string,
    previousAnswers: string[],
    screenshotContext: string | undefined,
    candidateProfile: CandidateProfile | undefined,
    isMCQ: boolean
  ): string {
    const shouldUseResume = this.isResumeRelevant(currentQuestion);

    // FIX: Adapt prompt opening based on whether a verbal question was asked
    let prompt = `You are an AI assistant helping someone during an interview or assessment.\n\n`;

    if (currentQuestion && currentQuestion.trim().length > 0) {
      prompt += `The interviewer just asked: "${currentQuestion}"\n\n`;
    } else if (screenshotContext) {
      prompt += `The user needs help solving the assessment shown in the screenshot data below.\n\n`;
    }

    if (conversationHistory) {
      prompt += `Previous conversation:\n${conversationHistory}\n\n`;
    }

    if (previousAnswers.length > 0) {
      prompt += `Previous answers the interviewee has given:\n${previousAnswers.join('\n\n')}\n\n`;
    }

    if (candidateProfile?.jobDescription) {
      prompt += `Job Description (use to tailor answers to this interview):\n${candidateProfile.jobDescription}\n\n`;
    }

    // Resume/profile context isn't useful for MCQ answer-only mode, so skip it there.
    if (!isMCQ && candidateProfile && shouldUseResume) {
      const profileSections: string[] = [];
      if (candidateProfile.name) profileSections.push(`Name: ${candidateProfile.name}`);
      if (candidateProfile.resume) profileSections.push(`Resume: ${candidateProfile.resume}`);

      if (profileSections.length > 0) {
        prompt += `Candidate Profile (use this to personalize suggestions):\n${profileSections.join('\n')}\n\n`;
      }
    }

    if (screenshotContext) {
      prompt += `SCREENSHOT DATA:\n${screenshotContext}\n\n`;
    }

    if (isMCQ) {
      // MODE 1: MCQ - answer only, nothing else.
      prompt += `INSTRUCTIONS:
This is a multiple choice question. Reply with ONLY the correct option (letter/number and text), on a single line.
Do NOT include any explanation, reasoning, preamble, or extra bullets.
Example of the ONLY acceptable format: "- B) Paris"`;
    } else {
      // MODE 2: Conversational - existing multi-suggestion behavior.
      prompt += `INSTRUCTIONS:
Based on the provided context, please format your response as simple bullet points, one per line starting with "-".
Provide 3-5 bullet point suggestions that directly answer the question.
Reference previous answers for consistency if applicable.
Keep the points actionable and easy to read quickly.`;
    }

    return prompt;
  }

  /**
   * Only treat resume as relevant when the question is about the candidate's background
   */
  private isResumeRelevant(question: string): boolean {
    if (!question) return false;
    const q = question.toLowerCase();
    const resumeKeywords = [
      'resume',
      'cv',
      'experience',
      'background',
      'work history',
      'employment',
      'projects',
      'portfolio',
      'skills',
      'education',
      'certification',
      'accomplishment',
      'achievement'
    ];
    return resumeKeywords.some(keyword => q.includes(keyword));
  }

  /**
   * Parses an MCQ "answer only" response into a single-item suggestion list.
   * Strips bullet markers and collapses everything to one clean line, since
   * in this mode we expect (and only want) one answer, not multiple bullets.
   */
  private parseMCQAnswer(answerText: string): string[] {
    const cleaned = answerText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned.length > 0 ? [cleaned] : [];
  }

  /**
   * Parses AI response into structured suggestions
   */
  private parseSuggestions(suggestionsText: string): string[] {
    const lines = suggestionsText.split('\n').map(line => line.trim());
    const suggestions: string[] = [];
    let currentSuggestion = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!line) {
        if (currentSuggestion) {
          suggestions.push(currentSuggestion.trim());
          currentSuggestion = '';
        }
        continue;
      }

      const isNewSuggestion =
        line.startsWith('-') ||
        line.startsWith('•') ||
        line.match(/^\d+\./) ||
        (i > 0 && !lines[i - 1] && line.length > 0 && line.length < 200);

      if (isNewSuggestion) {
        if (currentSuggestion) {
          suggestions.push(currentSuggestion.trim());
        }
        currentSuggestion = line
          .replace(/^[-•]\s*/, '')
          .replace(/^\d+\.\s*/, '')
          .trim();
      } else if (currentSuggestion) {
        currentSuggestion += ' ' + line;
      } else if (line.length > 0 && line.length < 200) {
        currentSuggestion = line;
      }
    }

    if (currentSuggestion) {
      suggestions.push(currentSuggestion.trim());
    }

    return suggestions
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length < 500)
      .map(s => s.replace(/\s+/g, ' ').trim());
  }

  public isInitialized(): boolean {
    return this.openai !== null || this.geminiApiKey !== null || this.anthropic !== null;
  }
}
