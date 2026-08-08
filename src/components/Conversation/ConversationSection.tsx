/**
 * ConversationSection - UI component for conversation recording and AI suggestions
 * Follows Single Responsibility Principle - only handles conversation UI
 * Uses existing ContentSection pattern for consistency
 * Integrates with screenshot system for cohesive experience
 */
import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AudioRecorder } from '../../utils/audioRecorder';
import { ConversationCommands } from './ConversationCommands';
import { MarkdownRenderer } from '../MarkdownRenderer';

interface ConversationMessage {
  id: string;
  speaker: 'interviewer' | 'interviewee';
  text: string;
  timestamp: number;
  edited?: boolean;
}

interface AISuggestion {
  suggestions: string[];
  reasoning: string;
}

// Reuse the same ContentSection style from Solutions.tsx for consistency
const ContentSection = ({
  title,
  content,
  isLoading
}: {
  title: string;
  content: React.ReactNode | string;
  isLoading: boolean;
}) => (
  <div className="space-y-2">
    <h2 className="text-[13px] font-medium text-white tracking-wide">
      {title}
    </h2>
    {isLoading ? (
      <div className="mt-4 flex">
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Processing...
        </p>
      </div>
    ) : (
      <div className="text-[13px] leading-[1.4] text-gray-100 max-w-[600px]">
        {typeof content === 'string' ? <MarkdownRenderer>{content}</MarkdownRenderer> : content}
      </div>
    )}
  </div>
);

