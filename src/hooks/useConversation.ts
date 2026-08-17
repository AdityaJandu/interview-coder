/**
 * useConversation - Custom hook for conversation recording and AI suggestions
 * Extracted from ConversationSection to enable the unified command bar pattern.
 * All recording, transcription, and suggestion logic lives here.
 */
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface ConversationMessage {
  id: string;
  speaker: 'interviewer' | 'interviewee';
  text: string;
  timestamp: number;
  edited?: boolean;
}

export interface AISuggestion {
  suggestions: string[];
  reasoning: string;
}

export function useConversation() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<'interviewer' | 'interviewee'>('interviewee');
  const [isMuted, setIsMuted] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

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

  // Sync mute state with ref and audio tracks
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
      if (force) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        // Only auto-scroll if the user is near the bottom of the nearest scrollable ancestor
        const el = messagesEndRef.current;
        let container = el.parentElement;
        while (container && container.scrollHeight <= container.clientHeight) {
          container = container.parentElement;
        }
        if (container) {
          const isNearBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 150;
          if (isNearBottom) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        }
      }
    }
  };

  useEffect(() => {
    scrollToBottom(false);
  }, [messages, liveTranscript]);

  // Load conversation and set up event listeners
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

  // Suggestion event listeners
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

  return {
    // State
    messages,
    isRecording,
    currentSpeaker,
    isMuted,
    aiSuggestions,
    isProcessing,
    suggestionError,
    recordingDuration,
    liveTranscript,
    // Refs (needed by display component)
    messagesEndRef,
    processSpeakerRef,
    // Handlers
    handleStartRecording,
    handleStopRecording,
    handleTriggerAnswerNow,
    handleToggleSpeaker,
    handleToggleMute,
    handleClearConversation,
    // Utilities
    formatTime,
  };
}
