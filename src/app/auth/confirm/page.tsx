"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { card, buttonPrimary, bannerNeutral } from "@/lib/ui";

/**
 * Cible du lien envoyé par email (confirmation d'inscription). Le template par défaut de
 * Supabase (aucun SMTP personnalisé configuré) délivre la session via un fragment d'URL
 * (#access_token=...), lisible seulement côté client — d'où la page client plutôt qu'une
 * route serveur. Repli sur token_hash/type (flux OTP) si jamais le format change un jour.
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    const searchParams = new URLSearchParams(window.location.search);
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    async function confirm() {
      const supabase = createClient();

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (!error) return router.replace("/login?confirmed=1");
      } else if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
        if (!error) return router.replace("/login?confirmed=1");
      }
      setFailed(true);
    }

    confirm();
  }, [router]);

  if (!failed) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-mute">Vérification en cours...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className={`w-full max-w-sm space-y-4 ${card}`}>
        <h1 className="text-2xl font-bold">Validation réalisée avec succès</h1>
        <div className={bannerNeutral}>Ton adresse email est confirmée, tu peux te connecter.</div>
        <Link href="/login" className={`block text-center ${buttonPrimary}`}>
          Se connecter
        </Link>
      </div>
    </main>
  );
}
