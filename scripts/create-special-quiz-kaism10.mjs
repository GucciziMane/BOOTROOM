// Crée le quiz surprise à usage unique pour kaism10 (demande explicite de l'utilisateur : le
// féliciter pour sa fidélité et ses performances — 41 jours de quiz joués sur 42 depuis le
// lancement de la fonctionnalité, classé n°1 du classement de saison avec 457 pts, 178
// pronostics de match posés — chiffres réels vérifiés en base avant d'écrire ce message, jamais
// inventés) via supabase/migrations/0065_special_quiz.sql.
//
// 20 questions écrites à la main, vérifiées UNE À UNE contre le contenu actuel de
// quiz_questions (aucune ne recoupe une question déjà existante dans la banque — demande
// explicite "ne pioche pas dans la banque") : faits footballistiques bien établis, jamais
// inventés, avec un correct_index fixe par question (pas de mélange par joueur comme dans
// src/lib/quiz/daily.ts — un seul destinataire, pas besoin de la protection anti-triche par
// mélange qui vise les quiz partagés par plusieurs joueurs).
//
// Lien renvoyé à la fin : à utiliser pour composer la notification (ou relancer ce script, qui
// envoie aussi la notif push directement — idempotent par (user_id) via DELETE préalable des
// anciens quiz surprise de ce même utilisateur, pour ne jamais en laisser deux actifs à la fois).
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/create-special-quiz-kaism10.mjs
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERNAME = "kaism10";

