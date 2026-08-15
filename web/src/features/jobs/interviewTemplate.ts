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
  { question: 'Décris un projet dont tu es fier, et ta contribution exacte.', answer: '' },
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
  'À quoi ressemble une semaine type dans ce poste ?',
  'Comment mesurez-vous la réussite sur les six premiers mois ?',
  'Quelle est la composition de l’équipe et à qui je rapporterais ?',
  'Quelle est la politique de télétravail, concrètement ?',
  'Quels sont les avantages sociaux : assurance collective, REER, congés ?',
  'Quelles sont les prochaines étapes du processus, et sous quel délai ?',
];

/**
 * Repères de rémunération, en dollars canadiens bruts annuels.
 * À manier comme un ordre de grandeur : le marché montréalais est nettement
 * plus bas que Toronto ou Vancouver, et le coût de la vie aussi.
 */
export const SALARY_HINTS: { level: string; range: string }[] = [
  { level: 'Junior (0-2 ans)', range: '55 000 – 70 000 $' },
  { level: 'Intermédiaire (3-5 ans)', range: '75 000 – 95 000 $' },
  { level: 'Senior (6+ ans)', range: '95 000 – 120 000 $' },
  { level: 'Lead / architecte', range: '115 000 – 145 000 $' },
];
