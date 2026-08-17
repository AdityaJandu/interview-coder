/**
 * UnifiedView - Single page that merges Queue and Solutions views.
 * One command bar, one scrollable feed with conversation messages,
 * screenshots, problem statement, code solution, and complexity.
 */
import React, { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import { ConversationSection } from "../components/Conversation/ConversationSection"
import UnifiedCommandBar from "../components/UnifiedCommandBar"
import { useConversation } from "../hooks/useConversation"
import { useToast } from "../contexts/toast"
import { ProblemStatementData } from "../types/solutions"
import { Screenshot } from "../types/screenshots"
import {
  ContentSection,
  SolutionSection,
  ComplexitySection,
  MCQAnswerSection
} from "../components/shared/SolutionComponents"
import { MarkdownRenderer } from "../components/MarkdownRenderer"
import { COMMAND_KEY } from "../utils/platform"
import Debug from "./Debug"

async function fetchScreenshots(): Promise<Screenshot[]> {
  try {
    const existing = await window.electronAPI.getScreenshots()
    return existing
  } catch (error) {
    console.error("Error loading screenshots:", error)
    throw error
  }
}

interface UnifiedViewProps {
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

// Shape of the data ProcessingHelper sends on SOLUTION_SUCCESS
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

const UnifiedView: React.FC<UnifiedViewProps> = ({
  credits,
  currentLanguage,
  setLanguage
}) => {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const contentRef = useRef<HTMLDivElement>(null)

  // ── Conversation Hook ──
  const conversation = useConversation()

  // ── Screenshot State (from Queue.tsx) ──
  const {
    data: screenshots = [],
    refetch: refetchScreenshots
  } = useQuery<Screenshot[]>({
    queryKey: ["screenshots"],
    queryFn: fetchScreenshots,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false
  })

  // ── Solution State (from Solutions.tsx) ──
  const [debugProcessing, setDebugProcessing] = useState(false)
  const [problemStatementData, setProblemStatementData] =
    useState<ProblemStatementData | null>(null)
  const [solutionData, setSolutionData] = useState<string | null>(null)
  const [thoughtsData, setThoughtsData] = useState<string[] | null>(null)
  const [timeComplexityData, setTimeComplexityData] = useState<string | null>(null)
  const [spaceComplexityData, setSpaceComplexityData] = useState<string | null>(null)
  const [isMCQ, setIsMCQ] = useState(false)
  const [mcqAnswerData, setMcqAnswerData] = useState<string | null>(null)
  const [isGeneralCoding, setIsGeneralCoding] = useState(false)
  const [generalAnalysisData, setGeneralAnalysisData] = useState<string | null>(null)
  const [isResetting, setIsResetting] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const hasResult = isMCQ ? !!mcqAnswerData : (isGeneralCoding ? !!generalAnalysisData : !!solutionData)

  // ── ResizeObserver (debounced) ──
  useEffect(() => {
    if (isSettingsOpen) return

    let debounceTimer: NodeJS.Timeout

    const updateDimensions = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (contentRef.current) {
          let contentHeight = contentRef.current.scrollHeight
          let contentWidth = contentRef.current.scrollWidth

          const maxWidth = Math.floor((window.screen.availWidth || 1920) * 0.5)
          const maxHeight = Math.floor((window.screen.availHeight || 1080) * 0.85)

          window.electronAPI.updateContentDimensions({
            width: Math.min(contentWidth, maxWidth),
            height: Math.min(contentHeight, maxHeight)
          })
        }
      }, 100)
    }

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

  // ── Screenshot Event Listeners ──
  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetchScreenshots()),
      window.electronAPI.onResetView(() => {
        refetchScreenshots()
        // Reset solution state
        setIsResetting(true)
        queryClient.removeQueries({ queryKey: ["solution"] })
        queryClient.removeQueries({ queryKey: ["new_solution"] })
        queryClient.removeQueries({ queryKey: ["problem_statement"] })
        queryClient.removeQueries({ queryKey: ["screenshots"] })
        setSolutionData(null)
        setThoughtsData(null)
        setTimeComplexityData(null)
        setSpaceComplexityData(null)
        setProblemStatementData(null)
        setIsMCQ(false)
        setMcqAnswerData(null)
        setIsGeneralCoding(false)
        setGeneralAnalysisData(null)
        setDebugProcessing(false)
        setTimeout(() => setIsResetting(false), 0)
      }),
      window.electronAPI.onDeleteLastScreenshot(async () => {
        if (screenshots.length > 0) {
          await handleDeleteScreenshot(screenshots.length - 1)
        } else {
          showToast("No Screenshots", "There are no screenshots to delete", "neutral")
        }
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast("No Screenshots", "There are no screenshots to process.", "neutral")
      }),
    ]

    return () => cleanupFunctions.forEach((cleanup) => cleanup())
  }, [screenshots])

  // ── Solution Event Listeners ──
  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
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
      window.electronAPI.onSolutionError((error: string) => {
        showToast("Processing Failed", error, "error")
        const solution = queryClient.getQueryData(["solution"]) as SolutionSuccessData | null
        if (!solution) {
          // No previous solution to fall back to - stay in current state
        }
        setSolutionData(solution?.code || null)
        setThoughtsData(solution?.thoughts || null)
        setTimeComplexityData(solution?.time_complexity || null)
        setSpaceComplexityData(solution?.space_complexity || null)
        setIsMCQ(solution?.is_mcq || false)
        setMcqAnswerData(solution?.mcq_answer || null)
        setIsGeneralCoding(solution?.is_general_coding || false)
        setGeneralAnalysisData(solution?.general_analysis || null)
      }),
      window.electronAPI.onSolutionSuccess((data: SolutionSuccessData) => {
        if (!data) {
          console.warn("Received empty or invalid solution data")
          return
        }
        queryClient.setQueryData(["solution"], data)
        setSolutionData(data.code || null)
        setThoughtsData(data.thoughts || null)
        setTimeComplexityData(data.time_complexity || null)
        setSpaceComplexityData(data.space_complexity || null)
        setIsMCQ(data.is_mcq || false)
        setMcqAnswerData(data.mcq_answer || null)
        setIsGeneralCoding(data.is_general_coding || false)
        setGeneralAnalysisData(data.general_analysis || null)
        // Refresh screenshots after solution
        refetchScreenshots()
      }),
      // Debug events
      window.electronAPI.onDebugStart(() => {
        setDebugProcessing(true)
      }),
      window.electronAPI.onDebugSuccess((data: { code: string; thoughts: string[]; time_complexity: string; space_complexity: string; debug_analysis?: string }) => {
        queryClient.setQueryData(["new_solution"], data)
        setDebugProcessing(false)
      }),
      window.electronAPI.onDebugError(() => {
        showToast("Processing Failed", "There was an error debugging your code.", "error")
        setDebugProcessing(false)
      }),
    ]

    return () => cleanupFunctions.forEach((cleanup) => cleanup())
  }, [queryClient, showToast])

  // ── Sync solution state from cache ──
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

  // ── Handlers ──
  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]
    try {
      const response = await window.electronAPI.deleteScreenshot(screenshotToDelete.path)
      if (response.success) {
        refetchScreenshots()
      } else {
        showToast("Error", "Failed to delete the screenshot file", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
    }
  }

  // ── Render ──
  // If debug data exists, render the Debug view (still under the shared command bar)
  const showDebugView = !isResetting && !!queryClient.getQueryData(["new_solution"])

  return (
    <div ref={contentRef} className="bg-transparent w-full flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* ── Unified Command Bar (sticky top) — stays mounted in both normal and debug views ── */}
      <div className="shrink-0 relative z-50">
        <UnifiedCommandBar
          isRecording={conversation.isRecording}
          conversationProcessing={conversation.isProcessing}
          recordingDuration={conversation.recordingDuration}
          currentSpeaker={conversation.currentSpeaker}
          isMuted={conversation.isMuted}
          onStartRecording={conversation.handleStartRecording}
          onStopRecording={conversation.handleStopRecording}
          onToggleSpeaker={conversation.handleToggleSpeaker}
          onToggleMute={conversation.handleToggleMute}
          onClearConversation={conversation.handleClearConversation}
          screenshotCount={screenshots.length}
          hasSolution={hasResult}
          solutionProcessing={!problemStatementData && !!solutionData === false && problemStatementData !== null}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      </div>

      {showDebugView ? (
        <Debug
          isProcessing={debugProcessing}
          setIsProcessing={setDebugProcessing}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : (
        /* ── Single Scrollable Feed ── */
        <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth space-y-3 px-4 py-3">

          {/* Conversation Section */}
          <div className="bg-zinc-900/60 rounded-md p-4 border border-zinc-800/80">
            <ConversationSection
              messages={conversation.messages}
              liveTranscript={conversation.liveTranscript}
              isMuted={conversation.isMuted}
              isRecording={conversation.isRecording}
              isProcessing={conversation.isProcessing}
              aiSuggestions={conversation.aiSuggestions}
              suggestionError={conversation.suggestionError}
              processSpeakerRef={conversation.processSpeakerRef}
              messagesEndRef={conversation.messagesEndRef}
              onTriggerAnswerNow={conversation.handleTriggerAnswerNow}
              formatTime={conversation.formatTime}
            />
          </div>

          {/* Screenshot Queue */}
          <ScreenshotQueue
            isLoading={debugProcessing}
            screenshots={screenshots}
            onDeleteScreenshot={handleDeleteScreenshot}
          />

          {/* Solution Content (when processing or solved) */}
          {(problemStatementData || hasResult) && (
            <div className="w-full text-sm text-zinc-100 bg-zinc-900/60 rounded-md border border-zinc-800/80">
              <div className="rounded-lg overflow-hidden">
                <div className="px-4 py-3 space-y-4 max-w-full">

                  {/* Problem Statement (loading state before solution) */}
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

                  {/* MCQ Answer */}
                  {hasResult && isMCQ && (
                    <MCQAnswerSection
                      answer={mcqAnswerData}
                      isLoading={!mcqAnswerData}
                    />
                  )}

                  {/* General Coding Answer */}
                  {hasResult && isGeneralCoding && (
                    <ContentSection
                      title="Answer"
                      content={generalAnalysisData}
                      isLoading={!generalAnalysisData}
                    />
                  )}

                  {/* Standard Solution (thoughts + code + complexity) */}
                  {hasResult && !isMCQ && !isGeneralCoding && (
                    <>
                      <ContentSection
                        title={`My Thoughts (${COMMAND_KEY} + Arrow keys to scroll)`}
                        content={
                          thoughtsData && (
                            <div className="space-y-3">
                              <div className="space-y-1">
                                {thoughtsData.map((thought, index) => (
                                  <div key={index} className="flex items-start gap-2">
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
          )}
        </div>
      )}
    </div>
  )
}

export default UnifiedView
