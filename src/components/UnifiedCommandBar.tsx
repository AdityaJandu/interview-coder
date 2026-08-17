/**
 * UnifiedCommandBar - Single command bar combining conversation controls
 * and screenshot/solution controls into one row.
 * Replaces ConversationCommands + QueueCommands + SolutionCommands.
 */
import React, { useState, useEffect, useRef } from "react";
import { useToast } from "../contexts/toast";
import { LanguageSelector } from "./shared/LanguageSelector";
import { COMMAND_KEY } from "../utils/platform";
import { supabase } from "../lib/supabase";
import { SettingsDialog } from "./Settings/SettingsDialog";

interface UnifiedCommandBarProps {
  // Conversation controls
  isRecording: boolean;
  conversationProcessing: boolean;
  recordingDuration: number;
  currentSpeaker: 'interviewer' | 'interviewee';
  isMuted: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<void>;
  onToggleSpeaker: () => Promise<void>;
  onToggleMute: () => Promise<void>;
  onClearConversation: () => Promise<void>;

  // Screenshot/Solution controls
  screenshotCount: number;
  hasSolution: boolean;
  solutionProcessing: boolean;
  credits: number;
  currentLanguage: string;
  setLanguage: (language: string) => void;
}

const UnifiedCommandBar: React.FC<UnifiedCommandBarProps> = ({
  isRecording,
  conversationProcessing,
  recordingDuration,
  currentSpeaker,
  isMuted,
  onStartRecording,
  onStopRecording,
  onToggleSpeaker,
  onToggleMute,
  onClearConversation,
  screenshotCount,
  hasSolution,
  solutionProcessing,
  credits,
  currentLanguage,
  setLanguage,
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      await onStopRecording();
    } else {
      await onStartRecording();
    }
  };

  const handleSignOut = async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err) {
      console.error("Error signing out:", err);
    }
  };

  const handleOpenSettings = () => {
    // Close the hover tooltip first so it doesn't linger under the dialog,
    // then open the actual Settings dialog (instead of the old external
    // "settings portal" link, which didn't exist for local settings).
    setIsTooltipVisible(false);
    setIsSettingsOpen(true);
  };

  return (
    <div>
      <div className="pt-2 w-fit">
        <div className="text-xs text-white/90 backdrop-blur-md bg-black/60 rounded-lg py-1.5 px-3 flex items-center justify-center gap-2 flex-wrap">

          {/* ── Conversation Controls ── */}

          {/* Start/Stop Recording */}
          <div
            className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
            onClick={handleToggleRecording}
          >
            <span className="text-[11px] leading-none">
              {isRecording ? `Stop (${formatDuration(recordingDuration)})` : 'Start Recording'}
            </span>
            <div className="flex gap-1">
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                M
              </button>
            </div>
          </div>

          {/* Toggle Speaker Mode */}
          <div
            className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
            onClick={onToggleSpeaker}
            style={{ opacity: isRecording || isMuted ? 0.5 : 1, pointerEvents: isRecording || isMuted ? 'none' : 'auto' }}
          >
            <span className="text-[11px] leading-none">
              {currentSpeaker === 'interviewer' ? 'Interviewer' : 'You'}
            </span>
            <div className="flex gap-1">
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                ⇧
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                M
              </button>
            </div>
          </div>

          {/* Mute My Voice */}
          <div
            className={`flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 transition-colors ${isMuted
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'hover:bg-white/10 text-white/90'
              }`}
            onClick={onToggleMute}
            title="Mute My Voice (Interviewer Only Mode)"
          >
            <span className="text-[11px] leading-none font-medium">
              {isMuted ? '🔇 Interviewer Only' : '🎤 Mute'}
            </span>
          </div>

          {/* Clear */}
          <div
            className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
            onClick={onClearConversation}
          >
            <span className="text-[11px] leading-none">Clear</span>
          </div>

          {/* ── Separator ── */}
          <div className="mx-1 h-4 w-px bg-white/20" />

          {/* ── Screenshot / Solution Controls ── */}

          {/* Screenshot */}
          <div
            className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
            onClick={async () => {
              try {
                const result = await window.electronAPI.triggerScreenshot();
                if (!result.success) {
                  showToast("Error", "Failed to take screenshot", "error");
                }
              } catch (error) {
                showToast("Error", "Failed to take screenshot", "error");
              }
            }}
          >
            <span className="text-[11px] leading-none truncate">
              {screenshotCount === 0 ? "Screenshot" : `Screenshot (${screenshotCount})`}
            </span>
            <div className="flex gap-1">
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                H
              </button>
            </div>
          </div>

          {/* Solve / Debug (conditional) */}
          {screenshotCount > 0 && !solutionProcessing && (
            <div
              className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
              onClick={async () => {
                try {
                  const result = await window.electronAPI.triggerProcessScreenshots();
                  if (!result.success) {
                    showToast("Error", "Failed to process screenshots", "error");
                  }
                } catch (error) {
                  showToast("Error", "Failed to process screenshots", "error");
                }
              }}
            >
              <span className="text-[11px] leading-none">
                {hasSolution ? "Debug" : "Solve"}
              </span>
              <div className="flex gap-1">
                <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                  {COMMAND_KEY}
                </button>
                <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                  ↵
                </button>
              </div>
            </div>
          )}

          {/* Start Over */}
          <div
            className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
            onClick={async () => {
              try {
                const result = await window.electronAPI.triggerReset();
                if (!result.success) {
                  showToast("Error", "Failed to reset", "error");
                }
              } catch (error) {
                showToast("Error", "Failed to reset", "error");
              }
            }}
          >
            <span className="text-[11px] leading-none">Start Over</span>
            <div className="flex gap-1">
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                R
              </button>
            </div>
          </div>

          {/* ── Separator ── */}
          <div className="mx-1 h-4 w-px bg-white/20" />

          {/* Show/Hide */}
          <div
            className="flex items-center gap-1.5 cursor-pointer rounded px-2 py-1 hover:bg-white/10 transition-colors"
            onClick={async () => {
              try {
                const result = await window.electronAPI.toggleMainWindow();
                if (!result.success) {
                  showToast("Error", "Failed to toggle window", "error");
                }
              } catch (error) {
                showToast("Error", "Failed to toggle window", "error");
              }
            }}
          >
            <span className="text-[11px] leading-none">Show/Hide</span>
            <div className="flex gap-1">
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                B
              </button>
            </div>
          </div>

          {/* Settings Gear */}
          <div
            className="relative inline-block"
            onMouseEnter={() => setIsTooltipVisible(true)}
            onMouseLeave={() => setIsTooltipVisible(false)}
          >
            <div className="w-4 h-4 flex items-center justify-center cursor-pointer text-white/70 hover:text-white/90 transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>

            {/* Settings Tooltip */}
            {isTooltipVisible && (
              <div
                ref={tooltipRef}
                className="absolute top-full right-0 mt-2 w-64"
                style={{ zIndex: 9999 }}
              >
                <div className="absolute -top-2 right-0 w-full h-2" />
                <div className="p-3 text-xs bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-white/90 shadow-lg">
                  <div className="space-y-3">
                    <LanguageSelector
                      currentLanguage={currentLanguage}
                      setLanguage={setLanguage}
                    />

                    <div className="px-2 space-y-1">
                      <div className="flex items-center justify-between text-[13px] font-medium text-white/90">
                        <span>API & Model Settings</span>
                        <button
                          className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-[11px]"
                          onClick={handleOpenSettings}
                        >
                          Settings
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-white/10">
                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 text-[11px] text-red-400 hover:text-red-300 transition-colors w-full"
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </div>
                        Log Out
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {conversationProcessing && (
            <span className="text-[11px] text-white/70">Processing...</span>
          )}
        </div>
      </div>

      {/* Settings Dialog - portaled to document.body, so it's independent
          of this bar's stacking context and always renders on top */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
};

export default UnifiedCommandBar;
