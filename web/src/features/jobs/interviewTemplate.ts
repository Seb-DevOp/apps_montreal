/**
 * Trame de préparation d'entretien, pré-remplie à la création d'une candidature.
 *
 * Orientée marché québécois : plusieurs de ces questions ne se posent pas en
 * France, ou appellent une réponse différente. Un recruteur montréalais
 * s'attend notamment à ce qu'on ait un avis sur le statut d'immigration, la
 * date de disponibilité réelle et l'équivalence des diplômes — trois sujets
 * qu'un candidat venu de France néglige souvent.
 *
 * Les réponses sont vides : c'est un canevas, pas un script.
 */
import type { InterviewQuestion } from '../../types';

export const DEFAULT_QUESTIONS: InterviewQuestion[] = [
  { question: 'Parle-moi de toi en deux minutes.', answer: '' },
  { question: 'Pourquoi cette entreprise, et pourquoi ce poste ?', answer: '' },
  { question: 'Pourquoi quitter la France pour Montréal ?', answer: '' },
  { question: 'Quel est ton statut d’immigration et ton autorisation de travail ?', answer: '' },
  { question: 'À partir de quelle date es-tu réellement disponible ?', answer: '' },

  // ── Transition infrastructure → DevOps ────────────────────────────────────
  // Le point de bascule de l'entretien. Un recruteur voit un profil infra qui
  // postule sur du DevOps : il cherchera soit une reconversion mal préparée,
  // soit une progression cohérente. Ces cinq réponses décident de la lecture.
  {
    question:
      'Tu viens de l’infrastructure cloud : qu’est-ce qui t’amène vers le DevOps, concrètement ?',
    answer: '',
  },
  {
    question:
      'Qu’as-tu déjà automatisé toi-même ? (IaC, pipelines, scripts) Sois précis sur ta part.',
    answer: '',
  },
  {
    question: 'Où en es-tu sur Terraform, Ansible, Docker, Kubernetes, et un outil de CI/CD ?',
    answer: '',
  },
  {
    question: 'Qu’est-ce que ton expérience infra t’apporte qu’un profil purement dev n’a pas ?',
    answer: '',
  },
  {
    question: 'Quelle part d’infra et quelle part d’automatisation cherches-tu dans ce poste ?',
    answer: '',
  },

  { question: 'Décris un incident de production que tu as résolu, et ta contribution exacte.', answer: '' },
  { question: 'Raconte un échec technique et ce que tu en as tiré.', answer: '' },
  { question: 'Comment gères-tu un désaccord avec un collègue ?', answer: '' },
  { question: 'Quelles sont tes attentes salariales ? (en CAD, brut annuel)', answer: '' },
  { question: 'Où te vois-tu dans trois ans ?', answer: '' },
];

/**
 * Questions à poser au recruteur. En poser est attendu au Québec : ne pas le
 * faire est lu comme un manque d'intérêt, pas comme de la discrétion.
 */
export const DEFAULT_QUESTIONS_TO_ASK: string[] = [
  // Les trois premières servent à mesurer la part réelle de DevOps : un
  // intitulé peut promettre bien plus que le quotidien ne contient.
  'Quelle est la répartition réelle entre exploitation, projets et automatisation ?',
  'Quelle est la maturité de l’IaC et du CI/CD aujourd’hui — et où voulez-vous aller ?',
  'Y a-t-il des astreintes, et comment sont-elles organisées et compensées ?',
  'À quoi ressemble une semaine type dans ce poste ?',
  'Comment mesurez-vous la réussite sur les six premiers mois ?',
  'Quelle est la composition de l’équipe et à qui je rapporterais ?',
  'Quelle est la politique de télétravail, concrètement ?',
  'Quels sont les avantages sociaux : assurance collective, REER, congés ?',
  'Quelles sont les prochaines étapes du processus, et sous quel délai ?',
];

/**
 * Repères de rémunération, en dollars canadiens bruts annuels.
 *
 * Échelle centrée sur le trajet infra cloud → DevOps plutôt que sur des
 * niveaux d'ancienneté : les intitulés québécois se recouvrent largement, et
 * la vraie variable de négociation est la part d'automatisation du poste.
 *
 * À manier comme un ordre de grandeur : Montréal paie nettement sous Toronto,
 * et le coût de la vie y est plus bas.
 */
export const SALARY_HINTS: { level: string; range: string }[] = [
  { level: 'Infra cloud', range: '80 000 – 100 000 $' },
  { level: 'Cloud avec part DevOps', range: '90 000 – 112 000 $' },
  { level: 'DevOps / SRE confirmé', range: '105 000 – 135 000 $' },
  { level: 'Platform lead / architecte', range: '130 000 – 170 000 $' },
];
