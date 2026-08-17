import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useToast } from "../../contexts/toast";
import { CandidateProfileSection, CandidateProfile } from "./CandidateProfileSection";
import {
  APIProvider,
  AIModel,
  MODEL_CATEGORIES,
  DEFAULT_MODELS,
} from "../../../shared/aiModels";

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState<APIProvider>("openai");
  const [extractionModel, setExtractionModel] = useState(
    DEFAULT_MODELS.openai.extractionModel
  );
  const [solutionModel, setSolutionModel] = useState(
    DEFAULT_MODELS.openai.solutionModel
  );
  const [debuggingModel, setDebuggingModel] = useState(
    DEFAULT_MODELS.openai.debuggingModel
  );
  const [answerModel, setAnswerModel] = useState(
    DEFAULT_MODELS.openai.answerModel
  );
  const [speechRecognitionModel, setSpeechRecognitionModel] = useState("whisper-1");
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile>({
    name: "",
    resume: "",
    jobDescription: ""
  });
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);

      // Force window resize for Settings Dialog when opened externally
      if (externalOpen) {
        setTimeout(() => {
          const maxWidth = Math.floor((window.screen.availWidth || 1920) * 0.8);
          const maxHeight = Math.floor((window.screen.availHeight || 1080) * 0.9);
          window.electronAPI?.updateContentDimensions({
            width: Math.min(1200, maxWidth),
            height: Math.min(900, maxHeight)
          });
        }, 50);
      }
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }

    // Force window resize for Settings Dialog
    if (newOpen) {
      setTimeout(() => {
        const maxWidth = Math.floor((window.screen.availWidth || 1920) * 0.8);
        const maxHeight = Math.floor((window.screen.availHeight || 1080) * 0.9);
        window.electronAPI?.updateContentDimensions({
          width: Math.min(1200, maxWidth),
          height: Math.min(900, maxHeight)
        });
      }, 50);
    }
  }, [externalOpen, onOpenChange]);

  // Handle Escape Key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        handleOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleOpenChange]);

  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKey?: string;
        apiProvider?: APIProvider;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
        answerModel?: string;
        speechRecognitionModel?: string;
        candidateProfile?: CandidateProfile;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setApiKey(config.apiKey || "");
          const provider: APIProvider = config.apiProvider || "openai";
          setApiProvider(provider);
          const providerDefaults = DEFAULT_MODELS[provider];
          setExtractionModel(
            config.extractionModel || providerDefaults.extractionModel
          );
          setSolutionModel(
            config.solutionModel || providerDefaults.solutionModel
          );
          setDebuggingModel(
            config.debuggingModel || providerDefaults.debuggingModel
          );
          setAnswerModel(
            config.answerModel || providerDefaults.answerModel
          );
          setSpeechRecognitionModel(
            config.speechRecognitionModel ||
            providerDefaults.speechRecognitionModel ||
            (config.apiProvider === "gemini" ? "gemini-3-flash-preview" : "whisper-1")
          );
          setCandidateProfile(config.candidateProfile || {
            name: "",
            resume: "",
            jobDescription: ""
          });
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, showToast]);

  // Handle API provider change
  const handleProviderChange = (provider: APIProvider) => {
    setApiProvider(provider);

    // Reset models to defaults when changing provider
    const defaults = DEFAULT_MODELS[provider];
    setExtractionModel(defaults.extractionModel);
    setSolutionModel(defaults.solutionModel);
    setDebuggingModel(defaults.debuggingModel);
    setAnswerModel(defaults.answerModel);
    setSpeechRecognitionModel(
      defaults.speechRecognitionModel ||
      (provider === "gemini" ? "gemini-3-flash-preview" : "whisper-1")
    );
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        apiProvider,
        extractionModel,
        solutionModel,
        debuggingModel,
        answerModel,
        speechRecognitionModel,
        candidateProfile,
      });

      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);

        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  if (!open) return null;

  return createPortal(
    <div
      // isolate creates a new stacking context so nothing inside this dialog
      // can be out-ranked by a descendant's z-index, and z-[2147483647]
      // (max 32-bit int) guarantees this portal wins over every other
      // fixed/absolute-positioned element mounted on document.body.
      className={`fixed inset-0 z-[2147483647] isolate bg-zinc-950/95 backdrop-blur-md overflow-y-auto p-6 sm:p-8 transition-all duration-300 ${open ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        }`}
    >
      {/* Top Bar Header */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10 max-w-7xl w-full mx-auto">
        <div>
          <h2 className="text-2xl font-bold text-white">Settings</h2>
          <p className="text-sm text-white/70 mt-0.5">
            Configure your API provider, keys, models, and candidate profile.
          </p>
        </div>
        <button
          onClick={() => handleOpenChange(false)}
          className="text-white/60 hover:text-white p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-lg"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Main Content Area - 2 Column Grid */}
      <div className="my-6 pr-2 max-w-7xl w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* LEFT COLUMN: Provider, Keys, Shortcuts */}
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-white">API Settings</h3>
              <p className="text-xs text-white/60">
                Choose your provider and add your secret API key.
              </p>
            </div>

            {/* Provider Selection Cards */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                API Provider
              </label>
              <div className="grid grid-cols-3 gap-3">
                <div
                  className={`p-3 rounded-lg cursor-pointer transition-all ${apiProvider === "openai"
                    ? "bg-white/10 border-2 border-white/40 shadow-lg"
                    : "bg-black/40 border border-white/10 hover:bg-white/5"
                    }`}
                  onClick={() => handleProviderChange("openai")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${apiProvider === "openai" ? "bg-white" : "bg-white/20"
                        }`}
                    />
                    <div>
                      <p className="font-medium text-white text-sm">OpenAI</p>
                      <p className="text-[11px] text-white/60">GPT-4o</p>
                    </div>
                  </div>
                </div>

                <div
                  className={`p-3 rounded-lg cursor-pointer transition-all ${apiProvider === "gemini"
                    ? "bg-white/10 border-2 border-white/40 shadow-lg"
                    : "bg-black/40 border border-white/10 hover:bg-white/5"
                    }`}
                  onClick={() => handleProviderChange("gemini")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${apiProvider === "gemini" ? "bg-white" : "bg-white/20"
                        }`}
                    />
                    <div>
                      <p className="font-medium text-white text-sm">Gemini</p>
                      <p className="text-[11px] text-white/60">Gemini 3</p>
                    </div>
                  </div>
                </div>

                <div
                  className={`p-3 rounded-lg cursor-pointer transition-all ${apiProvider === "anthropic"
                    ? "bg-white/10 border-2 border-white/40 shadow-lg"
                    : "bg-black/40 border border-white/10 hover:bg-white/5"
                    }`}
                  onClick={() => handleProviderChange("anthropic")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${apiProvider === "anthropic" ? "bg-white" : "bg-white/20"
                        }`}
                    />
                    <div>
                      <p className="font-medium text-white text-sm">Claude</p>
                      <p className="text-[11px] text-white/60">Claude 3</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* API Key Input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/80" htmlFor="apiKey">
                {apiProvider === "openai"
                  ? "OpenAI API Key"
                  : apiProvider === "gemini"
                    ? "Gemini API Key"
                    : "Anthropic API Key"}
              </label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  apiProvider === "openai"
                    ? "sk-..."
                    : apiProvider === "gemini"
                      ? "Enter your Gemini API key"
                      : "sk-ant-..."
                }
                className="bg-black/50 border-white/10 text-white h-10 px-3"
              />
              {apiKey && (
                <p className="text-xs text-white/50">Current: {maskApiKey(apiKey)}</p>
              )}

              <div className="p-3 rounded-lg bg-white/5 border border-white/10 mt-2">
                <p className="text-xs font-semibold text-white/90 mb-1">How to get a key?</p>
                {apiProvider === "openai" ? (
                  <p className="text-xs text-white/60">
                    Sign up at{" "}
                    <button
                      onClick={() => openExternalLink("https://platform.openai.com/signup")}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      OpenAI
                    </button>
                    , navigate to{" "}
                    <button
                      onClick={() => openExternalLink("https://platform.openai.com/api-keys")}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      API Keys
                    </button>
                    , and generate a new secret key.
                  </p>
                ) : apiProvider === "gemini" ? (
                  <p className="text-xs text-white/60">
                    Sign up at{" "}
                    <button
                      onClick={() => openExternalLink("https://aistudio.google.com/")}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      Google AI Studio
                    </button>
                    , navigate to{" "}
                    <button
                      onClick={() => openExternalLink("https://aistudio.google.com/app/apikey")}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      API Keys
                    </button>
                    , and create a new key.
                  </p>
                ) : (
                  <p className="text-xs text-white/60">
                    Sign up at{" "}
                    <button
                      onClick={() => openExternalLink("https://console.anthropic.com/signup")}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      Anthropic
                    </button>
                    , navigate to{" "}
                    <button
                      onClick={() => openExternalLink("https://console.anthropic.com/settings/keys")}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      API Keys
                    </button>
                    , and copy your key.
                  </p>
                )}
              </div>
            </div>

            {/* Keyboard Shortcuts */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                Keyboard Shortcuts
              </label>
              <div className="bg-black/40 border border-white/10 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="text-white/70">Toggle Visibility</div>
                  <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>

                  <div className="text-white/70">Take Screenshot</div>
                  <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>

                  <div className="text-white/70">Start/Stop Recording</div>
                  <div className="text-white/90 font-mono">Ctrl+M / Cmd+M</div>

                  <div className="text-white/70">Toggle Speaker Mode</div>
                  <div className="text-white/90 font-mono">Ctrl+Shift+M / Cmd+Shift+M</div>

                  <div className="text-white/70">Process Screenshots</div>
                  <div className="text-white/90 font-mono">Ctrl+Enter / Cmd+Enter</div>

                  <div className="text-white/70">Delete Last Screenshot</div>
                  <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>

                  <div className="text-white/70">Reset View</div>
                  <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>

                  <div className="text-white/70">Quit Application</div>
                  <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: AI Models & Candidate Profile */}
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-semibold text-white mb-1">AI Model Selection</h3>
              <p className="text-xs text-white/60 mb-4">
                Select specific models for extraction, solution synthesis, and speech recognition.
              </p>

              <div className="space-y-4">
                {MODEL_CATEGORIES.map((category) => {
                  const models: AIModel[] = category.modelsByProvider[apiProvider];

                  return (
                    <div key={category.key} className="space-y-1.5">
                      <label className="text-xs font-medium text-white/90">
                        {category.title}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {models.map((m) => {
                          const currentValue =
                            category.key === "extractionModel"
                              ? extractionModel
                              : category.key === "solutionModel"
                                ? solutionModel
                                : category.key === "debuggingModel"
                                  ? debuggingModel
                                  : answerModel;

                          const setValue =
                            category.key === "extractionModel"
                              ? setExtractionModel
                              : category.key === "solutionModel"
                                ? setSolutionModel
                                : category.key === "debuggingModel"
                                  ? setDebuggingModel
                                  : setAnswerModel;

                          return (
                            <div
                              key={m.id}
                              className={`p-2.5 rounded-lg cursor-pointer transition-colors ${currentValue === m.id
                                ? "bg-white/10 border border-white/30"
                                : "bg-black/30 border border-white/5 hover:bg-white/5"
                                }`}
                              onClick={() => setValue(m.id)}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={`w-2.5 h-2.5 rounded-full ${currentValue === m.id ? "bg-white" : "bg-white/20"
                                    }`}
                                />
                                <div className="truncate">
                                  <p className="font-medium text-white text-xs truncate">
                                    {m.name}
                                  </p>
                                  <p className="text-[11px] text-white/50 truncate">
                                    {m.description}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Speech Recognition Model Section */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                Speech Recognition Model
              </label>
              {apiProvider === "openai" ? (
                <div
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${speechRecognitionModel === "whisper-1"
                    ? "bg-white/10 border border-white/30"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                    }`}
                  onClick={() => setSpeechRecognitionModel("whisper-1")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${speechRecognitionModel === "whisper-1" ? "bg-white" : "bg-white/20"
                        }`}
                    />
                    <div>
                      <p className="font-medium text-white text-xs">Whisper-1</p>
                      <p className="text-xs text-white/60">OpenAI's high-accuracy speech-to-text model</p>
                    </div>
                  </div>
                </div>
              ) : apiProvider === "gemini" ? (
                <div className="grid grid-cols-2 gap-2">
                  {["gemini-1.5-flash", "gemini-1.5-pro", "gemini-3-flash-preview", "gemini-3-pro-preview"].map(
                    (modelId) => (
                      <div
                        key={modelId}
                        className={`p-2.5 rounded-lg cursor-pointer transition-colors ${speechRecognitionModel === modelId
                          ? "bg-white/10 border border-white/30"
                          : "bg-black/30 border border-white/5 hover:bg-white/5"
                          }`}
                        onClick={() => setSpeechRecognitionModel(modelId)}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${speechRecognitionModel === modelId ? "bg-white" : "bg-white/20"
                              }`}
                          />
                          <p className="font-medium text-white text-xs capitalize">
                            {modelId.replace(/-/g, " ")}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-black/30 border border-white/10">
                  <p className="text-xs text-white/60">
                    Speech recognition is only supported with OpenAI or Gemini.
                  </p>
                </div>
              )}
            </div>

            {/* Candidate Profile Section */}
            <div className="border-t border-white/10 pt-4 space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                Candidate Profile
              </label>
              <p className="text-xs text-white/60">
                Add your resume and job requirements for personalized interview answers.
              </p>
              <CandidateProfileSection
                profile={candidateProfile}
                onProfileChange={setCandidateProfile}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-4 border-t border-white/10 flex justify-end gap-3 max-w-7xl w-full mx-auto">
        <Button
          variant="outline"
          onClick={() => handleOpenChange(false)}
          className="px-6 border-white/10 hover:bg-white/5 text-white"
        >
          Cancel
        </Button>
        <Button
          className="px-8 bg-white text-black font-semibold hover:bg-white/90 transition-colors"
          onClick={handleSave}
          disabled={isLoading || !apiKey}
        >
          {isLoading ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>,
    document.body
  );
}
