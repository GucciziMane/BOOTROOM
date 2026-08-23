# Boot Room

Web app privée (5 comptes max) pour pronostiquer entre amis sur les 5 grands championnats européens :
Ligue 1, Premier League, La Liga, Bundesliga, Primeira Liga. Deux volets de jeu (voir
`supabase/migrations/0001_init.sql` pour le détail du barème) :

- **Pronostics de saison** : meilleur buteur/passeur, top 3, flop 3, équipe surprise, équipe flop.
- **Pronostics de match** : score exact + un buteur, sur le calendrier complet de chaque championnat.

Les points dépendent d'un tier de probabilité calculé par joueur (poste + forme récente) — voir
`src/lib/scoring/tiers.ts`.

## Stack

- Next.js 16 (App Router, TypeScript) + Tailwind, déployé sur Vercel
- Supabase (Postgres + Auth + RLS) — inscription fermée, via code d'invitation uniquement
- API-Football (RapidAPI, plan gratuit) pour effectifs/calendriers/résultats, synchronisé par des jobs cron

## Mise en route

1. **Installer les dépendances**

   ```bash
   npm install
   ```

2. **Créer un projet Supabase** (gratuit) sur [supabase.com](https://supabase.com), puis appliquer le schéma :

   ```bash
   npx supabase login
   npx supabase link --project-ref <ton-project-ref>
   npx supabase db push
   ```

   (ou copier-coller le contenu de `supabase/migrations/0001_init.sql` dans le SQL Editor du dashboard Supabase)

3. **Créer une clé API-Football** (gratuite, 100 req/jour) sur [api-football.com](https://www.api-football.com/) ou via RapidAPI.

4. **Copier `.env.example` en `.env.local`** et renseigner :
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (Project Settings > API sur Supabase)
   - `API_FOOTBALL_KEY`
   - `CRON_SECRET` (une valeur aléatoire, pour sécuriser les routes `/api/cron/*`)

5. **Créer les 5 codes d'invitation** (table `invite_codes`, ex: via le SQL Editor Supabase) :

   ```sql
   insert into invite_codes (code) values ('CODE-UNIQUE-1'), ('CODE-UNIQUE-2');
   ```

6. **Lancer le serveur de dev**

   ```bash
   npm run dev
   ```

   Ouvrir [http://localhost:3000](http://localhost:3000), créer un compte via `/signup` avec un code d'invitation.

## Déploiement

Déployer sur Vercel, renseigner les mêmes variables d'environnement dans les settings du projet, et configurer les
jobs cron (`vercel.json`) une fois les routes de synchronisation en place (voir tâche "Intégrer la synchro
API-Football").
