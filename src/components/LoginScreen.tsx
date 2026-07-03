import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import { Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export function LoginScreen() {
  const { t } = useTranslation("auth");
  const { login, signup, loading, error } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignup) {
      await signup(email, password, displayName || undefined);
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

          {error && (
            <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
              {error}
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
            useAuthStore.setState({ error: null });
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
