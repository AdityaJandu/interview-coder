// Solutions.tsx
import React, { useState, useEffect, useRef, lazy, Suspense } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
// Dynamic import for syntax highlighter - loaded only when code is displayed
// This reduces initial bundle size significantly
const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter").then(module => ({
    default: module.Prism
  }))
)
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"

import ScreenshotQueue from "../components/Queue/ScreenshotQueue"

import { ProblemStatementData } from "../types/solutions"
import SolutionCommands from "../components/Solutions/SolutionCommands"
import Debug from "./Debug"
import { useToast } from "../contexts/toast"
import { COMMAND_KEY } from "../utils/platform"
import { ConversationSection } from "../components/Conversation/ConversationSection"
import { MarkdownRenderer } from "../components/MarkdownRenderer"

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
      <div className="mt-4 flex">
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Extracting problem statement...
        </p>
      </div>
    ) : (
      <div className="text-[13px] leading-[1.4] text-gray-100 max-w-[600px]">
        {typeof content === 'string' ? <MarkdownRenderer>{content}</MarkdownRenderer> : content}
      </div>
    )}
  </div>
)

// Answer-only view for MCQs: no code block, no complexity analysis - just
// the correct option, front and center. Kept visually distinct (a single
// highlighted card) so it doesn't look like a truncated/broken solution.
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
      <div className="mt-4 flex">
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Determining the correct answer...
        </p>
      </div>
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