export const ConversationSection: React.FC = () => {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<'interviewer' | 'interviewee'>('interviewee');
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const processingCountRef = useRef(0);
  
  // Use ref to track recording state for event listener
  const isRecordingRef = useRef(false);
  
  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setTooltipHeight(height);
  };
  
  const handleClearConversation = async () => {
    try {
      await window.electronAPI.clearConversation();
    } catch (error) {
      console.error('Failed to clear conversation:', error);
    }
  };
  
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    loadConversation();
    
    const unsubscribeMessageAdded = window.electronAPI.onConversationMessageAdded((message: ConversationMessage) => {
      setMessages(prev => [...prev, message]);
      scrollToBottom();
    });
    
    const unsubscribeSpeakerChanged = window.electronAPI.onSpeakerChanged((speaker: string) => {
      setCurrentSpeaker(speaker as 'interviewer' | 'interviewee');
    });

    const unsubscribeMessageUpdated = window.electronAPI.onConversationMessageUpdated((message: ConversationMessage) => {
      setMessages(prev => prev.map(msg => msg.id === message.id ? message : msg));
    });

    const unsubscribeCleared = window.electronAPI.onConversationCleared(() => {
      setMessages([]);
      setAiSuggestions(null);
    });

    // Listen for keyboard shortcut to toggle recording
    const handleToggleRecording = async () => {
      // Check actual recording state using ref to get latest value
      const currentIsRecording = isRecordingRef.current || (audioRecorderRef.current?.getIsRecording() || false);
      if (currentIsRecording) {
        await handleStopRecording();
      } else {
        await handleStartRecording();
      }
    };

    window.addEventListener('toggle-recording', handleToggleRecording);

    return () => {
      unsubscribeMessageAdded();
      unsubscribeSpeakerChanged();
      unsubscribeMessageUpdated();
      unsubscribeCleared();
      window.removeEventListener('toggle-recording', handleToggleRecording);
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  // ── Listen for push-based AI suggestion events from the main process ────
  // The main process automatically triggers AnswerAssistant whenever an
  // interviewer message is added via ConversationManager, so we just need
  // to listen here and update local state accordingly.
  useEffect(() => {
    const unsubscribeLoading = window.electronAPI.onSuggestionLoading((isLoading: boolean) => {
      setIsProcessing(isLoading);
      if (isLoading) {
        // Clear stale error/suggestions while a new request is in-flight.
        setSuggestionError(null);
      }
    });

    const unsubscribeReceived = window.electronAPI.onSuggestionReceived(
      (suggestion: { suggestions: string[]; reasoning: string }) => {
        setAiSuggestions(suggestion);
        setSuggestionError(null);
      }
    );

    const unsubscribeError = window.electronAPI.onSuggestionError((errorMessage: string) => {
      console.error('[ConversationSection] Suggestion error from main process:', errorMessage);
      setSuggestionError(errorMessage);
    });

    return () => {
      unsubscribeLoading();
      unsubscribeReceived();
      unsubscribeError();
    };
  }, []);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  };

  const loadConversation = async () => {
    try {
      const result = await window.electronAPI.getConversation();
      if (result.success) {
        setMessages(result.messages);
        scrollToBottom();
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleStartRecording = async () => {
    try {
      // Check if already recording
      if (audioRecorderRef.current?.getIsRecording()) {
        console.log('Already recording');
        return;
      }
      
      if (!audioRecorderRef.current) {
        audioRecorderRef.current = new AudioRecorder();
      }
      
      await audioRecorderRef.current.startRecording();
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingDuration(0);
      
      // Start duration counter
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      alert(error.message || 'Failed to start recording. Please check microphone permissions.');
    }
  };

  const handleStopRecording = async () => {
    // Check recorder state directly instead of React state to avoid stale closures
    if (!audioRecorderRef.current || !audioRecorderRef.current.getIsRecording()) {
      console.log('Not recording, cannot stop');
      return;
    }
    
    setIsRecording(false);
    isRecordingRef.current = false;
    
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    
    try {
      const audioBlob = await audioRecorderRef.current.stopRecording();
      const speakerAtStop = currentSpeaker;
      setRecordingDuration(0);

      // Kick off transcription/processing asynchronously so UI stays responsive
      void processRecording(audioBlob, speakerAtStop);

      // Auto-toggle speaker for the next recording cycle
      void toggleSpeakerForNextTurn();
    } catch (error: any) {
      console.error('Failed to stop recording:', error);
      alert(error.message || 'Failed to stop recording');
    }
  };

  const processRecording = async (audioBlob: Blob, speaker: 'interviewer' | 'interviewee') => {
    updateProcessingStatus(1);
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      const transcribeResult = await window.electronAPI.transcribeAudio(arrayBuffer, audioBlob.type);
      
      if (transcribeResult.success && transcribeResult.result) {
        const text = transcribeResult.result.text;
        
        await window.electronAPI.addConversationMessage(text, speaker);
        
        if (speaker === 'interviewer') {
          await fetchAISuggestions(text);
        }
      }
    } catch (error: any) {
      console.error('Failed to process recording:', error);
      alert(error.message || 'Failed to process recording');
    } finally {
      updateProcessingStatus(-1);
    }
  };

  const updateProcessingStatus = (delta: number) => {
    processingCountRef.current = Math.max(0, processingCountRef.current + delta);
    setIsProcessing(processingCountRef.current > 0);
  };

  const fetchAISuggestions = async (question: string) => {
    try {
      // Get problem statement from query cache if available (from screenshots)
      const problemStatement = queryClient.getQueryData(['problem_statement']) as any;
      let screenshotContext: string | undefined;
      
      if (problemStatement?.problem_statement) {
        screenshotContext = `Problem Statement: ${problemStatement.problem_statement}\nConstraints: ${problemStatement.constraints || 'N/A'}\nExample Input: ${problemStatement.example_input || 'N/A'}\nExample Output: ${problemStatement.example_output || 'N/A'}`;
      }
      
      // Get candidate profile from config
      const config = await window.electronAPI.getConfig();
      const candidateProfile = (config as any).candidateProfile;
      
      const result = await window.electronAPI.getAnswerSuggestions(question, screenshotContext, candidateProfile);
      if (result.success && result.suggestions) {
        setAiSuggestions(result.suggestions);
      }
    } catch (error: any) {
      console.error('Failed to get AI suggestions:', error);
      // Don't show alert for suggestion errors - it's not critical
    }
  };

  const handleToggleSpeaker = async () => {
    try {
      const result = await window.electronAPI.toggleSpeaker();
      if (result.success) {
        setCurrentSpeaker(result.speaker);
        // Don't clear suggestions - user needs to see them when preparing their answer!
      }
    } catch (error) {
      console.error('Failed to toggle speaker:', error);
    }
  };

  const toggleSpeakerForNextTurn = async () => {
    try {
      const result = await window.electronAPI.toggleSpeaker();
      if (result.success) {
        setCurrentSpeaker(result.speaker);
      }
    } catch (error) {
      console.error('Failed to auto-toggle speaker:', error);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Top Bar: recording controls — always pinned, never shrinks ── */}
      <div className="shrink-0">
        <ConversationCommands
          onTooltipVisibilityChange={handleTooltipVisibilityChange}
          isRecording={isRecording}
          isProcessing={isProcessing}
          recordingDuration={recordingDuration}
          currentSpeaker={currentSpeaker}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onToggleSpeaker={handleToggleSpeaker}
          onClearConversation={handleClearConversation}
        />
      </div>

      {/* ── Unified scrollable body: messages + suggestions scroll together ──
           flex-1      → fills all remaining height below the toolbar
           min-h-0     → lets the div shrink below its content height so
                         overflow-y-auto actually activates inside a flex col
           overflow-y-auto → the one scroll container for everything
           pr-2        → keeps content clear of the scrollbar track          ── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto pr-2 mt-2"
        style={{ scrollBehavior: 'smooth' }}
      >
        {/* Conversation messages */}
        {messages.length > 0 && (
          <ContentSection
            title="Conversation"
            content={
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex flex-col ${
                      message.speaker === 'interviewer' ? 'items-start' : 'items-end'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-2.5 ${
                        message.speaker === 'interviewer'
                          ? 'bg-blue-600/20 border border-blue-500/30'
                          : 'bg-green-600/20 border border-green-500/30'
                      }`}
                    >
                      <div className="text-xs text-white/60 mb-1">
                        {message.speaker === 'interviewer' ? '👤 Interviewer' : '🎤 You'}
                      </div>
                      <div className="text-white text-[13px]">{message.text}</div>
                      <div className="text-xs text-white/40 mt-1">
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            }
            isLoading={false}
          />
        )}

        {/* Error banner — inline, scrolls with the rest */}
        {suggestionError && (
          <div className="border-t border-red-500/30 mt-3 pt-2 pb-1">
            <p className="text-xs text-red-400">
              ⚠️ Could not generate suggestions: {suggestionError}
            </p>
          </div>
        )}

        {/* AI suggestions — inline, scrolls with the rest */}
        {aiSuggestions && !suggestionError && (
          <div className="border-t border-white/10 mt-3 pt-3 pb-2">
            <ContentSection
              title="🤖 AI Answer Suggestions"
              content={
                <div className="space-y-1">
                  {aiSuggestions.suggestions.map((suggestion, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-purple-400/80 mt-2 shrink-0" />
                      <div className="text-[13px] flex-1">
                        <MarkdownRenderer>{suggestion}</MarkdownRenderer>
                      </div>
                    </div>
                  ))}
                </div>
              }
              isLoading={false}
            />
          </div>
        )}

        {/* Sentinel — at the very bottom so auto-scroll lands after suggestions */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

