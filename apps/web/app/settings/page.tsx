"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

import {
  DEFAULT_LOW_CONFIDENCE,
  LANGUAGE_OPTIONS,
  MODEL_OPTIONS,
} from "@/lib/constants";
import { api, describeError } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import { requestNotificationPermission } from "@/lib/notifications";
import type { AppSettings, GpuDiagnostics } from "@/lib/types";
import { useSettings } from "@/contexts/SettingsContext";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Toggle } from "@/components/ui/Toggle";
import { StoragePanel } from "@/components/settings/StoragePanel";
import { IntelligenceSettings } from "@/components/workspace/IntelligenceSettings";

const COMPUTE_TYPES = ["int8", "int8_float16", "float16", "float32"];
const DEVICES = ["cuda", "cpu"];

const PANEL_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3 },
  }),
};

export default function SettingsPage() {
  const { settings, loading, update } = useSettings();
  const [gpu, setGpu] = useState<GpuDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [vocabulary, setVocabulary] = useState({
    vocabulary: "",
    hotwords: "",
  });

  useEffect(() => {
    api
      .healthGpu()
      .then(setGpu)
      .catch(() => setGpu(null));
  }, []);

  useEffect(() => {
    if (settings)
      setVocabulary({
        vocabulary: settings.vocabulary ?? "",
        hotwords: settings.hotwords ?? "",
      });
  }, [settings?.vocabulary, settings?.hotwords]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every change goes through here: a rejected value is explained instead of failing silently. */
  const save = async (values: Partial<AppSettings>, success?: string) => {
    setError("");
    setNotice("");
    try {
      await update(values);
      if (success) setNotice(success);
    } catch (failure) {
      setError(
        describeError(failure, "Não foi possível salvar a configuração."),
      );
    }
  };

  if (loading || !settings) {
    return (
      <p className="p-8 text-sm text-text-muted">Carregando configurações…</p>
    );
  }

  const threshold = Number(
    settings.low_confidence_threshold ?? DEFAULT_LOW_CONFIDENCE,
  );
  const vocabularyChanged =
    vocabulary.vocabulary !== (settings.vocabulary ?? "") ||
    vocabulary.hotwords !== (settings.hotwords ?? "");

  return (
    <div className="settings-page">
      <div className="page-heading">
        <h1>Configurações</h1>
        <p className="mt-3 text-text-secondary">
          Ajuste os motores, o processamento e a experiência do seu Studio.
        </p>
      </div>
      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={`settings-feedback ${error ? "text-danger" : "text-success"}`}
        >
          {error || notice}
        </p>
      )}
      <div className="settings-cards">
        <IntelligenceSettings />

        <motion.div
          custom={0}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Diagnóstico de GPU
            </h2>
            {gpu ? (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-text-muted">Disponível</dt>
                <dd>
                  <Badge tone={gpu.gpu_available ? "success" : "warning"}>
                    {gpu.gpu_available ? "sim" : "não"}
                  </Badge>
                </dd>
                <dt className="text-text-muted">GPU</dt>
                <dd className="text-text-primary">
                  {gpu.gpu_name ?? "Não disponível"}
                </dd>
                <dt className="text-text-muted">VRAM livre</dt>
                <dd className="text-text-primary">
                  {gpu.free_memory_mb != null
                    ? `${Math.round(gpu.free_memory_mb)} MiB`
                    : "Não disponível"}
                </dd>
                <dt className="text-text-muted">Driver</dt>
                <dd className="text-text-primary">
                  {gpu.driver_version ?? "Não disponível"}
                </dd>
                <dt className="text-text-muted">CTranslate2</dt>
                <dd className="text-text-primary">
                  {gpu.ctranslate2_version ?? "Não disponível"}
                </dd>
                <dt className="text-text-muted">Modelo carregado</dt>
                <dd className="text-text-primary">
                  {gpu.loaded_model ?? "nenhum ainda"}
                </dd>
                {gpu.error && (
                  <>
                    <dt className="text-text-muted">Aviso</dt>
                    <dd className="text-warning">{gpu.error}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-text-muted">Sem resposta do worker.</p>
            )}
          </Panel>
        </motion.div>

        <motion.div
          custom={1}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Transcrição
            </h2>

            <Field label="Modelo padrão">
              <select
                value={settings.default_model}
                onChange={(e) => save({ default_model: e.target.value })}
                className="select-field"
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Idioma padrão">
              <select
                value={settings.default_language ?? ""}
                onChange={(e) => save({ default_language: e.target.value })}
                className="select-field"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Dispositivo">
              <select
                value={settings.transcription_device}
                onChange={(e) => save({ transcription_device: e.target.value })}
                className="select-field"
              >
                {DEVICES.map((d) => (
                  <option key={d} value={d}>
                    {d.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Compute type">
              <select
                value={settings.transcription_compute_type}
                onChange={(e) =>
                  save({ transcription_compute_type: e.target.value })
                }
                className="select-field"
              >
                {COMPUTE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Beam size">
              <input
                type="number"
                min={1}
                max={10}
                value={settings.default_beam_size}
                onChange={(e) =>
                  save({ default_beam_size: Number(e.target.value) })
                }
                className="select-field w-20"
              />
            </Field>

            <Toggle
              label="VAD (detecção de atividade de voz)"
              checked={settings.default_vad_enabled}
              onChange={(v) => save({ default_vad_enabled: v })}
            />
            <Toggle
              label="Timestamps por palavra"
              checked={settings.default_word_timestamps}
              onChange={(v) => save({ default_word_timestamps: v })}
            />
            <Toggle
              label="Traduzir para inglês"
              checked={settings.default_translate_to_english}
              onChange={(v) => save({ default_translate_to_english: v })}
            />
          </Panel>
        </motion.div>

        <motion.div
          custom={2}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Vocabulário
            </h2>
            <p className="text-sm leading-relaxed text-text-secondary">
              Nomes de pessoas, empresas, siglas e termos técnicos ajudam o
              reconhecimento a escrever certo o que foi dito. Eles não são
              inseridos no texto.
            </p>
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save(
                  vocabulary,
                  "Vocabulário salvo. Vale para as próximas transcrições.",
                );
              }}
            >
              <label className="text-sm text-text-secondary">
                Contexto e grafias
                <textarea
                  className="field mt-2 min-h-24 resize-y resize-none"
                  maxLength={1000}
                  value={vocabulary.vocabulary}
                  placeholder="Ex.: Reunião da Opikode com Ana Paula e Rodrigo sobre Trofi, Kubernetes e LGPD."
                  onChange={(e) =>
                    setVocabulary({ ...vocabulary, vocabulary: e.target.value })
                  }
                />
                <span className="mt-1 block text-xs text-text-muted">
                  {vocabulary.vocabulary.length}/1000
                </span>
              </label>
              <label className="text-sm text-text-secondary">
                Palavras prioritárias
                <input
                  className="field mt-2"
                  maxLength={500}
                  value={vocabulary.hotwords}
                  placeholder="Ex.: PostgreSQL, Kubernetes, AudioWhisper"
                  onChange={(e) =>
                    setVocabulary({ ...vocabulary, hotwords: e.target.value })
                  }
                />
              </label>
              <div>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!vocabularyChanged}
                >
                  Salvar vocabulário
                </Button>
              </div>
            </form>
          </Panel>
        </motion.div>

        <motion.div
          custom={3}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Revisão e avisos
            </h2>
            <label className="text-sm text-text-secondary">
              Destacar trechos com confiança abaixo de{" "}
              <strong className="text-text-primary">
                {formatPercent(threshold)}
              </strong>
              <input
                type="range"
                min={0.3}
                max={0.9}
                step={0.05}
                value={threshold}
                className="mt-3 h-10 w-full accent-[var(--color-accent)]"
                aria-valuetext={formatPercent(threshold)}
                onChange={(e) =>
                  save({ low_confidence_threshold: Number(e.target.value) })
                }
              />
            </label>
            <Toggle
              label="Avisar quando uma transcrição terminar com a aba em segundo plano"
              checked={Boolean(settings.notifications_enabled)}
              onChange={async (enabled) => {
                if (!enabled) return save({ notifications_enabled: false });
                const permission = await requestNotificationPermission();
                if (permission === "granted")
                  return save(
                    { notifications_enabled: true },
                    "Avisos ativados neste navegador.",
                  );
                setError(
                  permission === "unsupported"
                    ? "Este navegador não oferece notificações."
                    : "O navegador bloqueou as notificações. Libere a permissão do site e tente de novo.",
                );
              }}
            />
          </Panel>
        </motion.div>

        <motion.div
          custom={4}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Interface
            </h2>
            <Toggle
              label="Efeitos visuais (waveform reativa e cena ambiente)"
              checked={settings.visual_effects_enabled}
              onChange={(v) => save({ visual_effects_enabled: v })}
            />
          </Panel>
        </motion.div>

        <motion.div
          custom={5}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <StoragePanel />
        </motion.div>
      </div>
      <style>{`
        .select-field {
          max-width: 100%;
          min-width: 0;
          background: var(--color-surface-interactive);
          border: 1px solid var(--color-border);
          border-radius: 0.625rem;
          padding: 0.625rem 0.75rem;
          min-height: 44px;
          font-size: 1rem;
          color: var(--color-text-primary);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary sm:flex-nowrap">
      {label}
      {children}
    </label>
  );
}
