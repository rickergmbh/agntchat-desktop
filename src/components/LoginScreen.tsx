import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import { Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { LEGAL_URLS } from "../lib/legal";

/** Open a URL in the system browser — Tauri native with window.open fallback. */
function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

export function LoginScreen() {
  const { t } = useTranslation("auth");
  const { login, signup, loading, error, confirmationMessage } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [consentError, setConsentError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignup) {
      if (!acceptedTerms) {
        setConsentError(true);
        return;
      }
      await signup(email, password, displayName || undefined, {
        acceptedTerms: true,
        marketingOptIn,
      });
    } else {
      await login(email, password);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-bg">
      <Card className="w-[400px] p-10">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-text">Simplifi</h1>
        </div>
        <p className="text-text-secondary text-sm mb-8">{t("tagline")}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <div className="space-y-1.5">
              <Label htmlFor="displayName">{t("displayName")}</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("placeholders.yourName")}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("password")}
              required
            />
          </div>

          {isSignup && (
            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    if (e.target.checked) setConsentError(false);
                  }}
                  className="mt-0.5 rounded border-border"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-text">{t("consent.label")}</span>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => openExternal(LEGAL_URLS.terms)}
                      className="text-accent hover:text-accent-hover underline"
                    >
                      {t("consent.terms")}
                    </button>
                    <span className="text-text-secondary">·</span>
                    <button
                      type="button"
                      onClick={() => openExternal(LEGAL_URLS.privacy)}
                      className="text-accent hover:text-accent-hover underline"
                    >
                      {t("consent.privacy")}
                    </button>
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 rounded border-border"
                />
                <span className="flex-1 min-w-0 text-sm text-text-secondary">
                  {t("consent.marketing")}
                </span>
              </label>

              {consentError && (
                <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
                  {t("consent.required")}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
              {error}
            </div>
          )}

          {/* Signup succeeded but the account needs email confirmation —
              no token was issued, so stay on this form and tell the user
              to check their inbox, then sign in. */}
          {confirmationMessage !== null && (
            <div className="text-sm text-info bg-info/10 px-3 py-2 rounded-md">
              {confirmationMessage || t("confirmationSent")}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? t("signingIn")
              : isSignup
                ? t("createAccount")
                : t("signIn")}
          </Button>
        </form>

        <Button
          variant="ghost"
          className="w-full mt-4 text-accent hover:text-accent-hover"
          onClick={() => {
            setIsSignup(!isSignup);
            setConsentError(false);
            useAuthStore.setState({ error: null, confirmationMessage: null });
          }}
        >
          {isSignup
            ? `${t("alreadyHaveAccount")} ${t("signIn")}`
            : `${t("dontHaveAccount")} ${t("signUp")}`}
        </Button>
      </Card>
    </div>
  );
}
