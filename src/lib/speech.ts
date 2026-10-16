"use client";

/**
 * Browser speech helpers (Web Speech API). Everything runs on the device;
 * nothing is sent to ANVIL's server. Feature-detected: callers should hide
 * controls when `canSpeak()` / `canListen()` is false.
 */

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Hindi if the text contains Devanagari, otherwise Indian English. */
export function guessLang(text: string): string {
  return /[ऀ-ॿ]/.test(text) ? "hi-IN" : "en-IN";
}

export function speak(text: string, lang = guessLang(text), onEnd?: () => void): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\[[ACSV]\d{1,2}\]/g, "").replace(/https?:\/\/\S+/g, "");
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = lang;
  u.rate = 0.95;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === lang) ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
  }
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return recognitionCtor() !== null;
}

/** One-shot voice input. Returns a stop function. */
export function listenOnce(lang: string, onText: (t: string) => void, onDone: (error?: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onDone("Voice input is not supported in this browser.");
    return () => undefined;
  }
  const r = new Ctor();
  r.lang = lang;
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    const t = e.results[0]?.[0]?.transcript;
    if (t) onText(t);
  };
  r.onerror = (e) => onDone(e.error === "not-allowed" ? "Microphone permission was denied." : `Voice input error: ${e.error}`);
  r.onend = () => onDone();
  r.start();
  return () => r.stop();
}