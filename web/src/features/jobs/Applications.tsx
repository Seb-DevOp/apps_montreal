/**
 * Suivi des candidatures.
 *
 * L'application entière est mono-utilisateur : la garde d'accès est posée une
 * seule fois, dans firestore.rules et dans App.tsx. Cet écran n'a donc pas de
 * vérification propre à faire.
 *
 * L'ordre d'affichage suit l'urgence et non la chronologie — une relance en
 * retard doit sauter aux yeux (voir useApplications.ts).
 */
import { useMemo, useState } from 'react';
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_STYLE,
  isOpen,
  useApplicationActions,
  useApplications,
  type EnrichedApplication,
} from './useApplications';
import { DEFAULT_QUESTIONS, DEFAULT_QUESTIONS_TO_ASK, SALARY_HINTS } from './interviewTemplate';
import type { ApplicationStatus, JobApplication } from '../../types';

const inputClass =
  'w-full rounded-xl bg-black/25 px-3 py-2.5 text-sm text-frost outline-none placeholder:text-frost/30';

function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Bandeau d'échéance : c'est l'information qui déclenche une action. */
function DueBadge({ application }: { application: EnrichedApplication }) {
  if (application.daysUntilAction === null || !isOpen(application.status)) return null;

  const days = application.daysUntilAction;
  const label =
    days < 0
      ? `en retard de ${Math.abs(days)} j`
      : days === 0
        ? "aujourd'hui"
        : days === 1
          ? 'demain'
          : `dans ${days} j`;

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] ${
        application.overdue ? 'bg-maple/20 text-maple' : days <= 2 ? 'bg-amber/20 text-amber' : 'bg-white/10 text-frost/50'
      }`}
    >
      ⏱ {application.nextAction || 'Relance'} · {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Formulaire de création
// ---------------------------------------------------------------------------

function NewApplicationForm({ onDone }: { onDone: () => void }) {
  const { create } = useApplicationActions();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('LinkedIn');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!company.trim() || !role.trim()) return;
    setBusy(true);
    try {
      await create({
        company,
        role,
        url,
        source,
        status: 'reperee',
        // La trame d'entretien est posée dès la création : la préparer plus
        // tard suppose d'y penser, ce qui n'arrive jamais.
        questions: DEFAULT_QUESTIONS,
        toAsk: DEFAULT_QUESTIONS_TO_ASK,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-stm/40 bg-stm/10 p-4">
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Entreprise" className={inputClass} />
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Intitulé du poste" className={inputClass} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Lien de l'offre (facultatif)" className={inputClass} inputMode="url" />
      <select value={source} onChange={(e) => setSource(e.target.value)} className={inputClass}>
        {['LinkedIn', 'Indeed', 'Jobillico', 'Québec emploi', 'Cooptation', 'Spontanée', 'Autre'].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDone} className="flex-1 rounded-xl bg-white/10 py-2.5 text-sm text-frost/70">
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !company.trim() || !role.trim()}
          className="flex-[2] rounded-xl bg-stm py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '…' : 'Ajouter'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Détail d'une candidature
// ---------------------------------------------------------------------------

function ApplicationDetail({ application }: { application: EnrichedApplication }) {
  const { update, remove } = useApplicationActions();
  const [tab, setTab] = useState<'suivi' | 'prep'>('suivi');

  const patch = (values: Partial<JobApplication>) => void update(application.id, values);

  const setQuestion = (index: number, answer: string) => {
    const questions = [...(application.questions ?? [])];
    const current = questions[index];
    if (!current) return;
    questions[index] = { ...current, answer };
    patch({ questions });
  };

  return (
    <div className="border-t border-white/10 p-4">
      <div className="mb-3 flex gap-1 rounded-xl bg-black/25 p-1 text-sm">
        {(['suivi', 'prep'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 transition ${tab === key ? 'bg-stm text-white' : 'text-frost/60'}`}
          >
            {key === 'suivi' ? 'Suivi' : `Entretien · ${application.prepProgress} %`}
          </button>
        ))}
      </div>

      {tab === 'suivi' ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-frost/50">Statut</label>
            <select
              value={application.status}
              onChange={(e) => patch({ status: e.target.value as ApplicationStatus })}
              className={`mt-1 ${inputClass}`}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-frost/50">Prochaine action</label>
              <input
                defaultValue={application.nextAction}
                onBlur={(e) => patch({ nextAction: e.target.value })}
                placeholder="Relancer, préparer…"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-frost/50">Le</label>
              <input
                type="date"
                defaultValue={application.nextActionAt ?? ''}
                onBlur={(e) => patch({ nextActionAt: e.target.value || null })}
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-frost/50">Candidature envoyée le</label>
              <input
                type="date"
                defaultValue={application.appliedAt}
                onBlur={(e) => patch({ appliedAt: e.target.value })}
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-frost/50">Fourchette (CAD)</label>
              <input
                defaultValue={application.salaryRange}
                onBlur={(e) => patch({ salaryRange: e.target.value })}
                placeholder="80 000 – 95 000"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>

          <details className="rounded-xl bg-black/20 p-3">
            <summary className="cursor-pointer text-xs text-frost/50">Repères de salaire à Montréal</summary>
            <ul className="mt-2 space-y-1 text-xs text-frost/60">
              {SALARY_HINTS.map((hint) => (
                <li key={hint.level} className="flex justify-between">
                  <span>{hint.level}</span>
                  <span className="font-mono text-frost/80">{hint.range}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-frost/35">
              Ordres de grandeur bruts annuels. Le marché montréalais est sensiblement sous Toronto,
              le coût de la vie aussi.
            </p>
          </details>

          <div className="grid grid-cols-2 gap-2">
            <input
              defaultValue={application.contactName}
              onBlur={(e) => patch({ contactName: e.target.value })}
              placeholder="Contact"
              className={inputClass}
            />
            <input
              defaultValue={application.contactEmail}
              onBlur={(e) => patch({ contactEmail: e.target.value })}
              placeholder="Courriel"
              inputMode="email"
              className={inputClass}
            />
          </div>

          <input
            defaultValue={application.url}
            onBlur={(e) => patch({ url: e.target.value })}
            placeholder="Lien de l'offre"
            inputMode="url"
            className={inputClass}
          />

          <textarea
            defaultValue={application.notes}
            onBlur={(e) => patch({ notes: e.target.value })}
            placeholder="Notes : impressions, points à creuser, retours reçus…"
            rows={4}
            className={`${inputClass} resize-none`}
          />

          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Supprimer la candidature ${application.company} ?`)) {
                void remove(application.id);
              }
            }}
            className="w-full rounded-xl bg-maple/15 py-2.5 text-sm text-maple"
          >
            Supprimer cette candidature
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs uppercase tracking-wider text-frost/50">Questions à préparer</h4>
              <span className="text-xs text-frost/40">{application.prepProgress} % prêt</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
              <div className="h-full bg-mint transition-all" style={{ width: `${application.prepProgress}%` }} />
            </div>

            <ul className="mt-3 space-y-3">
              {(application.questions ?? []).map((item, index) => (
                <li key={item.question}>
                  <p className="text-sm text-frost/85">{item.question}</p>
                  <textarea
                    defaultValue={item.answer}
                    onBlur={(e) => setQuestion(index, e.target.value)}
                    placeholder="Ta réponse, en quelques phrases…"
                    rows={2}
                    className={`mt-1 ${inputClass} resize-none ${
                      item.answer.trim() ? 'border-l-2 border-mint' : ''
                    }`}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-2 text-xs uppercase tracking-wider text-frost/50">Questions à poser</h4>
            <p className="mb-2 text-[11px] leading-relaxed text-frost/40">
              En poser est attendu au Québec : ne pas le faire est lu comme un manque d’intérêt.
            </p>
            <ul className="space-y-1.5">
              {(application.toAsk ?? []).map((question) => (
                <li key={question} className="rounded-xl bg-black/20 px-3 py-2 text-sm text-frost/70">
                  {question}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Écran principal
// ---------------------------------------------------------------------------

export function Applications(): JSX.Element {
  const { applications, loading, error } = useApplications();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<ApplicationStatus | 'toutes' | 'actives'>('actives');

  const counts = useMemo(() => {
    const map = {} as Record<ApplicationStatus, number>;
    for (const status of STATUS_ORDER) map[status] = 0;
    for (const application of applications) map[application.status] += 1;
    return map;
  }, [applications]);

  const visible = useMemo(() => {
    if (filter === 'toutes') return applications;
    if (filter === 'actives') return applications.filter((a) => isOpen(a.status));
    return applications.filter((a) => a.status === filter);
  }, [applications, filter]);

  const overdue = applications.filter((a) => a.overdue).length;


  return (
    <div className="space-y-4">
      {/* Pipeline */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-frost/70">
            {applications.filter((a) => isOpen(a.status)).length} candidature
            {applications.filter((a) => isOpen(a.status)).length > 1 ? 's' : ''} en cours
          </span>
          <span className="text-xs text-frost/40">{applications.length} au total</span>
        </div>

        {overdue > 0 && (
          <p className="mt-2 rounded-xl bg-maple/15 px-3 py-2 text-sm text-maple">
            {overdue} action{overdue > 1 ? 's' : ''} en retard.
          </p>
        )}

        <div className="mt-3 flex gap-1">
          {STATUS_ORDER.filter((s) => counts[s] > 0).map((status) => (
            <div
              key={status}
              className={`flex-1 rounded-lg px-1 py-2 text-center ${STATUS_STYLE[status]}`}
              title={STATUS_LABEL[status]}
            >
              <div className="font-mono text-sm">{counts[status]}</div>
              <div className="truncate text-[9px] uppercase">{STATUS_LABEL[status]}</div>
            </div>
          ))}
        </div>
      </div>

      {adding ? (
        <NewApplicationForm onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full rounded-xl bg-stm py-3.5 font-medium text-white"
        >
          + Nouvelle candidature
        </button>
      )}

      {/* Filtres */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(['actives', 'toutes', ...STATUS_ORDER] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              filter === key ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
            }`}
          >
            {key === 'actives' ? 'En cours' : key === 'toutes' ? 'Tout' : STATUS_LABEL[key]}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl bg-maple/15 p-3 text-sm text-maple">{error}</p>}
      {loading && <div className="h-32 animate-pulse rounded-2xl bg-white/5" />}

      {!loading && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-frost/40">
          {applications.length === 0
            ? 'Aucune candidature enregistrée. Ajoute la première pour lancer le suivi.'
            : 'Aucune candidature dans ce filtre.'}
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((application) => (
          <li
            key={application.id}
            className={`overflow-hidden rounded-2xl border bg-white/5 ${
              application.overdue ? 'border-maple/40' : 'border-white/10'
            }`}
          >
            <button
              type="button"
              onClick={() => setExpanded(expanded === application.id ? null : application.id)}
              className="w-full p-4 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-frost">{application.company}</h3>
                  <p className="truncate text-sm text-frost/60">{application.role}</p>
                </div>
                <StatusPill status={application.status} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <DueBadge application={application} />
                {application.source && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-frost/50">
                    {application.source}
                  </span>
                )}
                {application.salaryRange && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-frost/50">
                    {application.salaryRange} $
                  </span>
                )}
              </div>
            </button>

            {application.url && (
              <a
                href={application.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block border-t border-white/5 px-4 py-2 text-xs text-stm"
              >
                Ouvrir l’offre ↗
              </a>
            )}

            {expanded === application.id && <ApplicationDetail application={application} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