const SolutionSection = ({
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
        <div className="space-y-1.5">
          <div className="mt-4 flex">
            <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
              Loading solutions...
            </p>
          </div>
        </div>
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
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Calculating complexity...
        </p>
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

export interface SolutionsProps {
  setView: (view: "queue" | "solutions" | "debug") => void
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

// Shape of the data ProcessingHelper sends on SOLUTION_SUCCESS. `is_mcq`
// and `mcq_answer` are only present for the MCQ answer-only path.
interface SolutionSuccessData {
  code: string
  thoughts: string[]
  time_complexity: string
  space_complexity: string
  is_mcq?: boolean
  mcq_answer?: string
  is_general_coding?: boolean
  general_analysis?: string
}

const Solutions: React.FC<SolutionsProps> = ({
  setView,
  credits,
  currentLanguage,
  setLanguage
}) => {
  const queryClient = useQueryClient()
  const contentRef = useRef<HTMLDivElement>(null)

  const [debugProcessing, setDebugProcessing] = useState(false)
  const [problemStatementData, setProblemStatementData] =
    useState<ProblemStatementData | null>(null)
  const [solutionData, setSolutionData] = useState<string | null>(null)
  const [thoughtsData, setThoughtsData] = useState<string[] | null>(null)
  const [timeComplexityData, setTimeComplexityData] = useState<string | null>(
    null
  )
  const [spaceComplexityData, setSpaceComplexityData] = useState<string | null>(
    null
  )
  // Track whether the current result is an MCQ answer-only result, and
  // hold the answer text separately from `solutionData` (which is treated
  // as code elsewhere, e.g. passed straight into the syntax highlighter).
  const [isMCQ, setIsMCQ] = useState(false)
  const [mcqAnswerData, setMcqAnswerData] = useState<string | null>(null)
  const [isGeneralCoding, setIsGeneralCoding] = useState(false)
  const [generalAnalysisData, setGeneralAnalysisData] = useState<string | null>(null)

  const [isResetting, setIsResetting] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  interface Screenshot {
    id: string
    path: string
    preview: string
    timestamp: number
  }

  const [extraScreenshots, setExtraScreenshots] = useState<Screenshot[]>([])

  useEffect(() => {
    const fetchScreenshots = async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        console.log("Raw screenshot data:", existing)
        const screenshots = (Array.isArray(existing) ? existing : []).map(
          (p) => ({
            id: p.path,
            path: p.path,
            preview: p.preview,
            timestamp: Date.now()
          })
        )
        console.log("Processed screenshots:", screenshots)
        setExtraScreenshots(screenshots)
      } catch (error) {
        console.error("Error loading extra screenshots:", error)
        setExtraScreenshots([])
      }
    }

    fetchScreenshots()
  }, [solutionData])

  const { showToast } = useToast()

  // UseEffect 1: Handled explicitly for safely pausing the ResizeObserver memory overload.
  useEffect(() => {
    if (isSettingsOpen) {
      return; // Pause ResizeObserver entirely when Settings is visible to prevent bounds bouncing
    }

    let debounceTimer: NodeJS.Timeout;

    // Height update logic
    const updateDimensions = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (contentRef.current) {
          let contentHeight = contentRef.current.scrollHeight
          let contentWidth = contentRef.current.scrollWidth

          // Cap the dimensions to prevent run-away layout expansion bugs from crashing Electron
          const maxWidth = Math.floor((window.screen.availWidth || 1920) * 0.5);
          const maxHeight = Math.floor((window.screen.availHeight || 1080) * 0.85);

          window.electronAPI.updateContentDimensions({
            width: Math.min(contentWidth, maxWidth),
            height: Math.min(contentHeight, maxHeight)
          })
        }
      }, 100); // 100ms Debounce to prevent flooding IPC channel
    }

    // Initialize resize observer
    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    return () => {
      clearTimeout(debounceTimer)
      resizeObserver.disconnect()
    }
  }, [isSettingsOpen])

  // UseEffect 2: Separated from the ResizeObserver to ensure event handlers stay safely bound 
  useEffect(() => {
    // Set up event listeners
    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(async () => {
        try {
          const existing = await window.electronAPI.getScreenshots()
          const screenshots = (Array.isArray(existing) ? existing : []).map(
            (p) => ({
              id: p.path,
              path: p.path,
              preview: p.preview,
              timestamp: Date.now()
            })
          )
          setExtraScreenshots(screenshots)
        } catch (error) {
          console.error("Error loading extra screenshots:", error)
        }
      }),
      window.electronAPI.onResetView(() => {
        // Set resetting state first
        setIsResetting(true)

        // Remove queries
        queryClient.removeQueries({
          queryKey: ["solution"]
        })
        queryClient.removeQueries({
          queryKey: ["new_solution"]
        })

        // Reset screenshots
        setExtraScreenshots([])

        // After a small delay, clear the resetting state
        setTimeout(() => {
          setIsResetting(false)
        }, 0)
      }),
      window.electronAPI.onSolutionStart(() => {
        // Every time processing starts, reset relevant states
        setSolutionData(null)
        setThoughtsData(null)
        setTimeComplexityData(null)
        setSpaceComplexityData(null)
        setIsMCQ(false)
        setMcqAnswerData(null)
        setIsGeneralCoding(false)
        setGeneralAnalysisData(null)
      }),
      window.electronAPI.onProblemExtracted((data: ProblemStatementData) => {
        queryClient.setQueryData(["problem_statement"], data)
      }),
      //if there was an error processing the initial solution
      window.electronAPI.onSolutionError((error: string) => {
        showToast("Processing Failed", error, "error")
        // Reset solutions in the cache (even though this shouldn't ever happen) and complexities to previous states
        const solution = queryClient.getQueryData(["solution"]) as SolutionSuccessData | null
        if (!solution) {
          setView("queue")
        }
        setSolutionData(solution?.code || null)
        setThoughtsData(solution?.thoughts || null)
        setTimeComplexityData(solution?.time_complexity || null)
        setSpaceComplexityData(solution?.space_complexity || null)
        setIsMCQ(solution?.is_mcq || false)
        setMcqAnswerData(solution?.mcq_answer || null)
        setIsGeneralCoding(solution?.is_general_coding || false)
        setGeneralAnalysisData(solution?.general_analysis || null)
        console.error("Processing error:", error)
      }),
      //when the initial solution is generated, we'll set the solution data to that
      window.electronAPI.onSolutionSuccess((data: SolutionSuccessData) => {
        if (!data) {
          console.warn("Received empty or invalid solution data")
          return
        }
        console.log({ data })
        const solutionData: SolutionSuccessData = { ...data }

        queryClient.setQueryData(["solution"], solutionData)
        setSolutionData(solutionData.code || null)
        setThoughtsData(solutionData.thoughts || null)
        setTimeComplexityData(solutionData.time_complexity || null)
        setSpaceComplexityData(solutionData.space_complexity || null)
        setIsMCQ(solutionData.is_mcq || false)
        setMcqAnswerData(solutionData.mcq_answer || null)
        setIsGeneralCoding(solutionData.is_general_coding || false)
        setGeneralAnalysisData(solutionData.general_analysis || null)

        // Fetch latest screenshots when solution is successful
        const fetchScreenshots = async () => {
          try {
            const existing = await window.electronAPI.getScreenshots()
            const screenshots =
              existing.previews?.map((p: { path: string; preview: string }) => ({
                id: p.path,
                path: p.path,
                preview: p.preview,
                timestamp: Date.now()
              })) || []
            setExtraScreenshots(screenshots)
          } catch (error) {
            console.error("Error loading extra screenshots:", error)
            setExtraScreenshots([])
          }
        }
        fetchScreenshots()
      }),

      //########################################################
      //DEBUG EVENTS
      //########################################################
      window.electronAPI.onDebugStart(() => {
        //we'll set the debug processing state to true and use that to render a little loader
        setDebugProcessing(true)
      }),
      //the first time debugging works, we'll set the view to debug and populate the cache with the data
      window.electronAPI.onDebugSuccess((data: { code: string; thoughts: string[]; time_complexity: string; space_complexity: string; debug_analysis?: string }) => {
        queryClient.setQueryData(["new_solution"], data)
        setDebugProcessing(false)
      }),
      //when there was an error in the initial debugging, we'll show a toast and stop the little generating pulsing thing.
      window.electronAPI.onDebugError(() => {
        showToast(
          "Processing Failed",
          "There was an error debugging your code.",
          "error"
        )
        setDebugProcessing(false)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no extra screenshots to process.",
          "neutral"
        )
      }),
      // Removed out of credits handler - unlimited credits in this version
    ]

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [queryClient, setView, showToast])

  useEffect(() => {
    setProblemStatementData(
      queryClient.getQueryData(["problem_statement"]) || null
    )
    const cachedSolution = queryClient.getQueryData(["solution"]) as SolutionSuccessData | null
    setSolutionData(cachedSolution?.code ?? null)
    setThoughtsData(cachedSolution?.thoughts ?? null)
    setTimeComplexityData(cachedSolution?.time_complexity ?? null)
    setSpaceComplexityData(cachedSolution?.space_complexity ?? null)
    setIsMCQ(cachedSolution?.is_mcq || false)
    setMcqAnswerData(cachedSolution?.mcq_answer || null)
    setIsGeneralCoding(cachedSolution?.is_general_coding || false)
    setGeneralAnalysisData(cachedSolution?.general_analysis || null)

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.query.queryKey[0] === "problem_statement") {
        setProblemStatementData(
          queryClient.getQueryData(["problem_statement"]) || null
        )
      }
      if (event?.query.queryKey[0] === "solution") {
        const solution = queryClient.getQueryData(["solution"]) as SolutionSuccessData | null

        setSolutionData(solution?.code ?? null)
        setThoughtsData(solution?.thoughts ?? null)
        setTimeComplexityData(solution?.time_complexity ?? null)
        setSpaceComplexityData(solution?.space_complexity ?? null)
        setIsMCQ(solution?.is_mcq || false)
        setMcqAnswerData(solution?.mcq_answer || null)
        setIsGeneralCoding(solution?.is_general_coding || false)
        setGeneralAnalysisData(solution?.general_analysis || null)
      }
    })
    return () => unsubscribe()
  }, [queryClient])


  const handleDeleteExtraScreenshot = async (index: number) => {
    const screenshotToDelete = extraScreenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        // Fetch and update screenshots after successful deletion
        const existing = await window.electronAPI.getScreenshots()
        const screenshots = (Array.isArray(existing) ? existing : []).map(
          (p) => ({
            id: p.path,
            path: p.path,
            preview: p.preview,
            timestamp: Date.now()
          })
        )
        setExtraScreenshots(screenshots)
      } else {
        console.error("Failed to delete extra screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot", "error")
      }
    } catch (error) {
      console.error("Error deleting extra screenshot:", error)
      showToast("Error", "Failed to delete the screenshot", "error")
    }
  }

  // For the MCQ path, "has a result" means we have an answer string rather
  // than code. For general coding, we look for general analysis.
  // `solutionData` (code) might be empty in those cases.
  const hasResult = isMCQ ? !!mcqAnswerData : (isGeneralCoding ? !!generalAnalysisData : !!solutionData)

  return (
    <>
      {!isResetting && queryClient.getQueryData(["new_solution"]) ? (
        <Debug
          isProcessing={debugProcessing}
          setIsProcessing={setDebugProcessing}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : (
        <div ref={contentRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth space-y-3 px-4 py-3">
            {/* Conditionally render the screenshot queue if we have a result */}
            {hasResult && (
              <div className="bg-transparent w-fit">
                <div className="pb-3">
                  <div className="space-y-3 w-fit">
                    <ScreenshotQueue
                      isLoading={debugProcessing}
                      screenshots={extraScreenshots}
                      onDeleteScreenshot={handleDeleteExtraScreenshot}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Navbar of commands with the SolutionsHelper */}
            <div className="overflow-hidden contain-layout" style={{ contain: 'layout' }}>
              <SolutionCommands
                // Removed dangerous handleTooltipVisibilityChange prop assignment to prevent infinite layout height loop
                onTooltipVisibilityChange={() => { }}
                isProcessing={!problemStatementData || !hasResult}
                extraScreenshots={extraScreenshots}
                credits={credits}
                currentLanguage={currentLanguage}
                setLanguage={setLanguage}
                // @ts-ignore
                setIsSettingsOpen={setIsSettingsOpen}
              />
            </div>

            {/* Conversation Section */}
            <div className="bg-zinc-900/60 rounded-md p-4 border border-zinc-800/80" style={{ height: '350px', display: 'flex', flexDirection: 'column' }}>
              <ConversationSection />
            </div>

            {/* Main Content - Modified width constraints */}
            <div className="w-full text-sm text-zinc-100 bg-zinc-900/60 rounded-md border border-zinc-800/80">
              <div className="rounded-lg overflow-hidden">
                <div className="px-4 py-3 space-y-4 max-w-full">
                  {!hasResult && (
                    <>
                      <ContentSection
                        title="Problem Statement"
                        content={problemStatementData?.problem_statement}
                        isLoading={!problemStatementData}
                      />
                      {problemStatementData && (
                        <div className="mt-4 flex">
                          <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
                            {isMCQ ? "Determining the correct answer..." : "Generating solutions..."}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {hasResult && isMCQ && (
                    // MCQ path: answer only, no code block or complexity section.
                    <MCQAnswerSection
                      answer={mcqAnswerData}
                      isLoading={!mcqAnswerData}
                    />
                  )}

                  {hasResult && isGeneralCoding && (
                    <ContentSection
                      title="Answer"
                      content={generalAnalysisData}
                      isLoading={!generalAnalysisData}
                    />
                  )}

                  {hasResult && !isMCQ && !isGeneralCoding && (
                    <>
                      <ContentSection
                        title={`My Thoughts (${COMMAND_KEY} + Arrow keys to scroll)`}
                        content={
                          thoughtsData && (
                            <div className="space-y-3">
                              <div className="space-y-1">
                                {thoughtsData.map((thought, index) => (
                                  <div
                                    key={index}
                                    className="flex items-start gap-2"
                                  >
                                    <div className="w-1 h-1 rounded-full bg-blue-400/80 mt-2 shrink-0" />
                                    <div className="flex-1">
                                      <MarkdownRenderer>{thought}</MarkdownRenderer>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        }
                        isLoading={!thoughtsData}
                      />

                      <SolutionSection
                        title="Solution"
                        content={solutionData}
                        isLoading={!solutionData}
                        currentLanguage={currentLanguage}
                      />

                      <ComplexitySection
                        timeComplexity={timeComplexityData}
                        spaceComplexity={spaceComplexityData}
                        isLoading={!timeComplexityData || !spaceComplexityData}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Solutions
