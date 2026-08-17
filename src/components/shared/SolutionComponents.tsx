/**
 * Shared solution display components extracted from Solutions.tsx.
 * Used by both UnifiedView and Debug pages.
 */
import React, { useState, lazy, Suspense } from "react"
import { MarkdownRenderer } from "../MarkdownRenderer"
import { LoadingText } from "./LoadingText"

const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter").then(module => ({
    default: module.Prism
  }))
)
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"

export const ContentSection = ({
  title,
  content,
  isLoading
}: {
  title: string
  content: React.ReactNode | string
  isLoading: boolean
}) => (
  <div className="space-y-2">
    <h2 className="text-[13px] font-medium text-white tracking-wide">
      {title}
    </h2>
    {isLoading ? (
      <LoadingText text="Extracting problem statement..." />
    ) : (
      <div className="text-[13px] leading-[1.4] text-gray-100 max-w-[600px]">
        {typeof content === 'string' ? <MarkdownRenderer>{content}</MarkdownRenderer> : content}
      </div>
    )}
  </div>
)

export const MCQAnswerSection = ({
  answer,
  isLoading
}: {
  answer: string | null
  isLoading: boolean
}) => (
  <div className="space-y-2">
    <h2 className="text-[13px] font-medium text-white tracking-wide">
      Answer
    </h2>
    {isLoading ? (
      <LoadingText text="Determining the correct answer..." />
    ) : (
      <div className="text-[14px] leading-[1.4] text-gray-100 bg-white/5 border border-white/10 rounded-md p-3 max-w-[600px]">
        <div className="flex items-start gap-2">
          <div className="w-1 h-1 rounded-full bg-green-400/80 mt-2 shrink-0" />
          <div className="font-medium">{answer}</div>
        </div>
      </div>
    )}
  </div>
)

export const SolutionSection = ({
  title,
  content,
  isLoading,
  currentLanguage
}: {
  title: string
  content: React.ReactNode
  isLoading: boolean
  currentLanguage: string
}) => {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    if (typeof content === "string") {
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div className="space-y-2 relative">
      <h2 className="text-[13px] font-medium text-white tracking-wide">
        {title}
      </h2>
      {isLoading ? (
        <LoadingText text="Loading solutions..." />
      ) : (
        <div className="w-full relative">
          <button
            onClick={copyToClipboard}
            className="absolute top-2 right-2 z-10 text-[10px] font-mono text-white/70 bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/20 rounded-md px-2 py-1 transition-all duration-200 backdrop-blur-sm"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <Suspense fallback={<div className="text-white/60 text-sm">Loading syntax highlighter...</div>}>
            <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-md overflow-hidden">
              <SyntaxHighlighter
                showLineNumbers
                language={currentLanguage == "golang" ? "go" : currentLanguage}
                style={vscDarkPlus}
                customStyle={{
                  maxWidth: "100%",
                  margin: 0,
                  padding: "0.75rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  backgroundColor: "transparent",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "12px",
                  lineHeight: "1.625",
                  letterSpacing: "-0.025em"
                }}
                wrapLongLines={true}
              >
                {content as string}
              </SyntaxHighlighter>
            </div>
          </Suspense>
        </div>
      )}
    </div>
  )
}

export const ComplexitySection = ({
  timeComplexity,
  spaceComplexity,
  isLoading
}: {
  timeComplexity: string | null
  spaceComplexity: string | null
  isLoading: boolean
}) => {
  // Helper to ensure we have proper complexity values
  const formatComplexity = (complexity: string | null): string => {
    // Default if no complexity returned by LLM
    if (!complexity || complexity.trim() === "") {
      return "Complexity not available";
    }

    const bigORegex = /O\([^)]+\)/i;
    // Return the complexity as is if it already has Big O notation
    if (bigORegex.test(complexity)) {
      return complexity;
    }

    // Concat Big O notation to the complexity
    return `O(${complexity})`;
  };

  const formattedTimeComplexity = formatComplexity(timeComplexity);
  const formattedSpaceComplexity = formatComplexity(spaceComplexity);

  return (
    <div className="space-y-2">
      <h2 className="text-[13px] font-medium text-white tracking-wide">
        Complexity
      </h2>
      {isLoading ? (
        <LoadingText text="Calculating complexity..." />
      ) : (
        <div className="space-y-3">
          <div className="text-[13px] leading-[1.4] text-gray-100 bg-white/5 rounded-md p-3">
            <div className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-blue-400/80 mt-2 shrink-0" />
              <div>
                <strong>Time:</strong> {formattedTimeComplexity}
              </div>
            </div>
          </div>
          <div className="text-[13px] leading-[1.4] text-gray-100 bg-white/5 rounded-md p-3">
            <div className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-blue-400/80 mt-2 shrink-0" />
              <div>
                <strong>Space:</strong> {formattedSpaceComplexity}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
