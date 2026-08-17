/**
 * ConversationSection - Display-only component for conversation messages and AI suggestions.
 * Recording logic has been extracted to useConversation hook.
 * This component only renders the conversation feed content.
 */
import React from 'react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { ContentSection } from '../shared/SolutionComponents';
import { ConversationMessage, AISuggestion } from '../../hooks/useConversation';

interface ConversationSectionProps {
  messages: ConversationMessage[];
  liveTranscript: string;
  isMuted: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  aiSuggestions: AISuggestion | null;
  suggestionError: string | null;
  processSpeakerRef: React.MutableRefObject<'interviewer' | 'interviewee'>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onTriggerAnswerNow: () => void;
  formatTime: (timestamp: number) => string;
}

export const ConversationSection: React.FC<ConversationSectionProps> = ({
  messages,
  liveTranscript,
  isMuted,
  isRecording,
  isProcessing,
  aiSuggestions,
  suggestionError,
  processSpeakerRef,
  messagesEndRef,
  onTriggerAnswerNow,
  formatTime,
}) => {
  return (
    <div className="flex flex-col relative">
      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center justify-between px-3 py-2 bg-blue-900/10 border border-blue-500/20 shadow-inner z-10 rounded-md mb-3">
          <span className="text-xs text-blue-300 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            {isMuted ? 'Interviewer Only Mode (Mic Muted)' : 'Mic is live...'}
          </span>
          <button
            onClick={onTriggerAnswerNow}
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

      {/* Conversation Messages */}
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

      {/* Suggestion Error */}
      {suggestionError && (
        <div className="border-t border-red-500/30 mt-3 pt-2 pb-1">
          <p className="text-xs text-red-400">
            ⚠️ Could not generate suggestions: {suggestionError}
          </p>
        </div>
      )}

      {/* AI Suggestions */}
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
  );
};
