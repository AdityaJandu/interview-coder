/**
 * ConversationSection - UI component for conversation recording and AI suggestions
 * Follows Single Responsibility Principle - only handles conversation UI
 * Uses existing ContentSection pattern for consistency
 * Integrates with screenshot system for cohesive experience
 */
import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  const [isMuted, setIsMuted] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  // Visual Live Transcript State
  const [liveTranscript, setLiveTranscript] = useState('');
  const transcriptBufferRef = useRef('');
  const recognitionRef = useRef<any>(null);

  // Continuous Audio MediaRecorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Core control flags for seamless restart mechanism
  const isRestartingRef = useRef(false);
  const processSpeakerRef = useRef<'interviewer' | 'interviewee'>('interviewer');
  const isMutedRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const processingCountRef = useRef(0);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
    if (isMuted) {
      setCurrentSpeaker('interviewer');
      processSpeakerRef.current = 'interviewer';
    }
  }, [isMuted]);

  const handleToggleMute = async () => {
    setIsMuted(prev => !prev);
  };

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

  // ── SMART AUTO-SCROLL ──
  const scrollToBottom = (force = false) => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      if (container) {
        if (force) {
          container.scrollTop = container.scrollHeight;
        } else {
          const isNearBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 150;
          if (isNearBottom) {
            container.scrollTop = container.scrollHeight;
          }
        }
      }
    }
  };

  useEffect(() => {
    scrollToBottom(false);
  }, [messages, liveTranscript]);

  useEffect(() => {
    loadConversation();

    const unsubscribeMessageAdded = window.electronAPI.onConversationMessageAdded((message: ConversationMessage) => {
      setMessages(prev => [...prev, message]);
    });

    const unsubscribeSpeakerChanged = window.electronAPI.onSpeakerChanged((speaker: string) => {
      if (!isMutedRef.current) {
        setCurrentSpeaker(speaker as 'interviewer' | 'interviewee');
      }
    });

    const unsubscribeMessageUpdated = window.electronAPI.onConversationMessageUpdated((message: ConversationMessage) => {
      setMessages(prev => prev.map(msg => msg.id === message.id ? message : msg));
    });

    const unsubscribeCleared = window.electronAPI.onConversationCleared(() => {
      setMessages([]);
      setAiSuggestions(null);
    });

    const handleToggleRecording = async () => {
      if (isRecordingRef.current) {
        await handleTriggerAnswerNow();
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

      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch (e) { }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribeLoading = window.electronAPI.onSuggestionLoading((isLoading: boolean) => {
      setIsProcessing(isLoading);
      if (isLoading) setSuggestionError(null);
    });

    const unsubscribeReceived = window.electronAPI.onSuggestionReceived(
      (suggestion: { suggestions: string[]; reasoning: string }) => {
        setAiSuggestions(suggestion);
        setSuggestionError(null);
      }
    );

    const unsubscribeError = window.electronAPI.onSuggestionError((errorMessage: string) => {
      setSuggestionError(errorMessage);
    });

    return () => {
      unsubscribeLoading();
      unsubscribeReceived();
      unsubscribeError();
    };
  }, []);

  const loadConversation = async () => {
    try {
      const result = await window.electronAPI.getConversation();
      if (result.success) {
        setMessages(result.messages);
        setTimeout(() => scrollToBottom(true), 150);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const initSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (final) transcriptBufferRef.current += final + ' ';
      setLiveTranscript(transcriptBufferRef.current + interim);
    };

    recognition.onerror = () => { };
    recognition.onend = () => {
      if (isRecordingRef.current) {
        try { recognition.start(); } catch (error) { }
      }
    };

    return recognition;
  };

  const updateProcessingStatus = (delta: number) => {
    processingCountRef.current = Math.max(0, processingCountRef.current + delta);
    setIsProcessing(processingCountRef.current > 0);
  };

  const processRecording = async (audioBlob: Blob, speaker: 'interviewer' | 'interviewee') => {
    updateProcessingStatus(1);
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const targetSpeaker = isMutedRef.current ? 'interviewer' : speaker;
      const transcribeResult = await window.electronAPI.transcribeAudio(arrayBuffer, audioBlob.type);

      if (transcribeResult.success && transcribeResult.result) {
        const text = transcribeResult.result.text;
        if (text.trim()) {
          await window.electronAPI.addConversationMessage(text, targetSpeaker);
          if (targetSpeaker === 'interviewer') {
            await fetchAISuggestions(text);
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to process recording:', error);
    } finally {
      updateProcessingStatus(-1);
    }
  };

  const startContinuousMediaRecorder = (stream: MediaStream) => {
    const mediaRecorder = new MediaRecorder(stream);
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const chunks = [...audioChunksRef.current];
      audioChunksRef.current = [];

      if (chunks.length > 0) {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunks, { type: mimeType });
        const activeSpeaker = isMutedRef.current ? 'interviewer' : processSpeakerRef.current;
        void processRecording(audioBlob, activeSpeaker);
      }

      if (isRestartingRef.current && isRecordingRef.current) {
        isRestartingRef.current = false;
        startContinuousMediaRecorder(stream);
      } else {
        stream.getTracks().forEach(track => track.stop());
        if (!isMutedRef.current) {
          void toggleSpeakerForNextTurn();
        }
      }
    };

    mediaRecorder.start(500);
    mediaRecorderRef.current = mediaRecorder;
  };

  const handleStartRecording = async () => {
    if (isRecordingRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Enforce initial mute state on tracks
      stream.getAudioTracks().forEach(track => {
        track.enabled = !isMutedRef.current;
      });

      startContinuousMediaRecorder(stream);

      if (!recognitionRef.current) {
        recognitionRef.current = initSpeechRecognition();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch (e) { }
      }

      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingDuration(0);
      transcriptBufferRef.current = '';
      setLiveTranscript('');

      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (error: any) {
      console.error('Failed to start recording:', error);
      alert(error.message || 'Failed to start recording. Check mic permissions.');
    }
  };

  const handleTriggerAnswerNow = async () => {
    if (!isRecordingRef.current || !mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state === 'inactive') return;

    processSpeakerRef.current = 'interviewer';
    isRestartingRef.current = true;

    transcriptBufferRef.current = '';
    setLiveTranscript('');

    mediaRecorderRef.current.stop();
  };

  const handleStopRecording = async () => {
    if (!isRecordingRef.current) return;

    setIsRecording(false);
    isRecordingRef.current = false;
    isRestartingRef.current = false;

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
    }

    transcriptBufferRef.current = '';
    setLiveTranscript('');

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      processSpeakerRef.current = isMutedRef.current ? 'interviewer' : currentSpeaker;
      mediaRecorderRef.current.stop();
    }
  };

  const fetchAISuggestions = async (question: string) => {
    try {
      const problemStatement = queryClient.getQueryData(['problem_statement']) as any;
      let screenshotContext: string | undefined;

      if (problemStatement?.problem_statement) {
        screenshotContext = `Problem Statement: ${problemStatement.problem_statement}\nConstraints: ${problemStatement.constraints || 'N/A'}\nExample Input: ${problemStatement.example_input || 'N/A'}\nExample Output: ${problemStatement.example_output || 'N/A'}`;
      }

      const config = await window.electronAPI.getConfig();
      const candidateProfile = (config as any).candidateProfile;

      const result = await window.electronAPI.getAnswerSuggestions(question, screenshotContext, candidateProfile);
      if (result.success && result.suggestions) {
        setAiSuggestions(result.suggestions);
      }
    } catch (error: any) {
      console.error('Failed to get AI suggestions:', error);
    }
  };

  const handleToggleSpeaker = async () => {
    if (isMutedRef.current) return;
    try {
      const result = await window.electronAPI.toggleSpeaker();
      if (result.success) setCurrentSpeaker(result.speaker);
    } catch (error) {
      console.error('Failed to toggle speaker:', error);
    }
  };

  const toggleSpeakerForNextTurn = async () => {
    if (isMutedRef.current) return;
    try {
      const result = await window.electronAPI.toggleSpeaker();
      if (result.success) setCurrentSpeaker(result.speaker);
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

  return (
    <div className="flex flex-col h-full relative">
      <div className="shrink-0 flex flex-col">
        <ConversationCommands
          onTooltipVisibilityChange={handleTooltipVisibilityChange}
          isRecording={isRecording}
          isProcessing={isProcessing}
          recordingDuration={recordingDuration}
          currentSpeaker={currentSpeaker}
          isMuted={isMuted}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onToggleSpeaker={handleToggleSpeaker}
          onToggleMute={handleToggleMute}
          onClearConversation={handleClearConversation}
        />

        {isRecording && (
          <div className="flex items-center justify-between px-3 py-2 bg-blue-900/10 border-b border-blue-500/20 shadow-inner z-10">
            <span className="text-xs text-blue-300 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              {isMuted ? 'Interviewer Only Mode (Mic Muted)' : 'Mic is live...'}
            </span>
            <button
              onClick={handleTriggerAnswerNow}
              disabled={isProcessing}
              className={`text-[13px] font-medium px-4 py-1.5 rounded-md shadow-md flex items-center gap-2 transition-all border ${isProcessing
                ? 'bg-gray-800 border-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-purple-600/30 hover:bg-purple-600/50 border-purple-500/50 text-white shadow-purple-500/20'
                }`}
            >
              <span className={!isProcessing ? "animate-pulse" : ""}>✨</span>
              {isProcessing ? 'Generating AI Suggestion...' : 'Answer Now'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-2 mt-2" style={{ scrollBehavior: 'smooth' }}>
        {(messages.length > 0 || liveTranscript) && (
          <ContentSection
            title="Conversation"
            content={
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex flex-col ${message.speaker === 'interviewer' ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-2.5 ${message.speaker === 'interviewer'
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

                {liveTranscript && (
                  <div className={`flex flex-col ${(isMuted || processSpeakerRef.current === 'interviewer') ? 'items-start' : 'items-end'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg p-2.5 ${(isMuted || processSpeakerRef.current === 'interviewer')
                        ? 'bg-blue-600/10 border border-blue-500/20 border-dashed'
                        : 'bg-green-600/10 border border-green-500/20 border-dashed'
                        }`}
                    >
                      <div className="text-xs text-white/60 mb-1 flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                        {isMuted ? '👤 Interviewer Only (Listening...)' : (processSpeakerRef.current === 'interviewer' ? '👤 Interviewer (Listening...)' : '🎤 You (Listening...)')}
                      </div>
                      <div className="text-white text-[13px] opacity-80 italic">{liveTranscript}</div>
                    </div>
                  </div>
                )}
              </div>
            }
            isLoading={false}
          />
        )}

        {suggestionError && (
          <div className="border-t border-red-500/30 mt-3 pt-2 pb-1">
            <p className="text-xs text-red-400">
              ⚠️ Could not generate suggestions: {suggestionError}
            </p>
          </div>
        )}

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

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

