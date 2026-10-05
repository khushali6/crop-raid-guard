import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowRight, Languages, Loader2, MailCheck, Sprout } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FullPageLoader, Workspace, useWorkspace } from "@/components/workspace";
import { Heading } from "@/components/common";
import { fieldImage } from "@/lib/demo";
import { CROPS, errorText } from "@/lib/data";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { Language } from "@/lib/types";

type Mode = "signin" | "signup" | "reset";

function safeRedirect(path: string | undefined) {
  return path && path.startsWith("/") && !path.startsWith("//") && path !== "/login" ? path : "/";
}

export function Login({ redirect }: { redirect?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { ready, session, profile } = useWorkspace();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<"signup" | "reset" | null>(null);

  useEffect(() => {
    if (!ready || !session || !profile) return;
    if (profile.onboarded) router.history.replace(safeRedirect(redirect));
    else void navigate({ to: "/onboarding" });
  }, [ready, session, profile, redirect, navigate, router]);

  if (!ready && supabaseConfigured) return <FullPageLoader label="Checking your session…" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const origin = window.location.origin;
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error)
          throw new Error(
            error.message === "Invalid login credentials"
              ? "That email and password don’t match."
              : error.message,
          );
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${origin}/onboarding` },
        });
        if (error) throw new Error(error.message);
        if (!data.session) setSent("signup");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${origin}/settings#password`,
        });
        if (error) throw new Error(error.message);
        setSent("reset");
      }
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, [string, string]> = {
    signin: ["Welcome back.", "Your fields have a story to tell."],
    signup: ["Start watching closer.", "A free workspace for your fields and camera footage."],
    reset: ["Forgot your password?", "We’ll email you a link to choose a new one."],
  };

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <Sprout size={30} className="mb-6 text-primary" />
        {sent ? (
          <>
            <h1>Check your email.</h1>
            <p>
              {sent === "signup"
                ? `We sent a confirmation link to ${email}. Open it on this device to finish creating your account.`
                : `If an account exists for ${email}, a reset link is on its way.`}
            </p>
            <MailCheck className="my-6 text-primary" size={26} />
            <Button
              variant="outline"
              onClick={() => {
                setSent(null);
                setMode("signin");
              }}
            >
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <h1>{titles[mode][0]}</h1>
            <p>{titles[mode][1]}</p>
            {mode !== "reset" && (
              <div className="segmented auth-toggle" role="tablist">
                {(["signin", "signup"] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant="ghost"
                    role="tab"
                    aria-selected={mode === m}
                    className={mode === m ? "selected" : ""}
                    onClick={() => setMode(m)}
                  >
                    {m === "signin" ? "Sign in" : "Create account"}
                  </Button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => void submit(e)}>
              {mode === "signup" && (
                <label>
                  Your name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                    autoComplete="name"
                    placeholder="e.g. Ramesh Patel"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
              {mode !== "reset" && (
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    placeholder={
                      mode === "signin" ? "Enter your password" : "At least 8 characters"
                    }
                  />
                </label>
              )}
              <Button type="submit" disabled={busy || !supabaseConfigured}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create free account"
                    : "Send reset link"}
                {!busy && <ArrowRight />}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-5">
              {mode === "reset" ? (
                <button type="button" className="inline-link" onClick={() => setMode("signin")}>
                  Back to sign in
                </button>
              ) : mode === "signin" ? (
                <button type="button" className="inline-link" onClick={() => setMode("reset")}>
                  Forgot your password?
                </button>
              ) : (
                "Your footage stays private to your workspace."
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const LANGUAGES: { id: Language; label: string; hint: string }[] = [
  { id: "en", label: "English", hint: "Alerts and answers in English" },
  { id: "hi", label: "हिन्दी", hint: "अलर्ट और जवाब हिन्दी में" },
  { id: "gu", label: "ગુજરાતી", hint: "ચેતવણી અને જવાબ ગુજરાતીમાં" },
];

export function Onboarding() {
  const navigate = useNavigate();
  const { profile, displayName, fields, addField, refreshProfile } = useWorkspace();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(profile?.full_name ?? displayName);
  const [language, setLanguage] = useState<Language>(profile?.language ?? "en");
  const [field, setField] = useState("");
  const [crop, setCrop] = useState("Maize");
  const [village, setVillage] = useState("");
  const [busy, setBusy] = useState(false);

  const finishing = useRef(false);

  useEffect(() => {
    if (profile?.onboarded && !finishing.current) void navigate({ to: "/" });
  }, [profile?.onboarded, navigate]);

  const saveProfile = async (patch: Record<string, unknown>) => {
    if (!profile) throw new Error("Your profile is still loading.");
    const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
    if (error) throw new Error(error.message);
  };

  const next = async () => {
    setBusy(true);
    try {
      if (step === 1) {
        await saveProfile({ full_name: name.trim() || null, language });
        setStep(2);
      } else if (step === 2) {
        if (field.trim()) {
          await addField({ name: field, crop, village });
          setField("");
          setVillage("");
        }
        setStep(3);
      } else {
        finishing.current = true;
        await saveProfile({ onboarded: true });
        await refreshProfile();
        void navigate({ to: fields.length ? "/upload" : "/" });
      }
    } catch (err) {
      finishing.current = false;
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Workspace>
      <div className="form-page">
        <span className="intro-number">0{step}</span>
        <Heading
          title={
            step === 1
              ? "Nice to meet you."
              : step === 2
                ? "Give your field a name."
                : "You’re ready to look closer."
          }
          description={
            step === 1
              ? "Tell us what to call you and which language you prefer."
              : step === 2
                ? "A little context makes a clearer picture. You can add more fields later."
                : "Upload a camera-trap or phone video and we’ll find the animals in it."
          }
        />
        {step === 1 ? (
          <div className="my-8">
            <div className="form-grid">
              <label className="full">
                Your name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Ramesh Patel"
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2">
              {LANGUAGES.map((l) => (
                <Button
                  key={l.id}
                  variant={language === l.id ? "default" : "outline"}
                  onClick={() => setLanguage(l.id)}
                  className="h-auto flex-col py-3"
                  aria-pressed={language === l.id}
                >
                  <span className="flex items-center gap-2">
                    <Languages />
                    {l.label}
                  </span>
                  <small className="opacity-75 font-normal">{l.hint}</small>
                </Button>
              ))}
            </div>
          </div>
        ) : step === 2 ? (
          <div className="form-grid">
            <label>
              Field name
              <input
                value={field}
                onChange={(e) => setField(e.target.value)}
                placeholder="North Field"
                maxLength={60}
              />
            </label>
            <label>
              Crop type
              <select value={crop} onChange={(e) => setCrop(e.target.value)}>
                {CROPS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Village or region (optional)
              <input
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="e.g. Sanand, Ahmedabad"
                maxLength={120}
              />
            </label>
          </div>
        ) : (
          <div className="hero-landscape mb-8">
            <img src={fieldImage} alt="A field ready to monitor" />
          </div>
        )}
        <Button onClick={() => void next()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {step === 1
            ? "Continue"
            : step === 2
              ? field.trim()
                ? "Create field"
                : "Skip for now"
              : "Upload my first video"}
          {!busy && <ArrowRight />}
        </Button>
        {step > 1 && (
          <Button
            variant="ghost"
            className="ml-3"
            onClick={() => setStep(step - 1)}
            disabled={busy}
          >
            Back
          </Button>
        )}
      </div>
    </Workspace>
  );
}