const QUESTIONS = [
  // --- facile (6) ---
  {
    category: "trivia", difficulty: "easy",
    question: "Comment surnomme-t-on traditionnellement la sélection nationale argentine de football ?",
    choices: ["l'Albiceleste", "la Canarinha", "la Roja", "les Bleus"], correct_index: 0,
    explanation: "Ce surnom vient des couleurs bleu ciel et blanc de son maillot.",
  },
  {
    category: "trivia", difficulty: "easy",
    question: "Quelle couleur de carton signifie un simple avertissement, sans exclusion du joueur ?",
    choices: ["Jaune", "Rouge", "Bleu", "Vert"], correct_index: 0,
    explanation: "Deux cartons jaunes dans le même match entraînent ensuite une expulsion.",
  },
  {
    category: "trivia", difficulty: "easy",
    question: "À quelle distance du but est placé le point de penalty ?",
    choices: ["11 mètres", "9 mètres", "14 mètres", "18 mètres"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "easy",
    question: "Combien de clubs composent aujourd'hui le championnat de Ligue 1, l'élite du football français ?",
    choices: ["18", "16", "20", "22"], correct_index: 0,
    explanation: "Le format est passé de 20 à 18 clubs à partir de la saison 2023-24.",
  },
  {
    category: "trivia", difficulty: "easy",
    question: "En quelle année le club anglais de Manchester City a-t-il été racheté par le fonds d'investissement d'Abu Dhabi, marquant le début de son ascension ?",
    choices: ["2008", "2003", "2011", "2016"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "easy",
    question: "En quelle année l'homme d'affaires Roman Abramovitch a-t-il racheté le club londonien de Chelsea FC ?",
    choices: ["2003", "2008", "1998", "2011"], correct_index: 0,
    explanation: null,
  },
  // --- moyen (8) ---
  {
    category: "trivia", difficulty: "medium",
    question: "En quelle année la FIFA, instance dirigeante du football mondial, a-t-elle été fondée à Paris ?",
    choices: ["1904", "1930", "1921", "1946"], correct_index: 0,
    explanation: "Sept fédérations européennes étaient à l'origine de sa création.",
  },
  {
    category: "player_career", difficulty: "medium",
    question: "Cette attaquante norvégienne, star de l'Olympique Lyonnais, a remporté le tout premier Ballon d'or féminin de l'histoire, en 2018. Qui est-elle ?",
    choices: ["Ada Hegerberg", "Alexia Putellas", "Megan Rapinoe", "Marta"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "medium",
    question: "En quelle année le Ballon d'or, créé par le magazine France Football, a-t-il été décerné pour la première fois ?",
    choices: ["1956", "1960", "1950", "1965"], correct_index: 0,
    explanation: "Stanley Matthews en fut le tout premier lauréat.",
  },
  {
    category: "player_career", difficulty: "medium",
    question: "Ce milieu anglais, formé à Birmingham City, s'est révélé au Borussia Dortmund avant de s'imposer comme titulaire majeur au Real Madrid. Qui est-il ?",
    choices: ["Jude Bellingham", "Phil Foden", "Mason Mount", "Declan Rice"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "medium",
    question: "Quel club de Serie A italienne a remporté le Scudetto 2022-2023, son premier titre depuis plus de 30 ans, porté par son attaquant nigérian Victor Osimhen ?",
    choices: ["le Napoli", "la Juventus", "l'Inter Milan", "l'AS Roma"], correct_index: 0,
    explanation: "Son précédent titre de champion remontait à l'époque de Diego Maradona, en 1990.",
  },
  {
    category: "trivia", difficulty: "medium",
    question: "Quel club français, emmené par un jeune Olivier Giroud, a créé la surprise en remportant le titre de champion de Ligue 1 en 2012 ?",
    choices: ["Montpellier HSC", "le Stade Rennais", "l'OGC Nice", "le RC Lens"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "medium",
    question: "Quelle sélection, menée par son entraîneur allemand Otto Rehhagel, a créé l'une des plus grandes surprises de l'histoire en remportant l'Euro 2004 ?",
    choices: ["la Grèce", "le Danemark", "la Turquie", "la Lettonie"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "medium",
    question: "Quelle sélection a remporté l'Euro 1992 alors qu'elle n'avait été repêchée qu'au dernier moment, après l'exclusion de la Yougoslavie pour raisons politiques ?",
    choices: ["le Danemark", "la Suède", "les Pays-Bas", "l'Écosse"], correct_index: 0,
    explanation: "Une qualification obtenue sans même disputer la phase qualificative initiale.",
  },
  // --- difficile (6) ---
  {
    category: "trivia", difficulty: "hard",
    question: "Quel club anglais, surnommé « les Foxes », a créé l'une des plus grandes sensations de l'histoire du sport en étant sacré champion d'Angleterre en 2016, alors que les bookmakers le donnaient à 5000 contre 1 en début de saison ?",
    choices: ["Leicester City", "Wigan Athletic", "Blackburn Rovers", "Ipswich Town"], correct_index: 0,
    explanation: null,
  },
  {
    category: "player_career", difficulty: "hard",
    question: "Ce défenseur allemand, capitaine sur le terrain de la Mannschaft lors du sacre mondial de 1990 en Italie, est considéré comme l'un des meilleurs libéros de l'histoire. Qui est-il ?",
    choices: ["Lothar Matthäus", "Franz Beckenbauer", "Jürgen Kohler", "Andreas Brehme"], correct_index: 0,
    explanation: "Beckenbauer, lui, était alors le sélectionneur — il avait été capitaine comme joueur en 1974.",
  },
  {
    category: "score", difficulty: "hard",
    question: "En 2024, le Real Madrid a décroché son 15e titre de Ligue des Champions, un record absolu, en battant quel club allemand en finale à Wembley ?",
    choices: ["le Borussia Dortmund", "le Bayern Munich", "le RB Leipzig", "l'Eintracht Francfort"], correct_index: 0,
    explanation: "Victoire 2-0, avec des buts de Dani Carvajal et Vinícius Júnior.",
  },
  {
    category: "trivia", difficulty: "hard",
    question: "Combien de remplacements une équipe est-elle désormais autorisée à effectuer lors d'un match officiel, règle élargie depuis la pandémie de Covid-19 (contre 3 auparavant) ?",
    choices: ["5", "3", "4", "7"], correct_index: 0,
    explanation: null,
  },
  {
    category: "trivia", difficulty: "hard",
    question: "Pour quelle raison le Ballon d'or n'a-t-il exceptionnellement pas été décerné en 2020, une première depuis sa création en 1956 ?",
    choices: [
      "La pandémie de Covid-19 a trop perturbé la saison pour départager équitablement les candidats",
      "Aucun joueur n'a recueilli assez de voix",
      "France Football a connu des difficultés financières cette année-là",
      "La cérémonie a été annulée pour raisons de sécurité",
    ], correct_index: 0,
    explanation: null,
  },
  {
    category: "player_career", difficulty: "hard",
    question: "Ce défenseur français, ancien international, triple champion de France avec Monaco puis la Juventus, est le père de l'attaquant Marcus, international français lui aussi. Qui est-il ?",
    choices: ["Lilian Thuram", "Patrick Vieira", "Marcel Desailly", "Bixente Lizarazu"], correct_index: 0,
    explanation: null,
  },
];

if (QUESTIONS.length !== 20) throw new Error(`Attendu 20 questions, obtenu ${QUESTIONS.length}.`);

const title = "Ton quiz spécial 🏆";
const introMessage =
  "Avant de commencer : 41 journées de quiz jouées sur 42 depuis le lancement, classé n°1 du classement de saison, et 178 pronostics déjà posés cette saison. On voulait te dire merci d'être aussi fidèle à l'appli — ce quiz de 20 questions, toutes inédites, est rien que pour toi. Bonne chance 🎉";
const outroMessage =
  "Merci encore pour ta fidélité depuis le début de la saison — ce petit bonus est mérité. Ton score vient de s'ajouter à ton total de saison habituel, continue comme ça 🏆";

async function main() {
  const { data: profile } = await supabase.from("profiles").select("id").eq("username", USERNAME).maybeSingle();
  if (!profile) throw new Error(`Utilisateur "${USERNAME}" introuvable.`);
  const userId = profile.id;

  // Idempotent : un ancien quiz surprise pour ce même utilisateur (essai précédent, relance du
  // script) est remplacé plutôt que doublé — jamais deux liens valides actifs en même temps.
  const { error: deleteError } = await supabase.from("special_quizzes").delete().eq("user_id", userId);
  if (deleteError) throw new Error(`Suppression des anciens quiz surprise: ${deleteError.message}`);

  const token = randomBytes(24).toString("hex");

  const { data: inserted, error } = await supabase
    .from("special_quizzes")
    .insert({ user_id: userId, token, title, intro_message: introMessage, outro_message: outroMessage, questions: QUESTIONS })
    .select("id")
    .single();
  if (error) throw new Error(`Création du quiz surprise: ${error.message}`);

  const url = `https://bootroom.online/quiz/special/${token}`;
  console.log(`Quiz surprise créé (id=${inserted.id}) pour ${USERNAME}.`);
  console.log(`Lien : ${url}`);

  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (!subscriptions || subscriptions.length === 0) {
    console.log("Aucun abonnement push pour cet utilisateur — notification non envoyée (lien ci-dessus à transmettre autrement).");
    return;
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: "🎁 Une surprise pour toi",
    body: "On a préparé quelque chose de spécial rien que pour toi. Touche pour découvrir 👀",
    url: `/quiz/special/${token}`,
  });

  const staleIds = [];
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
      }
    })
  );
  if (staleIds.length > 0) await supabase.from("push_subscriptions").delete().in("id", staleIds);

  console.log(`Notification push envoyée à ${subscriptions.length - staleIds.length} appareil(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
