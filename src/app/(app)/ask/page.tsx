"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send, ShieldCheck, Sparkles, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { canListen, canSpeak, listenOnce, speak, stopSpeaking } from "@/lib/speech";
import { apiFetch, type ApiError } from "@/hooks/use-api";
import { usePlace, usePrefs } from "@/hooks/use-local-state";
import { ErrorState, NeedsPlace, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, Textarea } from "@/components/ui/primitives";

interface AskResponse {
  answer: string;
  answerable: boolean;
  mode: "AI_GROUNDED" | "SOURCES_ONLY";
  rejectedReason?: string | null;
  sources: { id: string; kind: string; label: string; url: string }[];
  counts: { alerts: number; contacts: number; shelters: number; advisories: number };
  alertsMode: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  data?: AskResponse;
}

const SUGGESTIONS = {
  en: [
    "Is there any active alert for my district right now?",
    "Where is the nearest documented relief camp?",
    "What is the district emergency control room number?",
    "What should my family do if flooding starts tonight?",
  ],
  hi: [
    "क्या मेरे जिले के लिए अभी कोई चेतावनी है?",
    "सबसे नज़दीकी राहत शिविर कहाँ है?",
    "जिला आपातकालीन नियंत्रण कक्ष का नंबर क्या है?",
    "अगर आज रात बाढ़ आए तो मेरा परिवार क्या करे?",
  ],
};

export default function AskPage() {
  const [place] = usePlace();
  const [prefs] = usePrefs();
  const [language, setLanguage] = useState<"en" | "hi">(prefs.language);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [voiceOk, setVoiceOk] = useState({ speak: false, listen: false });
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVoiceOk({ speak: canSpeak(), listen: canListen() });
    return () => stopSpeaking();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  if (!place) {
    return (
      <>
        <PageHeader title="Ask ANVIL" />
        <NeedsPlace what="Ask ANVIL" />
      </>
    );
  }

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 2 || loading) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const r = await apiFetch<AskResponse>("/api/ask", {
        method: "POST",
        timeoutMs: 60_000,
        body: JSON.stringify({ question, language, place: { label: place.label, district: place.district, state: place.state } }),
      });
      setMessages((m) => [...m, { role: "assistant", text: r.answer, data: r }]);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMic = () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    setError(null);
    setListening(true);
    stopRef.current = listenOnce(
      language === "hi" ? "hi-IN" : "en-IN",
      (t) => void ask(t),
      (err) => {
        setListening(false);
        if (err) setError(err);
      },
    );
  };

  const toggleSpeak = (i: number, text: string) => {
    if (speakingIdx === i) {
      stopSpeaking();
      setSpeakingIdx(null);
      return;
    }
    setSpeakingIdx(i);
    speak(text, language === "hi" ? "hi-IN" : "en-IN", () => setSpeakingIdx(null));
  };

  return (
    <>
      <PageHeader
        title="Ask ANVIL"
        description={`Ask about ${place.label} in English or Hindi — by typing or by voice. Answers come only from live official alerts and quote-verified research, with every claim linked to its source.`}
        actions={
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Answer language">
            {(["en", "hi"] as const).map((l) => (
              <button key={l} onClick={() => setLanguage(l)} aria-pressed={language === l} className={cn("rounded px-3 py-1.5 text-sm", language === l && "bg-primary text-primary-foreground")}>
                {l === "en" ? "English" : "हिन्दी"}
              </button>
            ))}
          </div>
        }
      />

      <Card className="flex min-h-[60vh] flex-col">
        <CardContent className="flex flex-1 flex-col gap-3 pt-5">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
              <ShieldCheck className="size-8 text-primary" aria-hidden />
              <p className="max-w-md text-sm text-muted-foreground">
                ANVIL will not guess. If the official sources don&apos;t contain the answer, it says so. Run the research agent first for richer answers about shelters and contacts.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS[language].map((s) => (
                  <Button key={s} size="sm" variant="outline" onClick={() => ask(s)} className="h-auto whitespace-normal py-2 text-left">
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3" aria-live="polite">
              {messages.map((m, i) => (
                <li key={i} className={cn("max-w-[90%] rounded-lg px-4 py-3 text-sm", m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start border bg-card")}>
                  {m.role === "assistant" && m.data ? (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      {m.data.mode === "AI_GROUNDED" ? (
                        <Badge tone="warning"><Sparkles className="size-3" /> AI answer · grounded in cited sources</Badge>
                      ) : (
                        <Badge tone="ok"><ShieldCheck className="size-3" /> Official sources shown directly</Badge>
                      )}
                      {!m.data.answerable ? <Badge tone="neutral">Not in sources</Badge> : null}
                      {voiceOk.speak ? (
                        <button onClick={() => toggleSpeak(i, m.text)} className="ml-auto rounded p-1 hover:bg-muted" aria-label={speakingIdx === i ? "Stop reading" : "Read aloud"}>
                          {speakingIdx === i ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-line">{m.text}</p>
                  {m.data?.sources.length ? (
                    <ul className="mt-3 space-y-1 border-t pt-2 text-xs">
                      {m.data.sources.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                          <Badge>{s.id}</Badge>
                          <span className="text-muted-foreground">{s.label}</span>
                          <SourceLink href={s.url} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.data?.rejectedReason && m.data.mode === "SOURCES_ONLY" ? (
                    <p className="mt-2 text-xs text-muted-foreground">An AI draft was discarded because it {m.data.rejectedReason}.</p>
                  ) : null}
                </li>
              ))}
              {loading ? (
                <li className="flex items-center gap-2 self-start text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Checking official sources…
                </li>
              ) : null}
            </ul>
          )}
          <div ref={endRef} />
        </CardContent>

        <div className="border-t p-3">
          {error ? <div className="mb-2"><ErrorState message={error} /></div> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              rows={2}
              maxLength={500}
              placeholder={language === "hi" ? "अपना प्रश्न लिखें…" : "Type your question…"}
              aria-label="Your question"
              className="resize-none"
            />
            {voiceOk.listen ? (
              <Button type="button" variant={listening ? "danger" : "outline"} size="icon" onClick={toggleMic} aria-label={listening ? "Stop voice input" : "Ask by voice"}>
                {listening ? <MicOff /> : <Mic />}
              </Button>
            ) : null}
            <Button type="submit" size="icon" disabled={loading || input.trim().length < 2} aria-label="Send">
              {loading ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            In an emergency call <a href="tel:112" className="font-semibold text-danger">112</a>. Voice input and read-aloud use your browser's built-in speech service. ANVIL stores no chat history.
          </p>
        </div>
      </Card>
    </>
  );
}