-- Correction de 8 questions de la banque statique du quiz (migration 0057) dont l'ÉNONCÉ
-- contredisait la réponse enregistrée — signalé en prod le 2026-10-08 ("erreur dans le quiz du
-- jour", question 454 tombée ce jour-là).
--
-- Dans tous les cas ci-dessous, c'est le TEXTE de la question qui est faux, jamais correct_index :
-- la réponse et l'explication, elles, sont cohérentes entre elles et désignent sans ambiguïté le
-- même joueur. On réécrit donc l'énoncé pour qu'il corresponde à la réponse déjà en place, ce qui
-- évite aussi de créer des doublons (ex: 454 "corrigée" vers Xavi aurait fait double emploi avec
-- la question 563, déjà consacrée à Xavi).
--
-- Aucune réponse de joueur n'est touchée ici (voir scripts/fix-quiz-454-answers.mjs pour le
-- rattrapage des réponses du 2026-10-08) et aucun correct_index n'est modifié : l'ordre des choix
-- affiché aux joueurs (mélange déterministe par (jour, position, joueur), cf. lib/quiz/daily.ts)
-- reste donc strictement inchangé, y compris pour un quiz en cours au moment de la migration.

-- 454 — l'énoncé décrivait un "milieu espagnol, capitaine du Barça" alors que la réponse est le
-- gardien du Real Madrid (son explication le dit explicitement : "ce gardien"). Les joueurs
-- répondaient logiquement "Xavi Hernández" et étaient comptés faux.
update public.quiz_questions set
  question = 'Ce gardien espagnol, capitaine de la Roja, a soulevé la Coupe du Monde 2010 ainsi que les Euros 2008 et 2012. Qui est-il ?',
  explanation = 'Capitaine emblématique du Real Madrid et de la Roja durant cette période dorée : Euro 2008, Coupe du Monde 2010, puis Euro 2012.'
where id = 454;

-- 691 — même défaut, détecté par le même contrôle automatique : l'énoncé disait "attaquant
-- costaricien ... a ensuite joué en Angleterre", son explication dit "le gardien costaricien
-- rejoint peu après le Real Madrid". La mention de l'Angleterre est retirée plutôt que remplacée.
update public.quiz_questions set
  question = 'Ce gardien costaricien a été le héros de la Coupe du Monde 2014, où son pays a atteint les quarts de finale. Qui est-il ?'
where id = 691;

-- 630 — énoncé "défenseur italien ... a fini sa carrière à l'AC Milan" pour une réponse dont
-- l'explication dit "meilleur buteur de l'histoire de la Juventus". Les trois autres choix sont de
-- vrais défenseurs : un joueur qui connaît le football était activement orienté vers une mauvaise
-- réponse. Le passage à l'AC Milan est retiré (l'intéressé a fait sa carrière européenne à la Juve).
update public.quiz_questions set
  question = 'Cet attaquant italien, capitaine emblématique de la Juventus des années 1990-2000, a passé toute sa carrière européenne dans ce seul club. Qui est-il ?'
where id = 630;

-- 326 — "Ce milieu français" pour un attaquant, alors que Zinédine Zidane (un milieu) figure
-- parmi les choix : l'énoncé orientait vers le mauvais joueur.
update public.quiz_questions set
  question = 'Cet attaquant français a inscrit le but en or de la victoire des Bleus en finale de l''Euro 2000 face à l''Italie. Qui est-il ?'
where id = 326;

-- 462 — "Ce milieu allemand" pour un ailier, alors que Mesut Özil et Toni Kroos (deux milieux)
-- figurent parmi les choix : même problème que 326.
update public.quiz_questions set
  question = 'Cet ailier allemand, champion du monde 2014, est connu pour sa passe décisive lors du but du titre en finale. Qui est-il ?'
where id = 462;

-- 562 — l'énoncé faisait passer la réponse par le Real Madrid, ce que contredit la banque
-- elle-même : la question 323 dit du même joueur qu'il "a rejoint le FC Barcelone en 2014".
update public.quiz_questions set
  question = 'Cet attaquant uruguayen, meilleur buteur de l''histoire de sa sélection, a joué à l''Ajax, à Liverpool puis au FC Barcelone. Qui est-il ?'
where id = 562;

-- 566 et 461 — les deux énoncés contenaient le même fragment de parcours en club ("Chelsea,
-- Atlético Madrid"), signe d'une erreur de copier-coller à la rédaction : il ne correspond au
-- parcours réel d'aucune des deux réponses. Le fragment est retiré plutôt que remplacé par un
-- parcours qu'on ne peut pas vérifier ici — l'indice restant (meilleur buteur de la sélection)
-- identifie déjà la réponse sans ambiguïté parmi les choix proposés.
update public.quiz_questions set
  question = 'Cet attaquant néerlandais est le meilleur buteur de l''histoire de la sélection des Pays-Bas. Qui est-il ?'
where id = 566;

update public.quiz_questions set
  question = 'Cet attaquant belge est le meilleur buteur de l''histoire des Diables Rouges. Qui est-il ?'
where id = 461;
