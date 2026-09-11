"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { card, input, buttonPrimary, bannerNeutral, bannerWarn } from "@/lib/ui";

type Step = "verifying" | "failed" | "new-password" | "password-updated";

/**
 * Cible du lien envoyé par email — confirmation d'inscription ET réinitialisation de mot de
 * passe partagent cette même URL (voir login/actions.ts:requestPasswordReset, déjà autorisée côté
 * Supabase Auth pour la confirmation, pas la peine d'en enregistrer une deuxième) : `type`
 * distingue les deux cas ("signup" vs "recovery") une fois la session établie. Le template par
 * défaut de Supabase (aucun SMTP personnalisé configuré) délivre la session via un fragment d'URL
 * (#access_token=...), lisible seulement côté client — d'où la page client plutôt qu'une route
 * serveur. Repli sur token_hash/type (flux OTP) si jamais le format change un jour.
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("verifying");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const hashType = hashParams.get("type");

    const searchParams = new URLSearchParams(window.location.search);
    const tokenHash = searchParams.get("token_hash");
    const searchType = searchParams.get("type");

    async function confirm() {
      const supabase = createClient();
      let type: string | null = null;

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return setStep("failed");
        type = hashType;
      } else if (tokenHash && searchType) {
        const { error } = await supabase.auth.verifyOtp({ type: searchType as EmailOtpType, token_hash: tokenHash });
        if (error) return setStep("failed");
        type = searchType;
      } else {
        return setStep("failed");
      }

      if (type === "recovery") {
        setStep("new-password");
      } else {
        router.replace("/login?confirmed=1");
      }
    }

    confirm();
  }, [router]);

  async function handleNewPassword(formData: FormData) {
    setPasswordError(null);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");

    if (password.length < 6) {
      setPasswordError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setIsPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setIsPending(false);

    if (error) {
      setPasswordError("Une erreur est survenue, réessaie.");
      return;
    }
    setStep("password-updated");
  }

  if (step === "verifying") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-mute">Vérification en cours...</p>
      </main>
    );
  }

  if (step === "new-password") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <form action={handleNewPassword} className={`w-full max-w-sm space-y-5 ${card}`}>
          <div>
            <h1 className="text-2xl font-bold">Nouveau mot de passe</h1>
            <p className="mt-1 text-sm text-mute">Choisis un nouveau mot de passe pour ton compte.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-bold">
              Nouveau mot de passe
            </label>
            <input id="password" name="password" type="password" required minLength={6} className={input} />
          </div>

          <div className="space-y-1">
            <label htmlFor="confirm_password" className="text-sm font-bold">
              Confirme le mot de passe
            </label>
            <input id="confirm_password" name="confirm_password" type="password" required minLength={6} className={input} />
          </div>

          {passwordError && <p className="text-sm text-bad">{passwordError}</p>}

          <button type="submit" disabled={isPending} className={`w-full ${buttonPrimary}`}>
            {isPending ? "Enregistrement..." : "Enregistrer le nouveau mot de passe"}
          </button>
        </form>
      </main>
    );
  }

  if (step === "password-updated") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className={`w-full max-w-sm space-y-4 ${card}`}>
          <h1 className="text-2xl font-bold">Mot de passe mis à jour</h1>
          <div className={bannerNeutral}>Ton mot de passe a bien été changé.</div>
          <Link href="/" className={`block text-center ${buttonPrimary}`}>
            Retour à l&rsquo;appli
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className={`w-full max-w-sm space-y-4 ${card}`}>
        <h1 className="text-2xl font-bold">Lien invalide</h1>
        <div className={bannerWarn}>Ce lien est invalide ou a expiré.</div>
        <Link href="/login" className={`block text-center ${buttonPrimary}`}>
          Retour à la connexion
        </Link>
      </div>
    </main>
  );
}
