"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { updateAvatar, type UpdateAvatarState } from "./actions";
import { buttonPrimary } from "@/lib/ui";

const initialState: UpdateAvatarState = { error: null, success: false };

export function AvatarForm({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  const [state, formAction, isPending] = useActionState(updateAvatar, initialState);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <form action={formAction} className="flex flex-col items-center gap-4">
      <div className="relative h-32 w-32 overflow-hidden rounded-full border-2 border-line bg-cream">
        {preview ? (
          // Aperçu local (blob:) avant envoi : pas de bénéfice à passer par l'optimiseur d'images.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : avatarUrl ? (
          <Image src={avatarUrl} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-4xl font-bold text-mute">
            {username.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      <label className="cursor-pointer text-sm font-bold text-ink underline decoration-2 underline-offset-2">
        Choisir une photo
        <input
          type="file"
          name="avatar"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
        />
      </label>

      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.success && <p className="text-sm text-good">Photo mise à jour.</p>}

      <button type="submit" disabled={isPending} className={buttonPrimary}>
        {isPending ? "Envoi..." : "Enregistrer"}
      </button>
    </form>
  );
}
